export interface PaymentResultEvent {
  eventId: string;
  type: 'payment.succeeded' | 'payment.failed';
  version: 1;
  paymentId: string;
  orderId: string;
  amount: number;
  currency: 'RUB';
  occurredAt: string;
}

export class PermanentMessageError extends Error {}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fields = new Set([
  'eventId',
  'type',
  'version',
  'paymentId',
  'orderId',
  'amount',
  'currency',
  'occurredAt',
]);

// Типы TS не проверяют JSON из очереди. Чужие версии и неверные данные не повторяем бесконечно.
export function parsePaymentResult(content: Buffer): PaymentResultEvent {
  if (content.length > 64 * 1024) throw new PermanentMessageError('Сообщение больше 64 KiB');
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(content.toString('utf8'));
  } catch {
    throw new PermanentMessageError('Некорректный JSON');
  }
  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data) ||
    Object.keys(data).some((key) => !fields.has(key)) ||
    data.version !== 1 ||
    !['payment.succeeded', 'payment.failed'].includes(String(data.type)) ||
    !['eventId', 'paymentId', 'orderId'].every(
      (key) => typeof data[key] === 'string' && uuid.test(data[key] as string),
    ) ||
    !Number.isSafeInteger(data.amount) ||
    Number(data.amount) < 1 ||
    Number(data.amount) > 100000000 ||
    data.currency !== 'RUB' ||
    typeof data.occurredAt !== 'string' ||
    !Number.isFinite(Date.parse(data.occurredAt))
  ) {
    throw new PermanentMessageError('Неподдерживаемый контракт payment result v1');
  }
  return data as unknown as PaymentResultEvent;
}
