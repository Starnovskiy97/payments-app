import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentEntity } from './database/entities/payment.entity';
import { CreatePaymentDto, ProviderWebhookDto } from './dto';
import { PaymentOutboxEntity } from './database/entities/payment-outbox.entity';
import type { PaymentResultEvent } from '@lab/messaging';

// В публичный ответ намеренно не включаем внутренний ключ идемпотентности.
export interface Payment {
  id: string;
  orderId: string;
  amount: number;
  currency: 'RUB';
  method: CreatePaymentDto['method'];
  provider: string;
  providerPaymentId: string | null;
  checkoutUrl: string | null;
  status: 'pending' | 'succeeded' | 'failed';
  notificationStatus: 'not_sent' | 'published' | 'delivered' | 'failed';
  resultEventId: string | null;
  resultRecordedAt: string | null;
  notificationAttempts: number;
  createdAt: string;
}

@Injectable()
export class PaymentsRepository {
  constructor(
    @InjectRepository(PaymentEntity)
    private readonly payments: Repository<PaymentEntity>,
  ) {}

  async get(id: string): Promise<Payment> {
    const payment = await this.payments.findOneBy({ id });
    if (!payment) throw new NotFoundException('Платёж не найден');
    return this.toPayment(payment);
  }

  async lookup(dto: CreatePaymentDto): Promise<Payment> {
    const payment = await this.payments.findOneBy({
      orderId: dto.orderId,
      idempotencyKey: dto.idempotencyKey,
    });
    if (!payment) throw new NotFoundException('Платёж с таким ключом не найден');
    return this.matchRequest(payment, dto);
  }

  async create(dto: CreatePaymentDto, provider: string): Promise<Payment> {
    // Ключ и платёж — одна строка: нельзя сохранить одно без другого.
    // Ограничения БД работают и между несколькими процессами сервиса.
    await this.payments
      .createQueryBuilder()
      .insert()
      .values({
        id: randomUUID(),
        ...dto,
        provider,
        status: 'pending',
        notificationStatus: 'not_sent',
        notificationAttempts: 0,
      })
      .orIgnore()
      .execute();

    // Отдельный SELECT в READ COMMITTED увидит запись параллельного запроса,
    // из-за которой PostgreSQL мог пропустить INSERT ... ON CONFLICT DO NOTHING.
    const payment = await this.payments.findOneBy({
      orderId: dto.orderId,
      idempotencyKey: dto.idempotencyKey,
    });
    if (!payment) {
      throw new ConflictException('У заказа уже есть незавершённый или успешный платёж');
    }
    return this.matchRequest(payment, dto);
  }

  async attachProvider(id: string, providerPaymentId: string, checkoutUrl: string): Promise<void> {
    await this.payments.manager.transaction(async (manager) => {
      const payment = await manager.findOneByOrFail(PaymentEntity, { id });
      // Условия UPDATE защищают и от конкурирующих ответов разных запросов.
      const updated = await manager
        .createQueryBuilder()
        .update(PaymentEntity)
        .set({ providerPaymentId, checkoutUrl })
        .where('id = :id', { id })
        .andWhere('(provider_payment_id IS NULL OR provider_payment_id = :providerPaymentId)', {
          providerPaymentId,
        })
        .execute();
      if (updated.affected !== 1)
        throw new ConflictException(`Другая внешняя операция уже связана с платежом ${payment.id}`);
    });
  }

  async recordResult(id: string, status: ProviderWebhookDto['status']): Promise<Payment> {
    return this.payments.manager.transaction(async (manager) => {
      const payment = await manager.findOne(PaymentEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!payment) throw new NotFoundException('Платёж не найден');
      if (payment.status !== 'pending' && payment.status !== status) {
        throw new ConflictException('Финальный статус платежа нельзя изменить');
      }
      // Изменение платежа и задание на публикацию коммитятся либо вместе, либо никак.
      payment.status = status;
      payment.resultEventId ??= randomUUID();
      payment.resultRecordedAt ??= new Date();
      await manager.save(PaymentEntity, payment);
      const existing = await manager.findOneBy(PaymentOutboxEntity, {
        eventId: payment.resultEventId,
      });
      if (!existing) {
        const event: PaymentResultEvent = {
          eventId: payment.resultEventId,
          version: 1,
          type: status === 'succeeded' ? 'payment.succeeded' : 'payment.failed',
          paymentId: payment.id,
          orderId: payment.orderId,
          amount: payment.amount,
          currency: payment.currency,
          occurredAt: payment.resultRecordedAt.toISOString(),
        };
        // Payment row lock сериализует повторы. Готовое задание не сбрасываем в pending.
        await manager.insert(PaymentOutboxEntity, {
          eventId: event.eventId,
          paymentId: payment.id,
          payload: event,
          status: 'pending',
        });
      }
      return this.toPayment(payment);
    });
  }

  private toPayment(entity: PaymentEntity): Payment {
    return {
      id: entity.id,
      orderId: entity.orderId,
      amount: entity.amount,
      currency: entity.currency,
      method: entity.method,
      provider: entity.provider,
      providerPaymentId: entity.providerPaymentId,
      checkoutUrl: entity.checkoutUrl,
      status: entity.status,
      notificationStatus: entity.notificationStatus,
      resultEventId: entity.resultEventId,
      resultRecordedAt: entity.resultRecordedAt?.toISOString() ?? null,
      notificationAttempts: entity.notificationAttempts,
      createdAt: entity.createdAt.toISOString(),
    };
  }

  private matchRequest(payment: PaymentEntity, dto: CreatePaymentDto): Payment {
    if (
      payment.amount !== dto.amount ||
      payment.currency !== dto.currency ||
      payment.method !== dto.method
    ) {
      throw new ConflictException('Idempotency-Key уже использован с другими данными');
    }
    return this.toPayment(payment);
  }
}
