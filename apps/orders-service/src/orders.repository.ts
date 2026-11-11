import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderEntity } from './database/entities/order.entity';
import { OrderItemEntity } from './database/entities/order-item.entity';

// Публичный HTTP-контракт остаётся прежним, хотя в БД заказ и позиции разделены.
export interface Order {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  amount: number;
  currency: 'RUB';
  status: 'pending' | 'paid';
  paymentIds: string[];
  createdAt: string;
}

interface CreateOrder {
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
}

@Injectable()
export class OrdersRepository {
  constructor(
    @InjectRepository(OrderEntity)
    private readonly orders: Repository<OrderEntity>,
  ) {}

  async list(): Promise<Order[]> {
    const orders = await this.orders.find({
      relations: { items: true },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    return orders.map((order) => this.toOrder(order));
  }

  async get(id: string): Promise<Order> {
    const order = await this.orders.findOne({ where: { id }, relations: { items: true } });
    if (!order) throw new NotFoundException('Заказ не найден');
    return this.toOrder(order);
  }

  async create(input: CreateOrder): Promise<Order> {
    // Обе записи либо сохраняются вместе, либо полностью откатываются.
    return this.orders.manager.transaction(async (manager) => {
      const order = manager.create(OrderEntity, {
        id: randomUUID(),
        amount: input.unitPrice * input.quantity,
        currency: 'RUB',
        status: 'pending',
        paymentIds: [],
      });
      const item = manager.create(OrderItemEntity, {
        id: randomUUID(),
        orderId: order.id,
        productId: input.productId,
        productName: input.productName,
        unitPrice: input.unitPrice,
        quantity: input.quantity,
      });
      order.items = [item];
      await manager.save(OrderEntity, order);
      return this.toOrder(order);
    });
  }

  async linkPayment(id: string, paymentId: string): Promise<void> {
    // Атомарный UPDATE, а не чтение массива → изменение в JS → перезапись.
    // Повторное добавление того же ID безопасно и не создаёт дубликат.
    await this.orders
      .createQueryBuilder()
      .update(OrderEntity)
      .set({ paymentIds: () => 'array_append(payment_ids, CAST(:paymentId AS uuid))' })
      .where('id = :id', { id })
      .andWhere('NOT (CAST(:paymentId AS uuid) = ANY(payment_ids))', { paymentId })
      .execute();
  }

  async markPaid(id: string): Promise<void> {
    await this.orders.update({ id }, { status: 'paid' });
  }

  private toOrder(entity: OrderEntity): Order {
    // Пока HTTP API создаёт один товар на заказ. Таблица позиций готова к расширению.
    const item = entity.items[0];
    if (!item) throw new Error(`У заказа ${entity.id} отсутствует позиция`);
    return {
      id: entity.id,
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      amount: entity.amount,
      currency: entity.currency,
      status: entity.status,
      paymentIds: entity.paymentIds,
      createdAt: entity.createdAt.toISOString(),
    };
  }
}
