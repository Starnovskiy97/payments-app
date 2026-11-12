import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { after, before, test } from 'node:test';

// Тесты запускают настоящие независимые процессы на отдельных портах, без dev-серверов.
const ordersUrl = 'http://127.0.0.1:3101';
const paymentsUrl = 'http://127.0.0.1:3102';
const providerUrl = 'http://127.0.0.1:3105';
const providerToken = randomUUID();
const webhookSecret = randomUUID();
const providerHeaders = { 'x-provider-token': providerToken };
const token = randomUUID();
const internal = { 'x-internal-token': token };
const rabbitUrl =
  process.env.TEST_RABBITMQ_URL ?? 'amqp://lab_test:lab_test_local@127.0.0.1:5673?heartbeat=5';
const controlledBrokerContainer = process.env.TEST_RABBITMQ_CONTAINER;
const skipBrokerFaults = !!process.env.TEST_RABBITMQ_URL && !controlledBrokerContainer;
const queuePrefix = `test.${randomUUID().replaceAll('-', '')}`;
process.env.RABBITMQ_URL = rabbitUrl;
process.env.RABBITMQ_QUEUE_PREFIX = queuePrefix;
const run = promisify(execFile);
const children = [];
let output = '';
let ordersProcess;
let paymentsProcess;
let providerProcess;
let database;
let adminDatabase;
let paymentsDatabase;
let paymentsAdminDatabase;
let databaseCreated = false;
let paymentsDatabaseCreated = false;
let providerDatabase;
let providerAdminDatabase;
let providerDatabaseCreated = false;
const databaseName = `orders_test_${randomUUID().replaceAll('-', '')}`;
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://orders_test:orders_test_local@127.0.0.1:15433/orders_test';
const isolatedDatabaseUrl = new URL(testDatabaseUrl);
isolatedDatabaseUrl.pathname = `/${databaseName}`;
const paymentsDatabaseName = `payments_test_${randomUUID().replaceAll('-', '')}`;
const testPaymentsDatabaseUrl =
  process.env.TEST_PAYMENTS_DATABASE_URL ??
  'postgresql://payments_test:payments_test_local@127.0.0.1:15435/payments_test';
const isolatedPaymentsDatabaseUrl = new URL(testPaymentsDatabaseUrl);
isolatedPaymentsDatabaseUrl.pathname = `/${paymentsDatabaseName}`;
const providerDatabaseName = `provider_test_${randomUUID().replaceAll('-', '')}`;
const testProviderDatabaseUrl =
  process.env.TEST_PROVIDER_DATABASE_URL ??
  'postgresql://provider_test:provider_test_local@127.0.0.1:15437/provider_test';
const isolatedProviderDatabaseUrl = new URL(testProviderDatabaseUrl);
isolatedProviderDatabaseUrl.pathname = `/${providerDatabaseName}`;

// Разрешаем зависимости в контексте orders-service, а не полагаемся на hoisting.
const requireOrders = createRequire(
  new URL('../apps/orders-service/package.json', import.meta.url),
);
const { DataSource } = requireOrders('typeorm');
const { RabbitConnection, queueNames, declareQueues } = requireOrders('@lab/messaging');
const requireMessaging = createRequire(
  new URL('../packages/messaging/package.json', import.meta.url),
);
const { connect } = requireMessaging('amqplib');
const queues = queueNames(queuePrefix);
const testBus = new RabbitConnection(() => undefined);
const { databaseOptions } = requireOrders('./dist/database/database-options.js');
const requirePayments = createRequire(
  new URL('../apps/payments-service/package.json', import.meta.url),
);
const { databaseOptions: paymentsDatabaseOptions } = requirePayments(
  './dist/database/database-options.js',
);
const requireProvider = createRequire(
  new URL('../apps/payment-provider-simulator/package.json', import.meta.url),
);
const { databaseOptions: providerDatabaseOptions } = requireProvider(
  './dist/database/database-options.js',
);

async function api(base, path, body, headers = {}) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, data: await response.json() };
}

function start(service, port, overrides = {}) {
  const child = spawn(process.execPath, [`apps/${service}/dist/main.js`], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      ORDERS_SERVICE_URL: ordersUrl,
      PAYMENTS_SERVICE_URL: paymentsUrl,
      INTERNAL_API_TOKEN: token,
      RABBITMQ_URL: rabbitUrl,
      RABBITMQ_QUEUE_PREFIX: queuePrefix,
      PROVIDER_API_URL: providerUrl,
      PROVIDER_PUBLIC_URL: providerUrl,
      PROVIDER_API_TOKEN: providerToken,
      PROVIDER_WEBHOOK_SECRET: webhookSecret,
      PAYMENTS_WEBHOOK_URL: `${paymentsUrl}/webhooks/simulator`,
      DATABASE_URL:
        service === 'payment-provider-simulator'
          ? isolatedProviderDatabaseUrl.toString()
          : service === 'payments-service'
            ? isolatedPaymentsDatabaseUrl.toString()
            : isolatedDatabaseUrl.toString(),
      ...overrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (data) => {
    output += data;
  });
  child.stderr.on('data', (data) => {
    output += data;
  });
  children.push(child);
  return child;
}

async function ready(base) {
  for (let i = 0; i < 250; i++) {
    try {
      const response = await api(base, '/health');
      if (response.status === 200 && response.data.rabbitmq !== 'disconnected') return;
    } catch {
      /* процесс ещё запускается */
    }
    await delay(100);
  }
  throw new Error(`Сервис не запустился: ${base}\n${output}`);
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
}

