import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentEntity } from './database/entities/payment.entity';
import { CreatePaymentDto, MockResultDto } from './dto';

// В публичный ответ намеренно не включаем внутренний ключ идемпотентности.
export interface Payment {
  id: string;
  orderId: string;
  amount: number;
  currency: 'RUB';
  method: CreatePaymentDto['method'];
  provider: string;
  status: 'pending' | 'succeeded' | 'failed';
  notificationStatus: 'not_sent' | 'delivered' | 'failed';
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

  async recordResult(id: string, status: MockResultDto['status']): Promise<Payment> {
    return this.payments.manager.transaction(async (manager) => {
      const payment = await manager.findOne(PaymentEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!payment) throw new NotFoundException('Платёж не найден');
      if (payment.status !== 'pending' && payment.status !== status) {
        throw new ConflictException('Финальный статус платежа нельзя изменить');
      }
      // Статус и счётчик фиксируются до HTTP-вызова. Сетевое ожидание не держит блокировку.
      payment.status = status;
      payment.notificationAttempts += 1;
      await manager.save(PaymentEntity, payment);
      return this.toPayment(payment);
    });
  }

  async recordDelivery(id: string, delivered: boolean): Promise<void> {
    const query = this.payments
      .createQueryBuilder()
      .update(PaymentEntity)
      .set({ notificationStatus: delivered ? 'delivered' : 'failed' })
      .where('id = :id', { id });
    // Доказанный успех доставки не отменяется ошибкой параллельного повтора.
    if (!delivered) query.andWhere("notification_status <> 'delivered'");
    await query.execute();
  }

  private toPayment(entity: PaymentEntity): Payment {
    return {
      id: entity.id,
      orderId: entity.orderId,
      amount: entity.amount,
      currency: entity.currency,
      method: entity.method,
      provider: entity.provider,
      status: entity.status,
      notificationStatus: entity.notificationStatus,
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
