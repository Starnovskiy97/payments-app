import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  RabbitConnection,
  PermanentMessageError,
  parsePaymentResult,
  type ConfirmChannel,
  type ConsumeMessage,
} from '@lab/messaging';
import { OrdersRepository } from './orders.repository';

@Injectable()
export class PaymentEventsConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentEventsConsumer.name);
  private readonly rabbit = new RabbitConnection(
    (message) => this.logger.log(message),
    async (channel) => {
      await channel.prefetch(5);
      await channel.consume(
        this.rabbit.queues.results,
        (message) => {
          if (!message) return;
          void this.process(channel, message).catch(() => {
            // Не получилось безопасно завершить обработку: оставляем сообщение unacked.
            // Закрытие канала возвращает его брокеру; reconnect восстановит consumer.
            this.logger.warn(
              'Обработка прервана; неподтверждённое сообщение будет доставлено повторно',
            );
            void channel.close().catch(() => undefined);
          });
        },
        { noAck: false },
      );
    },
  );

  constructor(private readonly orders: OrdersRepository) {}

  get connected(): boolean {
    return this.rabbit.connected;
  }
  onModuleInit(): void {
    this.rabbit.start();
  }
  async onModuleDestroy(): Promise<void> {
    await this.rabbit.close();
  }

  private async process(channel: ConfirmChannel, message: ConsumeMessage): Promise<void> {
    let failure: unknown;
    try {
      const event = parsePaymentResult(message.content);
      await this.orders.applyPaymentResult(event);
      // Только после COMMIT. Если ack потеряется, повтор безопасен по состоянию.
      channel.ack(message);
      this.logger.log(`Обработано ${event.eventId}; заказ ${event.orderId}`);
      return;
    } catch (error) {
      failure = error;
    }

    const count = message.properties.headers?.['x-lab-retry-count'] ?? 0;
    const validCount = Number.isSafeInteger(count) && count >= 0;
    const dead = failure instanceof PermanentMessageError || !validCount || count >= 5;
    const target = dead ? this.rabbit.queues.dead : this.rabbit.queues.retry;
    await this.rabbit.publish(target, message.content, {
      messageId: message.properties.messageId,
      type: message.properties.type,
      contentType: message.properties.contentType,
      headers: {
        'x-lab-retry-count': validCount ? count + 1 : 0,
        'x-lab-error':
          failure instanceof Error ? failure.message.slice(0, 250) : 'Неизвестная ошибка',
      },
    });
    // Сначала confirm копии в retry/DLQ, затем ack исходного. Обратный порядок теряет сообщения.
    channel.ack(message);
    this.logger.warn(
      `Сообщение отправлено в ${dead ? 'DLQ' : 'отложенный повтор'}: ${message.properties.messageId ?? 'без ID'}`,
    );
  }
}