before(async () => {
  adminDatabase = new DataSource({ type: 'postgres', url: testDatabaseUrl });
  await adminDatabase.initialize();
  // Своя новая база на каждый прогон: никаких TRUNCATE или удаления dev-данных.
  await adminDatabase.query(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;
  database = new DataSource({ ...databaseOptions(), url: isolatedDatabaseUrl.toString() });
  await database.initialize();
  assert.equal((await database.runMigrations()).length, 1);
  assert.equal((await database.runMigrations()).length, 0);
  // Откат проверяется только на пустой одноразовой тестовой базе.
  await database.undoLastMigration();
  assert.equal((await database.runMigrations()).length, 1);

  paymentsAdminDatabase = new DataSource({ type: 'postgres', url: testPaymentsDatabaseUrl });
  await paymentsAdminDatabase.initialize();
  await paymentsAdminDatabase.query(`CREATE DATABASE "${paymentsDatabaseName}"`);
  paymentsDatabaseCreated = true;
  paymentsDatabase = new DataSource({
    ...paymentsDatabaseOptions(),
    url: isolatedPaymentsDatabaseUrl.toString(),
  });
  await paymentsDatabase.initialize();
  assert.equal((await paymentsDatabase.runMigrations()).length, 3);
  assert.equal((await paymentsDatabase.runMigrations()).length, 0);
  await paymentsDatabase.undoLastMigration();
  await paymentsDatabase.undoLastMigration();
  await paymentsDatabase.undoLastMigration();
  assert.equal((await paymentsDatabase.runMigrations()).length, 3);

  providerAdminDatabase = new DataSource({ type: 'postgres', url: testProviderDatabaseUrl });
  await providerAdminDatabase.initialize();
  await providerAdminDatabase.query(`CREATE DATABASE "${providerDatabaseName}"`);
  providerDatabaseCreated = true;
  providerDatabase = new DataSource({
    ...providerDatabaseOptions(),
    url: isolatedProviderDatabaseUrl.toString(),
  });
  await providerDatabase.initialize();
  assert.equal((await providerDatabase.runMigrations()).length, 1);
  assert.equal((await providerDatabase.runMigrations()).length, 0);
  await providerDatabase.undoLastMigration();
  assert.equal((await providerDatabase.runMigrations()).length, 1);

  ordersProcess = start('orders-service', 3101);
  paymentsProcess = start('payments-service', 3102);
  providerProcess = start('payment-provider-simulator', 3105);
  await Promise.all([ready(ordersUrl), ready(paymentsUrl), ready(providerUrl)]);
});

after(async () => {
  await Promise.all(children.map(stop));
  await testBus.close();
  try {
    await withBroker(async (channel) => {
      for (const queue of [queues.retry, queues.results, queues.dead])
        await channel.deleteQueue(queue);
    });
  } catch {
    console.warn(
      `Брокер недоступен при очистке; очереди ${queuePrefix} могут остаться. Dev-очереди не затрагивались.`,
    );
  }
  if (database?.isInitialized) await database.destroy();
  if (adminDatabase?.isInitialized) {
    if (databaseCreated) await adminDatabase.query(`DROP DATABASE "${databaseName}"`);
    await adminDatabase.destroy();
  }
  if (paymentsDatabase?.isInitialized) await paymentsDatabase.destroy();
  if (paymentsAdminDatabase?.isInitialized) {
    if (paymentsDatabaseCreated)
      await paymentsAdminDatabase.query(`DROP DATABASE "${paymentsDatabaseName}"`);
    await paymentsAdminDatabase.destroy();
  }
  if (providerDatabase?.isInitialized) await providerDatabase.destroy();
  if (providerAdminDatabase?.isInitialized) {
    if (providerDatabaseCreated)
      await providerAdminDatabase.query(`DROP DATABASE "${providerDatabaseName}"`);
    await providerAdminDatabase.destroy();
  }
});

// Результат задаётся только у внешнего симулятора. Затем читаем состояние нашего сервиса.
async function completePayment(id, status, options = {}) {
  const { waitForOrder = true, ...providerOptions } = options;
  const payment = await api(paymentsUrl, `/payments/${id}`);
  const result = await api(
    providerUrl,
    `/provider/payments/${payment.data.providerPaymentId}/complete`,
    { status, ...providerOptions },
  );
  if (result.status !== 201) return result;
  const data = (await api(paymentsUrl, `/payments/${id}`)).data;
  if (waitForOrder && status === 'succeeded' && data.notificationStatus === 'published') {
    await awaitOrder(data.orderId, 'paid');
  }
  return { status: result.status, data };
}

async function eventually(check, description, timeout = 12000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error(`Не дождались: ${description}\n${output}`);
}

async function awaitOrder(id, status) {
  await eventually(
    async () => (await api(ordersUrl, `/orders/${id}`)).data.status === status,
    `заказ ${id}: ${status}`,
  );
}

async function withBroker(action) {
  const connection = await connect(rabbitUrl, { timeout: 2000 });
  try {
    const channel = await connection.createConfirmChannel();
    await declareQueues(channel, queues);
    return await action(channel);
  } finally {
    await connection.close();
  }
}

async function createOrder() {
  const result = await api(ordersUrl, '/orders', { productId: 'backend-course', quantity: 2 });
  assert.equal(result.status, 201);
  assert.equal(result.data.amount, 100000);
  return result.data;
}

test('сквозной сценарий, параллельная идемпотентность и повтор уведомления', async () => {
  const order = await createOrder();
  const headers = { 'Idempotency-Key': randomUUID() };
  const attempts = await Promise.all(
    Array.from({ length: 3 }, () =>
      api(ordersUrl, `/orders/${order.id}/pay`, { method: 'sbp' }, headers),
    ),
  );
  for (const attempt of attempts) assert.equal(attempt.status, 201);
  assert.equal(new Set(attempts.map((attempt) => attempt.data.id)).size, 1);
  const payment = attempts[0].data;
  assert.equal(payment.status, 'pending');

  const changed = await api(ordersUrl, `/orders/${order.id}/pay`, { method: 'card' }, headers);
  assert.equal(changed.status, 409);
  const otherKey = await api(
    ordersUrl,
    `/orders/${order.id}/pay`,
    { method: 'sbp' },
    { 'Idempotency-Key': randomUUID() },
  );
  assert.equal(otherKey.status, 409);

  const paid = await completePayment(payment.id, 'succeeded');
  assert.equal(paid.status, 201);
  assert.equal(paid.data.notificationStatus, 'published');
  assert.equal((await api(ordersUrl, `/orders/${order.id}`)).data.status, 'paid');

  const duplicate = await completePayment(payment.id, 'succeeded');
  assert.equal(duplicate.data.notificationStatus, 'published');
  assert.equal(duplicate.data.notificationAttempts, 2);
  assert.equal(duplicate.data.resultEventId, paid.data.resultEventId);
  assert.equal(duplicate.data.resultRecordedAt, paid.data.resultRecordedAt);
  assert.equal((await api(ordersUrl, `/orders/${order.id}`)).data.paymentIds.length, 1);
  const repeated = await api(ordersUrl, `/orders/${order.id}/pay`, { method: 'sbp' }, headers);
  assert.equal(repeated.data.status, 'succeeded');
  assert.equal((await completePayment(payment.id, 'failed')).status, 409);
  assert.equal(
    (
      await api(
        ordersUrl,
        `/orders/${order.id}/pay`,
        { method: 'card' },
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
    409,
  );
});

test('после отказа можно создать новую попытку оплаты', async () => {
  const order = await createOrder();
  const first = await api(
    ordersUrl,
    `/orders/${order.id}/pay`,
    { method: 'card' },
    { 'Idempotency-Key': randomUUID() },
  );
  const failed = await completePayment(first.data.id, 'failed');
  assert.equal(failed.data.notificationStatus, 'published');
  assert.equal((await api(ordersUrl, `/orders/${order.id}`)).data.status, 'pending');
  const second = await api(
    ordersUrl,
    `/orders/${order.id}/pay`,
    { method: 'crypto' },
    { 'Idempotency-Key': randomUUID() },
  );
  assert.equal(second.status, 201);
  assert.notEqual(first.data.id, second.data.id);
  assert.equal((await api(ordersUrl, `/orders/${order.id}`)).data.paymentIds.length, 2);
});

test('валидация DTO, UUID, ключей и межсервисного токена', async () => {
  assert.equal(
    (await api(ordersUrl, '/orders', { productId: 'backend-course', quantity: 0 })).status,
    400,
  );
  assert.equal(
    (await api(ordersUrl, '/orders', { productId: 'backend-course', quantity: 1, amount: 1 }))
      .status,
    400,
  );
  assert.equal(
    (await api(ordersUrl, '/orders', { productId: 'unknown', quantity: 1 })).status,
    400,
  );
  assert.equal((await api(ordersUrl, '/orders/not-a-uuid')).status, 400);
  assert.equal((await api(ordersUrl, `/orders/${randomUUID()}`)).status, 404);
  assert.equal((await api(paymentsUrl, '/payments', {})).status, 401);
  assert.equal((await api(paymentsUrl, '/payments/lookup', {})).status, 401);
  assert.equal((await api(ordersUrl, '/internal/payment-results', {})).status, 404);
  const order = await createOrder();
  assert.equal((await api(ordersUrl, `/orders/${order.id}/pay`, { method: 'card' })).status, 400);
  assert.equal(
    (
      await api(
        ordersUrl,
        `/orders/${order.id}/pay`,
        { method: 'cash' },
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
    400,
  );
});

test('payments-service проверяет идемпотентность независимо от orders-service', async () => {
  const dto = {
    orderId: randomUUID(),
    amount: 50000,
    currency: 'RUB',
    method: 'card',
    idempotencyKey: randomUUID(),
  };
  const first = await api(paymentsUrl, '/payments', dto, internal);
  const second = await api(paymentsUrl, '/payments', dto, internal);
  assert.equal(first.status, 201);
  assert.equal(first.data.id, second.data.id);
  assert.equal((await api(paymentsUrl, '/payments', { ...dto, amount: 1 }, internal)).status, 409);
});

test('остановка заказов не мешает публикации; после запуска сообщение обрабатывается само', async () => {
  const order = await createOrder();
  const payment = await api(
    ordersUrl,
    `/orders/${order.id}/pay`,
    { method: 'card' },
    { 'Idempotency-Key': randomUUID() },
  );
  // SIGSTOP сохраняет процесс, но не даёт orders-service отвечать.
  ordersProcess.kill('SIGSTOP');
  try {
    const result = await completePayment(payment.data.id, 'succeeded', { waitForOrder: false });
    assert.equal(result.data.status, 'succeeded');
    assert.equal(result.data.notificationStatus, 'published');
  } finally {
    ordersProcess.kill('SIGCONT');
  }
  await awaitOrder(order.id, 'paid');
  assert.equal((await api(ordersUrl, `/orders/${order.id}`)).data.status, 'paid');
});

test('заказы, позиции, статус и ID платежа сохраняются после перезапуска orders-service', async () => {
  const unpaid = await createOrder();
  const paid = await createOrder();
  const result = await api(
    ordersUrl,
    `/orders/${paid.id}/pay`,
    { method: 'card' },
    {
      'Idempotency-Key': randomUUID(),
    },
  );
  const notification = await completePayment(result.data.id, 'succeeded');
  assert.equal(notification.data.notificationStatus, 'published');
  const before = (await api(ordersUrl, `/orders/${paid.id}`)).data;

  await stop(ordersProcess);
  ordersProcess = start('orders-service', 3101);
  await ready(ordersUrl);
  assert.deepEqual((await api(ordersUrl, `/orders/${unpaid.id}`)).data, unpaid);
  assert.deepEqual((await api(ordersUrl, `/orders/${paid.id}`)).data, before);
  assert.equal(before.status, 'paid');
  assert.deepEqual(before.paymentIds, [result.data.id]);

  // Payments-service не перезапускался: повтор результата после рестарта заказов безопасен.
  const repeated = await completePayment(result.data.id, 'succeeded');
  assert.equal(repeated.data.notificationStatus, 'published');
  assert.deepEqual((await api(ordersUrl, `/orders/${paid.id}`)).data, before);
});

test('в БД сохраняются снимок товара и связь позиции с заказом', async () => {
  const order = await createOrder();
  const rows = await database.query(
    `
    SELECT o.amount, o.currency, i.product_id, i.product_name, i.unit_price, i.quantity
    FROM orders o JOIN order_items i ON i.order_id = o.id WHERE o.id = $1
  `,
    [order.id],
  );
  assert.deepEqual(rows, [
    {
      amount: 100000,
      currency: 'RUB',
      product_id: 'backend-course',
      product_name: 'Учебный курс по бэкенду',
      unit_price: 50000,
      quantity: 2,
    },
  ]);
});

test('ошибка позиции откатывает весь заказ, ограничения работают без DTO', async () => {
  const { OrdersRepository } = requireOrders('./dist/orders.repository.js');
  const { OrderEntity } = requireOrders('./dist/database/entities/order.entity.js');
  const repository = new OrdersRepository(database.getRepository(OrderEntity));
  const before = await database.query('SELECT count(*)::integer AS count FROM orders');
  await assert.rejects(
    repository.create({
      productId: 'backend-course',
      productName: 'Курс',
      unitPrice: 50000,
      quantity: 11,
    }),
    /order_items_quantity_range/,
  );
  const after = await database.query('SELECT count(*)::integer AS count FROM orders');
  assert.deepEqual(after, before);

  await assert.rejects(
    database.query(
      `
    INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity)
    VALUES ($1, $2, 'test', 'Тест', 1, 1)
  `,
      [randomUUID(), randomUUID()],
    ),
    /foreign key constraint/,
  );
});

async function restartServices() {
  await Promise.all([stop(ordersProcess), stop(paymentsProcess), stop(providerProcess)]);
  ordersProcess = start('orders-service', 3101);
  paymentsProcess = start('payments-service', 3102);
  providerProcess = start('payment-provider-simulator', 3105);
  await Promise.all([ready(ordersUrl), ready(paymentsUrl), ready(providerUrl)]);
}

test('ключ, платёж и доставка переживают перезапуск обоих сервисов', async () => {
  const order = await createOrder();
  const headers = { 'Idempotency-Key': randomUUID() };
  const initial = await api(ordersUrl, `/orders/${order.id}/pay`, { method: 'sbp' }, headers);
  assert.equal(initial.status, 201);
  assert.equal('idempotencyKey' in initial.data, false);

  await restartServices();
  assert.deepEqual((await api(paymentsUrl, `/payments/${initial.data.id}`)).data, initial.data);
  const repeated = await api(ordersUrl, `/orders/${order.id}/pay`, { method: 'sbp' }, headers);
  assert.equal(repeated.status, 201);
  assert.equal(repeated.data.id, initial.data.id);
  assert.equal(
    (await api(ordersUrl, `/orders/${order.id}/pay`, { method: 'card' }, headers)).status,
    409,
  );

  const paid = await completePayment(initial.data.id, 'succeeded');
  assert.equal(paid.data.notificationStatus, 'published');
  await restartServices();
  const replay = await api(ordersUrl, `/orders/${order.id}/pay`, { method: 'sbp' }, headers);
  assert.equal(replay.status, 201);
  assert.deepEqual(replay.data, paid.data);
  assert.equal((await api(ordersUrl, `/orders/${order.id}`)).data.status, 'paid');
  assert.deepEqual((await api(ordersUrl, `/orders/${order.id}`)).data.paymentIds, [
    initial.data.id,
  ]);
  const changed = await api(
    ordersUrl,
    `/orders/${order.id}/pay`,
    { method: 'sbp' },
    { 'Idempotency-Key': randomUUID() },
  );
  assert.equal(changed.status, 409);
  const rows = await paymentsDatabase.query(
    'SELECT count(*)::integer AS count FROM payments WHERE order_id = $1',
    [order.id],
  );
  assert.equal(rows[0].count, 1);
});

test('две реплики сервисов не создают дубли ни с одним, ни с разными ключами', async () => {
  const replicaUrl = 'http://127.0.0.1:3104';
  const ordersReplicaUrl = 'http://127.0.0.1:3103';
  const replica = start('payments-service', 3104);
  const ordersReplica = start('orders-service', 3103, { PAYMENTS_SERVICE_URL: replicaUrl });
  try {
    await Promise.all([ready(replicaUrl), ready(ordersReplicaUrl)]);
    const order = await createOrder();
    const headers = { 'Idempotency-Key': randomUUID() };
    const throughOrders = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        api(
          index % 2 ? ordersUrl : ordersReplicaUrl,
          `/orders/${order.id}/pay`,
          { method: 'card' },
          headers,
        ),
      ),
    );
    throughOrders.forEach((result) => assert.equal(result.status, 201));
    assert.equal(new Set(throughOrders.map((result) => result.data.id)).size, 1);
    assert.equal((await api(ordersUrl, `/orders/${order.id}`)).data.paymentIds.length, 1);
    const dto = {
      orderId: randomUUID(),
      amount: 50000,
      currency: 'RUB',
      method: 'card',
      idempotencyKey: randomUUID(),
    };
    const sameKey = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        api(index % 2 ? paymentsUrl : replicaUrl, '/payments', dto, internal),
      ),
    );
    sameKey.forEach((result) => assert.equal(result.status, 201));
    assert.equal(new Set(sameKey.map((result) => result.data.id)).size, 1);

    const anotherOrder = randomUUID();
    const differentKeys = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        api(
          index % 2 ? paymentsUrl : replicaUrl,
          '/payments',
          { ...dto, orderId: anotherOrder, idempotencyKey: randomUUID() },
          internal,
        ),
      ),
    );
    assert.equal(differentKeys.filter((result) => result.status === 201).length, 1);
    assert.equal(differentKeys.filter((result) => result.status === 409).length, 11);
    const rows = await paymentsDatabase.query(
      'SELECT count(*)::integer AS count FROM payments WHERE order_id = $1',
      [anotherOrder],
    );
    assert.equal(rows[0].count, 1);
  } finally {
    await Promise.all([stop(replica), stop(ordersReplica)]);
  }
});

