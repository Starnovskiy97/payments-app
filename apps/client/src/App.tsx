import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowRight, Code2, CreditCard, FlaskConical, RefreshCw, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { errorMessage, ordersApi, paymentsApi, providerApi, requestLog } from '@/lib/api';
import type { Method, Order, Payment, Product } from './types';

const money = (amount: number) =>
  new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(amount / 100);
const methodNames: Record<Method, string> = {
  card: 'Банковская карта',
  sbp: 'СБП',
  crypto: 'Криптовалюта',
};
const statusNames = {
  pending: 'Ожидает оплаты',
  paid: 'Оплачен',
  succeeded: 'Успешно',
  failed: 'Отклонён',
};

function Status({ value }: { value: keyof typeof statusNames }) {
  return (
    <Badge
      variant="outline"
      className={
        value === 'paid' || value === 'succeeded'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
          : value === 'failed'
            ? 'border-rose-200 bg-rose-50 text-rose-800'
            : 'border-amber-200 bg-amber-50 text-amber-800'
      }
    >
      {statusNames[value]}
    </Badge>
  );
}

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [selectedId, setSelectedId] = useState('');
  const [method, setMethod] = useState<Method>('card');
  const [payment, setPayment] = useState<Payment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const attempts = useRef(new Map<string, { key: string; method: Method }>());
  const logs = useSyncExternalStore(requestLog.subscribe, requestLog.getSnapshot);
  const selected = orders.find((order) => order.id === selectedId);
  const latestPaymentId = selected?.paymentIds.at(-1);
  const product = products.find((item) => item.id === productId);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      ordersApi.get<Product[]>('/products', { signal: controller.signal }),
      ordersApi.get<Order[]>('/orders', { signal: controller.signal }),
    ])
      .then(([catalog, list]) => {
        setProducts(catalog.data);
        setProductId(catalog.data[0]?.id ?? '');
        setOrders(list.data);
        setSelectedId(list.data[0]?.id ?? '');
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(cause));
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!latestPaymentId) return;
    let cancelled = false;
    paymentsApi
      .get<Payment>(`/payments/${latestPaymentId}`)
      .then(({ data }) => {
        if (!cancelled) acceptPayment(data);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorMessage(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, latestPaymentId]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function refresh(paymentId = payment?.id) {
    const [list, currentPayment] = await Promise.all([
      ordersApi.get<Order[]>('/orders'),
      paymentId ? paymentsApi.get<Payment>(`/payments/${paymentId}`) : Promise.resolve(null),
    ]);
    setOrders(list.data);
    setSelectedId((id) => id || list.data[0]?.id || '');
    if (currentPayment) acceptPayment(currentPayment.data);
    if (products.length === 0) {
      const catalog = await ordersApi.get<Product[]>('/products');
      setProducts(catalog.data);
      setProductId(catalog.data[0]?.id ?? '');
    }
  }

  function createOrder() {
    void run(async () => {
      const { data } = await ordersApi.post<Order>('/orders', { productId, quantity });
      setPayment(null);
      setSelectedId(data.id);
      setOrders((list) => [data, ...list]);
    });
  }

  function pay() {
    if (!selected) return;
    void run(async () => {
      let attempt = attempts.current.get(selected.id);
      if (!attempt) {
        attempt = { key: crypto.randomUUID(), method };
        attempts.current.set(selected.id, attempt);
      }
      const { data } = await ordersApi.post<Payment>(
        `/orders/${selected.id}/pay`,
        { method: attempt.method },
        { headers: { 'Idempotency-Key': attempt.key } },
      );
      acceptPayment(data);
      await refresh(data.id);
    });
  }

  function acceptPayment(data: Payment) {
    if (data.status === 'failed') attempts.current.delete(data.orderId);
    setPayment(data);
  }

  function syncPayment() {
    if (!payment) return;
    void run(async () => {
      const { data } = await paymentsApi.post<Payment>(`/payments/${payment.id}/sync`);
      acceptPayment(data);
      await refresh(data.id);
    });
  }

  function delayNextCreate() {
    void run(async () => {
      await providerApi.post('/simulation/next-create', { delayMs: 2500 });
      setNotice(
        'Следующий запрос к симулятору сохранит платёж, но задержит ответ на 2,5 с. После ошибки повторите тот же ключ.',
      );
    });
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            <FlaskConical size={17} /> Backend learning playground
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Payments Lab</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Заказ → платёж → уведомление → обновление заказа
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <a
            className="text-muted-foreground underline underline-offset-4 hover:text-primary"
            href="http://127.0.0.1:3001/docs"
            target="_blank"
            rel="noreferrer"
          >
            Orders API ↗
          </a>
          <a
            className="text-muted-foreground underline underline-offset-4 hover:text-primary"
            href="http://127.0.0.1:3002/docs"
            target="_blank"
            rel="noreferrer"
          >
            Payments API ↗
          </a>
          <Button variant="outline" disabled={busy} onClick={() => void run(() => refresh())}>
            <RefreshCw className="size-4" />
            Обновить
          </Button>
        </div>
      </header>

      <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>Тестовая среда.</strong> Все способы оплаты фиктивные. Банки, СБП и блокчейн не
        подключены; реальные деньги не используются.
      </div>
      {error && (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
        >
          {error}
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {[
          ['Заказов создано', orders.length],
          ['Ожидают оплаты', orders.filter((o) => o.status === 'pending').length],
          ['Оплачено', orders.filter((o) => o.status === 'paid').length],
        ].map(([label, count]) => (
          <div key={label} className="rounded-xl border bg-white px-5 py-4">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold">{count}</p>
          </div>
        ))}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShoppingBag className="size-5 text-primary" />
                Новый заказ
              </CardTitle>
              <CardDescription>Цена берётся из каталога на сервере.</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  createOrder();
                }}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <label htmlFor="product" className="text-sm font-medium">
                    Товар
                  </label>
                  <select
                    id="product"
                    value={productId}
                    onChange={(e) => setProductId(e.target.value)}
                    disabled={busy || !products.length}
                  >
                    {products.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {money(item.price)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end gap-4">
                  <div className="w-24 space-y-2">
                    <label htmlFor="quantity" className="text-sm font-medium">
                      Количество
                    </label>
                    <Input
                      id="quantity"
                      type="number"
                      min={1}
                      max={10}
                      required
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.valueAsNumber)}
                      disabled={busy}
                    />
                  </div>
                  <div className="pb-2 text-sm text-muted-foreground">
                    Итого:{' '}
                    <strong className="text-foreground">
                      {money((product?.price ?? 0) * (Number.isFinite(quantity) ? quantity : 0))}
                    </strong>
                  </div>
                </div>
                <Button type="submit" disabled={busy || !productId}>
                  Создать заказ
                  <ArrowRight className="size-4" />
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Заказы</CardTitle>
              <CardDescription>Выберите заказ, чтобы перейти к оплате.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {!orders.length && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Пока пусто. Создайте первый заказ выше.
                </p>
              )}
              {orders.map((order) => (
                <button
                  key={order.id}
                  disabled={busy}
                  onClick={() => {
                    if (order.id !== selectedId) {
                      setSelectedId(order.id);
                      setPayment(null);
                    }
                    setError('');
                  }}
                  aria-pressed={order.id === selectedId}
                  className={`w-full rounded-lg border p-4 text-left transition-colors disabled:opacity-60 ${order.id === selectedId ? 'border-primary bg-teal-50/60' : 'hover:bg-muted'}`}
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{order.productName}</span>
                    <Status value={order.status} />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>
                      #{order.id.slice(0, 8)} · {order.quantity} шт.
                    </span>
                    <span className="font-semibold text-foreground">{money(order.amount)}</span>
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="size-5 text-primary" />
              Оплата и симулятор
            </CardTitle>
            <CardDescription>Наш платёж и отдельная система провайдера.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {!selected ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Создайте или выберите заказ.
              </p>
            ) : (
              <>
                <div className="rounded-lg bg-muted p-4 text-sm">
                  <p className="mb-1 font-medium">{selected.productName}</p>
                  <p className="break-all font-mono text-xs text-muted-foreground">{selected.id}</p>
                  <div className="mt-3 flex items-center justify-between">
                    <strong>{money(selected.amount)}</strong>
                    <Status value={selected.status} />
                  </div>
                </div>
                <div className="space-y-2">
                  <label htmlFor="method" className="text-sm font-medium">
                    Способ оплаты <span className="text-muted-foreground">(имитация)</span>
                  </label>
                  <select
                    id="method"
                    value={attempts.current.get(selected.id)?.method ?? method}
                    onChange={(e) => setMethod(e.target.value as Method)}
                    disabled={
                      busy ||
                      selected.status === 'paid' ||
                      !!attempts.current.get(selected.id) ||
                      payment?.status === 'pending'
                    }
                  >
                    {Object.entries(methodNames).map(([value, name]) => (
                      <option key={value} value={value}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  className="w-full"
                  disabled={
                    busy ||
                    selected.status === 'paid' ||
                    (!!latestPaymentId && !payment) ||
                    payment?.status === 'pending' ||
                    payment?.status === 'succeeded'
                  }
                  onClick={pay}
                >
                  {attempts.current.has(selected.id) && !payment
                    ? 'Повторить запрос с тем же ключом'
                    : 'Создать платёж'}
                </Button>
                {payment && payment.orderId === selected.id && (
                  <div className="space-y-4 border-t pt-5">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold">
                        Платёж · {methodNames[payment.method]}
                      </h3>
                      <Status value={payment.status} />
                    </div>
                    <p className="break-all font-mono text-xs text-muted-foreground">
                      Наш ID: {payment.id}
                    </p>
                    <p className="break-all font-mono text-xs text-muted-foreground">
                      ID провайдера: {payment.providerPaymentId ?? 'ещё не получен'}
                    </p>
                    <div className="rounded-lg border border-dashed p-4">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Результат приходит от внешнего симулятора
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {payment.checkoutUrl && (
                          <Button size="sm" asChild>
                            <a href={payment.checkoutUrl} target="_blank" rel="noreferrer">
                              Открыть страницу оплаты ↗
                            </a>
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy || payment.provider !== 'simulator'}
                          onClick={syncPayment}
                        >
                          <RefreshCw className="size-4" />
                          Сверить с провайдером
                        </Button>
                      </div>
                    </div>
                    <p
                      className={`text-xs ${payment.notificationStatus === 'failed' ? 'text-rose-700' : 'text-muted-foreground'}`}
                    >
                      Публикация события в RabbitMQ:{' '}
                      <strong>
                        {payment.notificationStatus === 'published'
                          ? 'брокер подтвердил приём'
                          : payment.notificationStatus === 'delivered'
                            ? 'старое HTTP-уведомление доставлено'
                            : payment.notificationStatus === 'failed'
                              ? 'публикация не подтверждена — выполните сверку'
                              : 'ещё не отправлено'}
                      </strong>
                      . Попыток: {payment.notificationAttempts}. Это не подтверждение обработки
                      заказа.
                    </p>
                  </div>
                )}
                <p className="text-xs leading-relaxed text-muted-foreground">
                  При сетевой ошибке повтор используется с тем же Idempotency-Key. После отказа
                  можно создать новую попытку. Заказы, платежи и ключи сохраняются в отдельных
                  PostgreSQL и переживают перезапуск сервисов. Доставку событий между платежами и
                  заказами теперь выполняет RabbitMQ. При недоступном брокере пока требуется ручная
                  сверка: outbox ещё не добавлен.
                </p>
                <Button variant="outline" size="sm" disabled={busy} onClick={delayNextCreate}>
                  Следующее создание: потерять ответ
                </Button>
                {notice && (
                  <p role="status" className="text-sm text-primary">
                    {notice}
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Code2 className="size-5 text-primary" />
              Журнал HTTP-запросов
            </CardTitle>
            <CardDescription>
              Запросы браузера через Axios. Внутренние вызовы между сервисами видны в терминале.
            </CardDescription>
          </div>
          <Button size="sm" variant="ghost" onClick={requestLog.clear}>
            Очистить
          </Button>
        </CardHeader>
        <CardContent className="max-h-96 space-y-2 overflow-auto">
          {!logs.length && (
            <p className="py-4 text-sm text-muted-foreground">
              Здесь появятся запросы и ответы API.
            </p>
          )}
          {logs.map((entry) => (
            <details key={entry.id} className="rounded-lg border text-xs">
              <summary className="flex cursor-pointer flex-wrap items-center gap-3 p-3">
                <span className="text-muted-foreground">{entry.time}</span>
                <span className="font-mono font-bold text-primary">{entry.method}</span>
                <span className="min-w-0 flex-1 break-all font-mono">{entry.url}</span>
                <span
                  className={
                    typeof entry.status === 'number' && entry.status < 400
                      ? 'font-semibold text-emerald-700'
                      : 'font-semibold text-rose-700'
                  }
                >
                  {entry.status}
                </span>
              </summary>
              <div className="space-y-3 border-t bg-slate-50 p-3">
                {entry.request != null && (
                  <div>
                    <p className="mb-1 font-semibold">Запрос</p>
                    <pre className="overflow-auto">{JSON.stringify(entry.request, null, 2)}</pre>
                  </div>
                )}
                <div>
                  <p className="mb-1 font-semibold">Ответ</p>
                  <pre className="overflow-auto">{JSON.stringify(entry.response, null, 2)}</pre>
                </div>
              </div>
            </details>
          ))}
        </CardContent>
      </Card>
      <footer className="py-6 text-center text-xs text-muted-foreground">
        NestJS + RabbitMQ · Consumer ack после COMMIT · Outbox — следующий этап
      </footer>
    </main>
  );
}
