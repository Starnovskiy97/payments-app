import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentOutboxEntity } from '../database/entities/payment-outbox.entity';
import { PaymentEntity } from '../database/entities/payment.entity';
import { outboxSettings } from './outbox-settings';

@Injectable()
export class OutboxRepository {
  private readonly settings = outboxSettings();

  constructor(
    @InjectRepository(PaymentOutboxEntity) private readonly outbox: Repository<PaymentOutboxEntity>,
  ) {}

  async claim(): Promise<PaymentOutboxEntity | null> {
    return this.outbox.manager.transaction(async (manager) => {
      const job = await manager
        .createQueryBuilder(PaymentOutboxEntity, 'job')
        .where(
          "(job.status = 'pending' AND job.next_attempt_at <= now()) OR (job.status = 'processing' AND job.locked_until <= now())",
        )
        .orderBy('job.created_at', 'ASC')
        .addOrderBy('job.event_id', 'ASC')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .limit(1)
        .getOne();
      if (!job) return null;
      const token = randomUUID();
      await manager
        .createQueryBuilder()
        .update(PaymentOutboxEntity)
        .set({
          status: 'processing',
          lockedBy: token,
          lockedUntil: () => "now() + (:leaseMs * interval '1 millisecond')",
          attempts: () => 'attempts + 1',
        })
        .where('event_id = :eventId', { eventId: job.eventId })
        .setParameter('leaseMs', this.settings.leaseMs)
        .execute();
      await manager.increment(PaymentEntity, { id: job.paymentId }, 'notificationAttempts', 1);
      return manager.findOneByOrFail(PaymentOutboxEntity, { eventId: job.eventId });
    });
  }

  async markPublished(job: PaymentOutboxEntity): Promise<boolean> {
    return this.outbox.manager.transaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .update(PaymentOutboxEntity)
        .set({
          status: 'published',
          publishedAt: () => 'now()',
          lockedBy: null,
          lockedUntil: null,
          lastError: null,
        })
        .where("event_id = :id AND locked_by = :token AND status = 'processing'", {
          id: job.eventId,
          token: job.lockedBy,
        })
        .execute();
      if (result.affected !== 1) return false;
      await manager.update(
        PaymentEntity,
        { id: job.paymentId },
        { notificationStatus: 'published' },
      );
      return true;
    });
  }

  async releaseFailed(job: PaymentOutboxEntity, reason: string): Promise<boolean> {
    const retryMs = Math.min(
      30000,
      this.settings.retryBaseMs * 2 ** Math.min(job.attempts - 1, 16),
    );
    return this.outbox.manager.transaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .update(PaymentOutboxEntity)
        .set({
          status: 'pending',
          lockedBy: null,
          lockedUntil: null,
          nextAttemptAt: () => "now() + (:retryMs * interval '1 millisecond')",
          lastError: reason.replace(/amqps?:\/\/[^@\s]+@/g, 'amqp://***@').slice(0, 1000),
        })
        .where("event_id = :id AND locked_by = :token AND status = 'processing'", {
          id: job.eventId,
          token: job.lockedBy,
        })
        .setParameter('retryMs', retryMs)
        .execute();
      if (result.affected !== 1) return false;
      await manager
        .createQueryBuilder()
        .update(PaymentEntity)
        .set({ notificationStatus: 'failed' })
        .where("id = :id AND notification_status <> 'published'", { id: job.paymentId })
        .execute();
      return true;
    });
  }
}
