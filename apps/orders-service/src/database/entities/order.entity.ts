import { Column, CreateDateColumn, Entity, OneToMany, PrimaryColumn } from 'typeorm';
import { OrderItemEntity } from './order-item.entity';

@Entity('orders')
export class OrderEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'integer' })
  amount!: number;

  @Column({ type: 'varchar', length: 3 })
  currency!: 'RUB';

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: 'pending' | 'paid';

  // Это только идентификаторы удалённых платежей, не копии данных payments-service.
  @Column({ name: 'payment_ids', type: 'uuid', array: true, default: () => "'{}'::uuid[]" })
  paymentIds!: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => OrderItemEntity, (item) => item.order, { cascade: ['insert'] })
  items!: OrderItemEntity[];
}