test(
  'очередь переживает остановку заказов и перезапуск брокера',
  { skip: skipBrokerFaults },
  async () => {
    const order = await createOrder();
    const headers = { 'Idempotency-Key': randomUUID() };
    const initial = await api(ordersUrl, `/orders/${order.id}/pay`, { method: 'card' }, headers);
    await stop(ordersProcess);
    const result = await completePayment(initial.data.id, 'succeeded', { waitForOrder: false });
    assert.equal(result.data.status, 'succeeded');
    assert.equal(result.data.notificationStatus, 'published');
    assert.equal(result.data.notificationAttempts, 1);

    assert.ok(
      (await withBroker((channel) => channel.checkQueue(queues.results))).messageCount >= 1,
    );
    try {
      await stopTestBroker();
    } finally {
      await startTestBroker();
      ordersProcess = start('orders-service', 3101);
      await ready(ordersUrl);
    }
    await awaitOrder(order.id, 'paid');
    assert.equal(
      (await api(paymentsUrl, `/payments/${initial.data.id}`)).data.notificationAttempts,
      1,
    );
  },
);

test('повтор запроса восстанавливает потерянную связь с платежом без создания нового', async () => {
  const order = await createOrder();
  const key = randomUUID();
  // Воспроизводим окно: payments-service сохранил запись, orders-service ещё не записал ID.
  const initial = await api(
    paymentsUrl,
    '/payments',
    {
      orderId: order.id,
      amount: order.amount,
      currency: 'RUB',
      method: 'card',
      idempotencyKey: key,
    },
    internal,
  );
  assert.equal(initial.status, 201);
  assert.deepEqual((await api(ordersUrl, `/orders/${order.id}`)).data.paymentIds, []);
  const earlyResult = await completePayment(initial.data.id, 'succeeded');
  assert.equal(earlyResult.data.notificationStatus, 'published');
  await restartServices();
  const replay = await api(
    ordersUrl,
    `/orders/${order.id}/pay`,
    { method: 'card' },
    { 'Idempotency-Key': key },
  );
  assert.equal(replay.status, 201);
  assert.equal(replay.data.id, initial.data.id);
  assert.equal(replay.data.status, 'succeeded');
  assert.deepEqual((await api(ordersUrl, `/orders/${order.id}`)).data.paymentIds, [
    initial.data.id,
  ]);
  assert.equal((await api(ordersUrl, `/orders/${order.id}`)).data.status, 'paid');
});

