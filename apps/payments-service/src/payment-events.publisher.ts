import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { RabbitConnection, type PaymentResultEvent } from '@lab/messaging';

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

  async publish(event: PaymentResultEvent): Promise<void> {
    await this.rabbit.publish(this.rabbit.queues.results, Buffer.from(JSON.stringify(event)), {
      messageId: event.eventId,
      type: event.type,
    });
    this.logger.log(
      `Брокер подтвердил ${event.type} ${event.eventId}; обработка заказа ещё не подтверждена`,
    );
  }
}
