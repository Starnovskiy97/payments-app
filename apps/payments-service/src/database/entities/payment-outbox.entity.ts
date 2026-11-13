import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import type { PaymentResultEvent } from '@lab/messaging';

@Entity('payment_outbox')
export class PaymentOutboxEntity {
  @PrimaryColumn({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @Column({ name: 'payment_id', type: 'uuid', unique: true })
  paymentId!: string;

  @Column({ type: 'jsonb' })
  payload!: PaymentResultEvent;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: 'pending' | 'processing' | 'published';

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', default: () => 'now()' })
  nextAttemptAt!: Date;

  @Column({ name: 'locked_by', type: 'uuid', nullable: true })
  lockedBy!: string | null;

  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true })
  lockedUntil!: Date | null;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @Column({ name: 'last_error', type: 'varchar', length: 1000, nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
