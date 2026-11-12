import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { RabbitConnection, type PaymentResultEvent } from '@lab/messaging';
import type { Payment } from './payments.repository';

@Injectable()
export class PaymentEventsPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentEventsPublisher.name);
  private readonly rabbit = new RabbitConnection((message) => this.logger.log(message));

  get connected(): boolean {
    return this.rabbit.connected;
  }
  onModuleInit(): void {
    this.rabbit.start();
  }
  async onModuleDestroy(): Promise<void> {
    await this.rabbit.close();
  }

  async publish(payment: Payment): Promise<void> {
    if (!payment.resultEventId || !payment.resultRecordedAt || payment.status === 'pending') {
      throw new Error('Нет сохранённого финального события');
    }
    const event: PaymentResultEvent = {
      eventId: payment.resultEventId,
      type: payment.status === 'succeeded' ? 'payment.succeeded' : 'payment.failed',
      version: 1,
      paymentId: payment.id,
      orderId: payment.orderId,
      amount: payment.amount,
      currency: payment.currency,
      occurredAt: payment.resultRecordedAt,
    };
    await this.rabbit.publish(this.rabbit.queues.results, Buffer.from(JSON.stringify(event)), {
      messageId: event.eventId,
      type: event.type,
    });
    this.logger.log(
      `Брокер подтвердил ${event.type} ${event.eventId}; обработка заказа ещё не подтверждена`,
    );
  }
}
