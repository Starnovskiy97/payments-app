import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { OutboxRepository } from './outbox.repository';
import { PaymentEventsPublisher } from '../payment-events.publisher';
import { outboxSettings } from './outbox-settings';

@Injectable()
export class OutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorker.name);
  private readonly settings = outboxSettings();
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  private stopped = false;

  constructor(
    private readonly outbox: OutboxRepository,
    private readonly events: PaymentEventsPublisher,
  ) {}

  onModuleInit(): void {
    if (this.settings.enabled) this.schedule(0);
    else
      this.logger.warn(
        'Outbox worker выключен: задания сохраняются, но эта реплика их не публикует',
      );
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.active = this.drain()
        .catch(() => {
          this.logger.warn('Не удалось обработать outbox; задания остаются в БД');
        })
        .finally(() => {
          this.active = undefined;
          this.schedule(this.settings.pollMs);
        });
    }, delayMs);
  }

  private async drain(): Promise<void> {
    for (let i = 0; i < 10 && !this.stopped; i++) {
      const job = await this.outbox.claim();
      if (!job) return;
      try {
        // SQL-транзакция claim уже завершена. Во время HTTP/AMQP не держим row lock.
        await this.events.publish(job.payload);
        const recorded = await this.outbox.markPublished(job);
        if (!recorded)
          this.logger.warn(`Lease ${job.eventId} уже принадлежит другому worker; повтор допустим`);
      } catch (error) {
        await this.outbox.releaseFailed(
          job,
          error instanceof Error ? error.message : 'Ошибка публикации',
        );
        this.logger.warn(`Публикация ${job.eventId} не подтверждена; повтор запланирован в БД`);
        return;
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.active;
  }
}