test('финальный статус защищён от гонки; повторные уведомления не теряют счётчик', async () => {
  const order = await createOrder();
  const initial = await api(
    ordersUrl,
    `/orders/${order.id}/pay`,
    { method: 'card' },
    { 'Idempotency-Key': randomUUID() },
  );
  const outcomes = await Promise.all(
    ['succeeded', 'failed'].map((status) => completePayment(initial.data.id, status)),
  );
  assert.equal(outcomes.filter((result) => result.status === 201).length, 1);
  assert.equal(outcomes.filter((result) => result.status === 409).length, 1);
  const winner = outcomes.find((result) => result.status === 201).data;
  assert.equal(winner.notificationStatus, 'published');
  await Promise.all(
    Array.from({ length: 5 }, () => completePayment(initial.data.id, winner.status)),
  );
  const saved = (await api(paymentsUrl, `/payments/${initial.data.id}`)).data;
  assert.equal(saved.status, winner.status);
  assert.equal(saved.notificationAttempts, 6);
  assert.equal(saved.notificationStatus, 'published');

  // Ошибка позднего повтора не отменяет уже доказанную доставку.
  await stop(ordersProcess);
  try {
    const failedRetry = await completePayment(initial.data.id, winner.status, {
      waitForOrder: false,
    });
    assert.equal(failedRetry.data.notificationStatus, 'published');
    assert.equal(failedRetry.data.notificationAttempts, 7);
  } finally {
    ordersProcess = start('orders-service', 3101);
    await ready(ordersUrl);
  }
});

