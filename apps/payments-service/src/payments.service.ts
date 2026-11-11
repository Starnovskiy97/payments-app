import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { CreatePaymentDto, MockResultDto } from './dto';
import { MockPaymentProvider } from './mock-payment.provider';

interface Payment {
  id: string;
  orderId: string;
  amount: number;
  currency: 'RUB';
  method: CreatePaymentDto['method'];
  provider: string;
  status: 'pending' | 'succeeded' | 'failed';
  notificationStatus: 'not_sent' | 'delivered' | 'failed';
  notificationAttempts: number;
  createdAt: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly payments = new Map<string, Payment>();
  private readonly keys = new Map<string, { fingerprint: string; paymentId: string }>();
  private readonly orders = axios.create({
    baseURL: process.env.ORDERS_SERVICE_URL ?? 'http://127.0.0.1:3001',
    timeout: 3000,
    headers: { 'x-internal-token': process.env.INTERNAL_API_TOKEN ?? 'local-learning-only' },
  });

  constructor(private readonly provider: MockPaymentProvider) {}

  get(id: string) {
    const payment = this.payments.get(id);
    if (!payment) throw new NotFoundException('Платёж не найден');
    return payment;
  }

  create(dto: CreatePaymentDto) {
    const key = `${dto.orderId}:${dto.idempotencyKey}`;
    const fingerprint = JSON.stringify([dto.orderId, dto.amount, dto.currency, dto.method]);
    const previous = this.keys.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new ConflictException('Idempotency-Key уже использован с другими данными');
      return this.get(previous.paymentId);
    }
    const active = [...this.payments.values()].find(
      (p) => p.orderId === dto.orderId && p.status !== 'failed',
    );
    if (active) throw new ConflictException('У заказа уже есть незавершённый или успешный платёж');
    const payment: Payment = {
      id: randomUUID(),
      orderId: dto.orderId,
      amount: dto.amount,
      currency: dto.currency,
      method: dto.method,
      ...this.provider.create(),
      notificationStatus: 'not_sent',
      notificationAttempts: 0,
      createdAt: new Date().toISOString(),
    };
    this.payments.set(payment.id, payment);
    this.keys.set(key, { fingerprint, paymentId: payment.id });
    this.logger.log(`Создан mock-платёж ${payment.id} для заказа ${payment.orderId}`);
    return payment;
  }

  async simulate(id: string, dto: MockResultDto) {
    const payment = this.get(id);
    if (payment.status !== 'pending' && payment.status !== dto.status) {
      throw new ConflictException('Финальный статус платежа нельзя изменить');
    }
    payment.status = dto.status;
    await this.notifyOrder(payment);
    return payment;
  }

  private async notifyOrder(payment: Payment) {
    payment.notificationAttempts += 1;
    try {
      await this.orders.post('/internal/payment-results', {
        paymentId: payment.id,
        orderId: payment.orderId,
        status: payment.status,
      });
      payment.notificationStatus = 'delivered';
      this.logger.log(`Результат платежа ${payment.id} доставлен в orders-service`);
    } catch {
      // Оплата и доставка уведомления — разные факты. Ошибка доставки не отменяет оплату.
      payment.notificationStatus = 'failed';
      this.logger.warn(
        `Результат платежа ${payment.id} не доставлен. Повторите учебное уведомление`,
      );
    }
  }
}
