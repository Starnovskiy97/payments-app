import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('invoices')
export class InvoiceEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'merchant_payment_id', type: 'uuid', unique: true })
  merchantPaymentId!: string;

  @Column({ type: 'integer' })
  amount!: number;

  @Column({ type: 'varchar', length: 3 })
  currency!: 'RUB';

  @Column({ type: 'varchar', length: 16 })
  method!: 'card' | 'sbp' | 'crypto';

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: 'pending' | 'succeeded' | 'failed';

  @Column({ name: 'event_id', type: 'uuid', nullable: true })
  eventId!: string | null;

  @Column({ name: 'webhook_status', type: 'varchar', length: 16, default: 'not_sent' })
  webhookStatus!: 'not_sent' | 'delivered' | 'failed';

  @Column({ name: 'webhook_attempts', type: 'integer', default: 0 })
  webhookAttempts!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
