import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { after, before, test } from 'node:test';

// Тесты запускают настоящие независимые процессы на отдельных портах, без dev-серверов.
const ordersUrl = 'http://127.0.0.1:3101';
const paymentsUrl = 'http://127.0.0.1:3102';
const token = randomUUID();
const internal = { 'x-internal-token': token };
const children = [];
let output = '';
let ordersProcess;
let database;
let adminDatabase;
let databaseCreated = false;
const databaseName = `orders_test_${randomUUID().replaceAll('-', '')}`;
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://orders_test:orders_test_local@127.0.0.1:15433/orders_test';
const isolatedDatabaseUrl = new URL(testDatabaseUrl);
isolatedDatabaseUrl.pathname = `/${databaseName}`;

// Разрешаем зависимости в контексте orders-service, а не полагаемся на hoisting.
const requireOrders = createRequire(
  new URL('../apps/orders-service/package.json', import.meta.url),
);
const { DataSource } = requireOrders('typeorm');
const { databaseOptions } = requireOrders('./dist/database/database-options.js');

async function api(base, path, body, headers = {}) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, data: await response.json() };
}

function start(service, port) {
  const child = spawn(process.execPath, [`apps/${service}/dist/main.js`], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      ORDERS_SERVICE_URL: ordersUrl,
      PAYMENTS_SERVICE_URL: paymentsUrl,
      INTERNAL_API_TOKEN: token,
      DATABASE_URL: isolatedDatabaseUrl.toString(),
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
  for (let i = 0; i < 100; i++) {
    try {
      if ((await api(base, '/health')).status === 200) return;
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
  ordersProcess = start('orders-service', 3101);
  start('payments-service', 3102);
  await Promise.all([ready(ordersUrl), ready(paymentsUrl)]);
});

after(async () => {
  await Promise.all(children.map(stop));
  if (database?.isInitialized) await database.destroy();
  if (adminDatabase?.isInitialized) {
    if (databaseCreated) await adminDatabase.query(`DROP DATABASE "${databaseName}"`);
    await adminDatabase.destroy();
  }
});

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

  const paid = await api(paymentsUrl, `/payments/${payment.id}/mock-result`, {
    status: 'succeeded',
  });
  assert.equal(paid.status, 201);
  assert.equal(paid.data.notificationStatus, 'delivered');
  assert.equal((await api(ordersUrl, `/orders/${order.id}`)).data.status, 'paid');

  const duplicate = await api(paymentsUrl, `/payments/${payment.id}/mock-result`, {
    status: 'succeeded',
  });
  assert.equal(duplicate.data.notificationStatus, 'delivered');
  assert.equal(duplicate.data.notificationAttempts, 2);
  assert.equal((await api(ordersUrl, `/orders/${order.id}`)).data.paymentIds.length, 1);
  const repeated = await api(ordersUrl, `/orders/${order.id}/pay`, { method: 'sbp' }, headers);
  assert.equal(repeated.data.status, 'succeeded');
  assert.equal(
    (await api(paymentsUrl, `/payments/${payment.id}/mock-result`, { status: 'failed' })).status,
    409,
  );
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
  const failed = await api(paymentsUrl, `/payments/${first.data.id}/mock-result`, {
    status: 'failed',
  });
  assert.equal(failed.data.notificationStatus, 'delivered');
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
  assert.equal((await api(ordersUrl, '/internal/payment-results', {})).status, 401);
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

test('сбой доставки не отменяет платёж; повтор восстанавливает заказ', async () => {
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
    const result = await api(paymentsUrl, `/payments/${payment.data.id}/mock-result`, {
      status: 'succeeded',
    });
    assert.equal(result.data.status, 'succeeded');
    assert.equal(result.data.notificationStatus, 'failed');
  } finally {
    ordersProcess.kill('SIGCONT');
  }
  const retry = await api(paymentsUrl, `/payments/${payment.data.id}/mock-result`, {
    status: 'succeeded',
  });
  assert.equal(retry.data.notificationStatus, 'delivered');
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
  const notification = await api(paymentsUrl, `/payments/${result.data.id}/mock-result`, {
    status: 'succeeded',
  });
  assert.equal(notification.data.notificationStatus, 'delivered');
  const before = (await api(ordersUrl, `/orders/${paid.id}`)).data;

  await stop(ordersProcess);
  ordersProcess = start('orders-service', 3101);
  await ready(ordersUrl);
  assert.deepEqual((await api(ordersUrl, `/orders/${unpaid.id}`)).data, unpaid);
  assert.deepEqual((await api(ordersUrl, `/orders/${paid.id}`)).data, before);
  assert.equal(before.status, 'paid');
  assert.deepEqual(before.paymentIds, [result.data.id]);

  // Payments-service не перезапускался: повтор результата после рестарта заказов безопасен.
  const repeated = await api(paymentsUrl, `/payments/${result.data.id}/mock-result`, {
    status: 'succeeded',
  });
  assert.equal(repeated.data.notificationStatus, 'delivered');
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
