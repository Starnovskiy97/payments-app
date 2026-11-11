import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { CreatePaymentDto, ProviderWebhookDto } from './dto';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type ProviderPayment,
} from './providers/payment-provider';
import { PaymentsRepository, type Payment } from './payments.repository';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly orders = axios.create({
    baseURL: process.env.ORDERS_SERVICE_URL ?? 'http://127.0.0.1:3001',
    timeout: 3000,
    headers: { 'x-internal-token': process.env.INTERNAL_API_TOKEN ?? 'local-learning-only' },
  });

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly payments: PaymentsRepository,
  ) {}

  get(id: string) {
    return this.payments.get(id);
  }

  lookup(dto: CreatePaymentDto) {
    return this.payments.lookup(dto);
  }

  async create(dto: CreatePaymentDto) {
    // Сначала долговечное намерение, затем внешний запрос с нашим ID как ключом.
    const payment = await this.payments.create(dto, this.provider.name);
    return this.sync(payment.id);
  }

  async sync(id: string) {
    const payment = await this.get(id);
    this.assertProvider(payment);
    const remote = payment.providerPaymentId
      ? await this.provider.get(payment.providerPaymentId)
      : await this.provider.create(payment);
    this.assertRemote(payment, remote);
    await this.payments.attachProvider(id, remote.id, remote.checkoutUrl);
    if (remote.status !== 'pending') await this.applyResult(id, remote.status);
    return this.get(id);
  }

  async handleWebhook(dto: ProviderWebhookDto) {
    const payment = await this.get(dto.merchantPaymentId);
    this.assertProvider(payment);
    // Подпись проверена guard. Дополнительно сверяем факт с API провайдера.
    const remote = await this.provider.get(dto.providerPaymentId);
    this.assertRemote(payment, remote);
    if (
      remote.id !== dto.providerPaymentId ||
      remote.amount !== dto.amount ||
      remote.currency !== dto.currency ||
      remote.status !== dto.status
    ) {
      throw new ConflictException('Webhook расходится с состоянием провайдера');
    }
    await this.payments.attachProvider(payment.id, remote.id, remote.checkoutUrl);
    await this.applyResult(payment.id, dto.status);
    return { received: true, eventId: dto.eventId };
  }

  private assertProvider(payment: Payment) {
    if (payment.provider !== this.provider.name) {
      throw new ConflictException(
        'Платёж относится к старому или неподдерживаемому провайдеру. Для нового эксперимента создайте заказ',
      );
    }
  }

  private assertRemote(payment: Payment, remote: ProviderPayment) {
    const publicOrigin = new URL(process.env.PROVIDER_PUBLIC_URL ?? 'http://localhost:3003').origin;
    if (
      remote.merchantPaymentId !== payment.id ||
      remote.amount !== payment.amount ||
      remote.currency !== payment.currency ||
      remote.method !== payment.method ||
      (payment.providerPaymentId !== null && payment.providerPaymentId !== remote.id) ||
      new URL(remote.checkoutUrl).origin !== publicOrigin ||
      !['pending', 'succeeded', 'failed'].includes(remote.status)
    ) {
      throw new ConflictException('Ответ провайдера не соответствует нашему платежу');
    }
  }

  private async applyResult(id: string, status: ProviderWebhookDto['status']) {
    const payment = await this.payments.recordResult(id, status);
    await this.notifyOrder(payment);
  }

  private async notifyOrder(payment: Payment) {
    let delivered = false;
    try {
      await this.orders.post('/internal/payment-results', {
        paymentId: payment.id,
        orderId: payment.orderId,
        status: payment.status,
      });
      delivered = true;
      this.logger.log(`Результат платежа ${payment.id} доставлен в orders-service`);
    } catch {
      // Оплата и доставка уведомления — разные факты. Ошибка доставки не отменяет оплату.
      this.logger.warn(
        `Результат платежа ${payment.id} не доставлен. Повторите учебное уведомление`,
      );
    }
    // Ошибка записи доставки не должна выглядеть как ошибка HTTP-вызова.
    await this.payments.recordDelivery(payment.id, delivered);
  }
}
