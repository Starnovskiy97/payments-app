import { createHash, randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderEntity } from './database/entities/order.entity';
import { OrderItemEntity } from './database/entities/order-item.entity';
import { PermanentMessageError, type PaymentResultEvent } from '@lab/messaging';
import { PaymentInboxEntity } from './database/entities/payment-inbox.entity';

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

  async recordPayment(id: string, paymentId: string, paid: boolean): Promise<void> {
    // Атомарный UPDATE, а не чтение массива → изменение в JS → перезапись.
    // Повторное добавление того же ID безопасно и не создаёт дубликат.
    await this.orders
      .createQueryBuilder()
      .update(OrderEntity)
      .set({
        paymentIds: () => `CASE
          WHEN CAST(:paymentId AS uuid) = ANY(payment_ids) THEN payment_ids
          ELSE array_append(payment_ids, CAST(:paymentId AS uuid)) END`,
        ...(paid ? { status: 'paid' as const } : {}),
      })
      .where('id = :id', { id })
      .setParameter('paymentId', paymentId)
      .execute();
  }

  async applyPaymentResult(event: PaymentResultEvent): Promise<boolean> {
    const eventId = event.eventId.toLowerCase();
    const paymentId = event.paymentId.toLowerCase();
    // Хэш канонических полей, а не исходного JSON: пробелы и порядок ключей не меняют смысл.
    const payloadHash = createHash('sha256')
      .update(
        JSON.stringify([
          event.version,
          event.type,
          paymentId,
          event.orderId.toLowerCase(),
          event.amount,
          event.currency,
          new Date(event.occurredAt).toISOString(),
        ]),
      )
      .digest('hex');
    return this.orders.manager.transaction(async (manager) => {
      const inserted = await manager
        .createQueryBuilder()
        .insert()
        .into(PaymentInboxEntity)
        .values({ eventId, payloadHash, eventType: event.type, orderId: event.orderId })
        .orIgnore()
        .returning('event_id')
        .execute();
      if (inserted.raw.length === 0) {
        const previous = await manager.findOneByOrFail(PaymentInboxEntity, { eventId });
        if (previous.payloadHash !== payloadHash) {
          throw new PermanentMessageError('eventId уже обработан с другим содержимым');
        }
        return false;
      }
      const order = await manager.findOne(OrderEntity, {
        where: { id: event.orderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new PermanentMessageError('Заказ из события не найден');
      if (order.amount !== event.amount || order.currency !== event.currency) {
        throw new PermanentMessageError('Сумма или валюта события не совпадает с заказом');
      }
      // Событие может прийти до HTTP-ответа /pay. Факт от доверенного брокера сам связывает ID.
      if (!order.paymentIds.includes(paymentId)) order.paymentIds.push(paymentId);
      if (event.type === 'payment.succeeded') order.status = 'paid';
      // При любой ошибке откатятся и заказ, и inbox: повтор не будет ошибочно пропущен.
      await manager.save(OrderEntity, order);
      return true;
    });
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
