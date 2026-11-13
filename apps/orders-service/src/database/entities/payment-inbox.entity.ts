import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('payment_inbox')
export class PaymentInboxEntity {
  @PrimaryColumn({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @Column({ name: 'payload_hash', type: 'char', length: 64 })
  payloadHash!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 64 })
  eventType!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @CreateDateColumn({ name: 'processed_at', type: 'timestamptz' })
  processedAt!: Date;
}