test('ключ отклонённой попытки остаётся занят; один ключ можно использовать у разных заказов', async () => {
  const firstOrder = await createOrder();
  const secondOrder = await createOrder();
  const headers = { 'Idempotency-Key': randomUUID() };
  const first = await api(ordersUrl, `/orders/${firstOrder.id}/pay`, { method: 'card' }, headers);
  await completePayment(first.data.id, 'failed');
  const second = await api(ordersUrl, `/orders/${secondOrder.id}/pay`, { method: 'card' }, headers);
  assert.equal(second.status, 201);
  assert.notEqual(second.data.id, first.data.id);
  const next = await api(
    ordersUrl,
    `/orders/${firstOrder.id}/pay`,
    { method: 'crypto' },
    { 'Idempotency-Key': randomUUID() },
  );
  assert.equal(next.status, 201);
  await completePayment(next.data.id, 'succeeded');
  await restartServices();
  const replay = await api(ordersUrl, `/orders/${firstOrder.id}/pay`, { method: 'card' }, headers);
  assert.equal(replay.status, 201);
  assert.equal(replay.data.id, first.data.id);
  assert.equal(replay.data.status, 'failed');
  assert.equal((await api(ordersUrl, `/orders/${firstOrder.id}`)).data.status, 'paid');
  assert.equal(
    (await api(ordersUrl, `/orders/${firstOrder.id}/pay`, { method: 'sbp' }, headers)).status,
    409,
  );
});

