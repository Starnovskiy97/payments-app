import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InvoiceEntity } from './database/invoice.entity';
import { CreateInvoiceDto, CompleteInvoiceDto } from './dto';

@Injectable()
export class InvoicesRepository {
  constructor(
    @InjectRepository(InvoiceEntity) private readonly invoices: Repository<InvoiceEntity>,
  ) {}

  async get(id: string): Promise<InvoiceEntity> {
    const invoice = await this.invoices.findOneBy({ id });
    if (!invoice) throw new NotFoundException('Платёж провайдера не найден');
    return invoice;
  }

  async create(dto: CreateInvoiceDto): Promise<InvoiceEntity> {
    await this.invoices
      .createQueryBuilder()
      .insert()
      .values({ id: randomUUID(), ...dto })
      .orIgnore()
      .execute();
    const invoice = await this.invoices.findOneByOrFail({
      merchantPaymentId: dto.merchantPaymentId,
    });
    if (
      invoice.amount !== dto.amount ||
      invoice.currency !== dto.currency ||
      invoice.method !== dto.method
    ) {
      throw new ConflictException('ID платежа уже использован с другими данными');
    }
    return invoice;
  }

  async complete(id: string, status: CompleteInvoiceDto['status']): Promise<InvoiceEntity> {
    return this.invoices.manager.transaction(async (manager) => {
      const invoice = await manager.findOne(InvoiceEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!invoice) throw new NotFoundException('Платёж провайдера не найден');
      if (invoice.status !== 'pending' && invoice.status !== status) {
        throw new ConflictException('Финальный статус провайдера нельзя изменить');
      }
      invoice.status = status;
      invoice.eventId ??= randomUUID();
      return manager.save(InvoiceEntity, invoice);
    });
  }

  async beginDelivery(id: string): Promise<void> {
    await this.invoices.increment({ id }, 'webhookAttempts', 1);
  }

  async endDelivery(id: string, delivered: boolean): Promise<void> {
    const query = this.invoices
      .createQueryBuilder()
      .update()
      .set({ webhookStatus: delivered ? 'delivered' : 'failed' })
      .where('id = :id', { id });
    if (!delivered) query.andWhere("webhook_status <> 'delivered'");
    await query.execute();
  }
}
