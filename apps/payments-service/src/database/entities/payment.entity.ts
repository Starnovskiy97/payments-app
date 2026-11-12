import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('payments')
export class PaymentEntity {
  @PrimaryColumn('uuid')
  id!: string;

  // Заказ находится в другом сервисе: межсервисного FK здесь нет.
  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @Column({ type: 'integer' })
  amount!: number;

  @Column({ type: 'varchar', length: 3 })
  currency!: 'RUB';

  @Column({ type: 'varchar', length: 16 })
  method!: 'card' | 'sbp' | 'crypto';

  @Column({ type: 'varchar', length: 32 })
  provider!: string;

  @Column({ name: 'provider_payment_id', type: 'varchar', length: 128, nullable: true })
  providerPaymentId!: string | null;

  @Column({ name: 'checkout_url', type: 'varchar', length: 2048, nullable: true })
  checkoutUrl!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: 'pending' | 'succeeded' | 'failed';

  @Column({ name: 'notification_status', type: 'varchar', length: 16, default: 'not_sent' })
  notificationStatus!: 'not_sent' | 'published' | 'delivered' | 'failed';

  @Column({ name: 'result_event_id', type: 'uuid', nullable: true })
  resultEventId!: string | null;

  @Column({ name: 'result_recorded_at', type: 'timestamptz', nullable: true })
  resultRecordedAt!: Date | null;

  @Column({ name: 'notification_attempts', type: 'integer', default: 0 })
  notificationAttempts!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