test('ограничения payments защищают таблицу даже при прямом SQL', async () => {
  assert.equal(
    (await database.query("SELECT to_regclass('public.payments') AS table_name"))[0].table_name,
    null,
  );
  assert.equal(
    (await paymentsDatabase.query("SELECT to_regclass('public.orders') AS table_name"))[0]
      .table_name,
    null,
  );
  const dto = {
    orderId: randomUUID(),
    amount: 50000,
    currency: 'RUB',
    method: 'card',
    idempotencyKey: randomUUID(),
  };
  await api(paymentsUrl, '/payments', dto, internal);
  const insert = `INSERT INTO payments (id, order_id, idempotency_key, amount, currency, method, provider, status)
    VALUES ($1, $2, $3, $4, 'RUB', 'card', 'mock', $5)`;
  await assert.rejects(
    paymentsDatabase.query(insert, [
      randomUUID(),
      dto.orderId,
      dto.idempotencyKey,
      50000,
      'failed',
    ]),
    (error) => error.driverError.constraint === 'payments_order_key_unique',
  );
  await assert.rejects(
    paymentsDatabase.query(insert, [randomUUID(), dto.orderId, randomUUID(), 50000, 'pending']),
    (error) => error.driverError.constraint === 'payments_one_active_per_order',
  );
  await assert.rejects(
    paymentsDatabase.query(insert, [randomUUID(), randomUUID(), randomUUID(), -1, 'pending']),
    (error) => error.driverError.constraint === 'payments_amount_range',
  );
});

test('оплаченный заказ без старой записи платежа не допускает нового списания', async () => {
  const order = await createOrder();
  // Например, заказ остался с первого этапа, когда платежи ещё жили в Map.
  await database.query("UPDATE orders SET status = 'paid' WHERE id = $1", [order.id]);
  const result = await api(
    ordersUrl,
    `/orders/${order.id}/pay`,
    { method: 'card' },
    { 'Idempotency-Key': randomUUID() },
  );
  assert.equal(result.status, 409);
  const rows = await paymentsDatabase.query(
    'SELECT count(*)::integer AS count FROM payments WHERE order_id = $1',
    [order.id],
  );
  assert.equal(rows[0].count, 0);
});

function webhookHeaders(raw, timestamp = String(Math.floor(Date.now() / 1000))) {
  return {
    'content-type': 'application/json',
    'x-provider-timestamp': timestamp,
    'x-provider-signature': createHmac('sha256', webhookSecret)
      .update(`${timestamp}.${raw}`)
      .digest('hex'),
  };
}

