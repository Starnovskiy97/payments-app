import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { CreatePaymentDto, MockResultDto } from './dto';
import { MockPaymentProvider } from './mock-payment.provider';
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
    private readonly provider: MockPaymentProvider,
    private readonly payments: PaymentsRepository,
  ) {}

  get(id: string) {
    return this.payments.get(id);
  }

  lookup(dto: CreatePaymentDto) {
    return this.payments.lookup(dto);
  }

  async create(dto: CreatePaymentDto) {
    const payment = await this.payments.create(dto, this.provider.create().provider);
    this.logger.log(
      `Создан или повторно получен mock-платёж ${payment.id} для заказа ${payment.orderId}`,
    );
    return payment;
  }

  async simulate(id: string, dto: MockResultDto) {
    const payment = await this.payments.recordResult(id, dto.status);
    await this.notifyOrder(payment);
    return this.get(id);
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