test('webhook проверяет подпись, время, исходные байты и состояние провайдера', async () => {
  const order = await createOrder();
  const payment = (
    await api(
      ordersUrl,
      `/orders/${order.id}/pay`,
      { method: 'card' },
      { 'Idempotency-Key': randomUUID() },
    )
  ).data;
  assert.notEqual(payment.id, payment.providerPaymentId);
  assert.equal(
    (await api(paymentsUrl, `/payments/${payment.id}/mock-result`, { status: 'succeeded' })).status,
    404,
  );
  assert.equal((await api(providerUrl, '/provider/payments', {})).status, 401);
  const body = {
    eventId: randomUUID(),
    providerPaymentId: payment.providerPaymentId,
    merchantPaymentId: payment.id,
    amount: payment.amount,
    currency: 'RUB',
    status: 'succeeded',
  };
  const raw = JSON.stringify(body);
  assert.equal((await api(paymentsUrl, '/webhooks/simulator', body)).status, 401);
  assert.equal(
    (
      await api(
        paymentsUrl,
        '/webhooks/simulator',
        body,
        webhookHeaders(raw, String(Math.floor(Date.now() / 1000) - 600)),
      )
    ).status,
    401,
  );
  assert.equal(
    (await api(paymentsUrl, '/webhooks/simulator', { ...body, amount: 1 }, webhookHeaders(raw)))
      .status,
    401,
  );
  // Даже корректная подпись не заменяет проверку фактического состояния у провайдера.
  assert.equal(
    (await api(paymentsUrl, '/webhooks/simulator', body, webhookHeaders(raw))).status,
    409,
  );
  assert.equal((await api(paymentsUrl, `/payments/${payment.id}`)).data.status, 'pending');
  const remote = await api(
    providerUrl,
    `/provider/payments/${payment.providerPaymentId}/complete`,
    { status: 'succeeded', delivery: 'skip' },
  );
  body.eventId = remote.data.eventId;
  const pretty = JSON.stringify(body, null, 2);
  const response = await fetch(`${paymentsUrl}/webhooks/simulator`, {
    method: 'POST',
    headers: webhookHeaders(pretty),
    body: pretty,
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200);
  await awaitOrder(order.id, 'paid');
  assert.equal((await api(ordersUrl, `/orders/${order.id}`)).data.status, 'paid');
  assert.equal(
    (await api(paymentsUrl, '/webhooks/simulator', body, webhookHeaders(JSON.stringify(body))))
      .status,
    200,
  );
  assert.equal((await api(paymentsUrl, `/payments/${payment.id}`)).data.notificationAttempts, 2);
});

test('потерянный webhook восстанавливается сверкой с провайдером', async () => {
  const order = await createOrder();
  const payment = (
    await api(
      ordersUrl,
      `/orders/${order.id}/pay`,
      { method: 'sbp' },
      { 'Idempotency-Key': randomUUID() },
    )
  ).data;
  const remote = await api(
    providerUrl,
    `/provider/payments/${payment.providerPaymentId}/complete`,
    { status: 'succeeded', delivery: 'skip' },
  );
  assert.equal(remote.data.webhookAttempts, 0);
  assert.equal((await api(paymentsUrl, `/payments/${payment.id}`)).data.status, 'pending');
  await restartServices();
  const synced = await api(paymentsUrl, `/payments/${payment.id}/sync`, {});
  assert.equal(synced.status, 200);
  assert.equal(synced.data.status, 'succeeded');
  assert.equal((await api(ordersUrl, `/orders/${order.id}`)).data.status, 'paid');
});

test('таймаут после создания у провайдера не создаёт вторую внешнюю операцию', async () => {
  const order = await createOrder();
  const headers = { 'Idempotency-Key': randomUUID() };
  await api(providerUrl, '/simulation/next-create', { delayMs: 2500 });
  const first = await api(ordersUrl, `/orders/${order.id}/pay`, { method: 'card' }, headers);
  assert.equal(first.status, 502);
  const localRows = await paymentsDatabase.query(
    'SELECT id, provider_payment_id FROM payments WHERE order_id = $1',
    [order.id],
  );
  assert.equal(localRows.length, 1);
  assert.equal(localRows[0].provider_payment_id, null);
  const remoteRows = await providerDatabase.query(
    'SELECT id FROM invoices WHERE merchant_payment_id = $1',
    [localRows[0].id],
  );
  assert.equal(remoteRows.length, 1);
  const retry = await api(ordersUrl, `/orders/${order.id}/pay`, { method: 'card' }, headers);
  assert.equal(retry.status, 201);
  assert.equal(retry.data.id, localRows[0].id);
  assert.equal(retry.data.providerPaymentId, remoteRows[0].id);
  await restartServices();
  const again = await api(ordersUrl, `/orders/${order.id}/pay`, { method: 'card' }, headers);
  assert.equal(again.data.providerPaymentId, remoteRows[0].id);
  assert.equal(
    (
      await providerDatabase.query(
        'SELECT count(*)::integer AS count FROM invoices WHERE merchant_payment_id = $1',
        [localRows[0].id],
      )
    )[0].count,
    1,
  );
});

test('задержанные и повторные webhooks не создают повторную оплату', async () => {
  const order = await createOrder();
  const payment = (
    await api(
      ordersUrl,
      `/orders/${order.id}/pay`,
      { method: 'crypto' },
      { 'Idempotency-Key': randomUUID() },
    )
  ).data;
  const result = await completePayment(payment.id, 'succeeded', { delayMs: 200, copies: 3 });
  assert.equal(result.data.notificationAttempts, 3);
  assert.equal(result.data.status, 'succeeded');
  assert.deepEqual((await api(ordersUrl, `/orders/${order.id}`)).data.paymentIds, [payment.id]);
  const remote = await api(
    providerUrl,
    `/provider/payments/${payment.providerPaymentId}`,
    undefined,
    providerHeaders,
  );
  assert.equal(remote.data.webhookAttempts, 3);
  assert.equal(remote.data.webhookStatus, 'delivered');
});

function resultEvent(order, overrides = {}) {
  return {
    eventId: randomUUID(),
    type: 'payment.succeeded',
    version: 1,
    paymentId: randomUUID(),
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

async function publishEvent(event) {
  await testBus.publish(queues.results, Buffer.from(JSON.stringify(event)), {
    messageId: event.eventId,
  });
}

test('дубликаты события безопасны, а consumer не требует работающего payments-service', async () => {
  const order = await createOrder();
  const event = resultEvent(order);
  await stop(paymentsProcess);
  try {
    await publishEvent(event);
    await awaitOrder(order.id, 'paid');
    await publishEvent(event);
    await eventually(
      async () =>
        (await withBroker((channel) => channel.checkQueue(queues.results))).messageCount === 0,
      'очередь опустела',
    );
    const saved = (await api(ordersUrl, `/orders/${order.id}`)).data;
    assert.deepEqual(saved.paymentIds, [event.paymentId]);
    assert.equal(saved.status, 'paid');
  } finally {
    paymentsProcess = start('payments-service', 3102);
    await ready(paymentsUrl);
  }
});

test('невалидный JSON, версия и неверная сумма уходят в DLQ, не меняя заказ', async () => {
  const order = await createOrder();
  const invalidVersion = resultEvent(order, { version: 99 });
  const invalidAmount = resultEvent(order, { amount: 1 });
  const brokenId = randomUUID();
  await testBus.publish(queues.results, Buffer.from('not-json'), { messageId: brokenId });
  await publishEvent(invalidVersion);
  await publishEvent(invalidAmount);
  const expected = new Set([brokenId, invalidVersion.eventId, invalidAmount.eventId]);
  const seen = new Set();
  await eventually(async () => {
    await withBroker(async (channel) => {
      let message;
      while ((message = await channel.get(queues.dead, { noAck: false }))) {
        if (expected.has(message.properties.messageId)) {
          assert.ok(message.properties.headers['x-lab-error']);
          seen.add(message.properties.messageId);
        }
        channel.ack(message);
      }
    });
    return seen.size === expected.size;
  }, 'некорректные сообщения в DLQ');
  assert.equal((await api(ordersUrl, `/orders/${order.id}`)).data.status, 'pending');
});

test('временная ошибка SQL уходит в отложенный повтор и восстанавливается после исправления', async () => {
  const order = await createOrder();
  const event = resultEvent(order);
  // Изменяется только одноразовая тестовая БД, не dev-таблицы и не контейнер с tmpfs.
  await database.query('ALTER TABLE orders RENAME TO orders_temporarily_unavailable');
  try {
    await publishEvent(event);
    await eventually(
      async () =>
        (await withBroker((channel) => channel.checkQueue(queues.retry))).messageCount > 0,
      'сообщение в retry',
    );
  } finally {
    await database.query('ALTER TABLE orders_temporarily_unavailable RENAME TO orders');
  }
  await awaitOrder(order.id, 'paid');
  assert.deepEqual((await api(ordersUrl, `/orders/${order.id}`)).data.paymentIds, [
    event.paymentId,
  ]);
});

test('после лимита временных ошибок сообщение помещается в DLQ', async () => {
  const order = await createOrder();
  const event = resultEvent(order);
  await database.query('ALTER TABLE orders RENAME TO orders_temporarily_unavailable');
  try {
    await testBus.publish(queues.results, Buffer.from(JSON.stringify(event)), {
      messageId: event.eventId,
      headers: { 'x-lab-retry-count': 5 },
    });
    await eventually(
      async () =>
        withBroker(async (channel) => {
          const message = await channel.get(queues.dead, { noAck: false });
          if (!message) return false;
          channel.ack(message);
          return message.properties.messageId === event.eventId;
        }),
      'исчерпавшее повторы сообщение в DLQ',
    );
  } finally {
    await database.query('ALTER TABLE orders_temporarily_unavailable RENAME TO orders');
  }
  assert.equal((await api(ordersUrl, `/orders/${order.id}`)).data.status, 'pending');
});

test('mandatory отклоняет публикацию без очереди, даже если брокер прислал confirm', async () => {
  await assert.rejects(testBus.publish(`${queuePrefix}.missing`, Buffer.from('{}')), /mandatory/);
});

test(
  'без outbox падение брокера требует ручной сверки; успешный платёж не теряется',
  { skip: skipBrokerFaults },
  async () => {
    const order = await createOrder();
    const payment = (
      await api(
        ordersUrl,
        `/orders/${order.id}/pay`,
        { method: 'card' },
        { 'Idempotency-Key': randomUUID() },
      )
    ).data;
    try {
      await stopTestBroker();
      const result = await completePayment(payment.id, 'succeeded', { waitForOrder: false });
      assert.equal(result.data.status, 'succeeded');
      assert.equal(result.data.notificationStatus, 'failed');
      assert.ok(result.data.resultEventId);
      assert.equal((await api(ordersUrl, `/orders/${order.id}`)).data.status, 'pending');
    } finally {
      await startTestBroker();
      await Promise.all([ready(ordersUrl), ready(paymentsUrl)]);
    }
    await delay(300);
    assert.equal((await api(ordersUrl, `/orders/${order.id}`)).data.status, 'pending');
    const recovered = await api(paymentsUrl, `/payments/${payment.id}/sync`, {});
    assert.equal(recovered.data.notificationStatus, 'published');
    await awaitOrder(order.id, 'paid');
  },
);

async function stopTestBroker() {
  if (controlledBrokerContainer) await run('docker', ['stop', controlledBrokerContainer]);
  else await run('docker', ['compose', '--profile', 'test', 'stop', 'rabbitmq-test']);
}

async function startTestBroker() {
  if (controlledBrokerContainer) await run('docker', ['start', controlledBrokerContainer]);
  else await run('docker', ['compose', '--profile', 'test', 'up', '-d', '--wait', 'rabbitmq-test']);
  await eventually(
    async () => {
      try {
        return await withBroker(async () => true);
      } catch {
        return false;
      }
    },
    'RabbitMQ после перезапуска',
    30000,
  );
}
