import { createHmac } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { InvoicesRepository } from './invoices.repository';
import { CompleteInvoiceDto, CreateInvoiceDto } from './dto';
import { InvoiceEntity } from './database/invoice.entity';

@Injectable()
export class ProviderService {
  private readonly logger = new Logger(ProviderService.name);
  private nextCreateDelay = 0;

  constructor(private readonly invoices: InvoicesRepository) {}

  configureNextCreate(delayMs: number) {
    this.nextCreateDelay = delayMs;
    return {
      delayMs,
      description: 'Задержится ответ следующего запроса создания, но запись сохранится сразу',
    };
  }

  async create(dto: CreateInvoiceDto) {
    const delayMs = this.nextCreateDelay;
    this.nextCreateDelay = 0;
    const invoice = await this.invoices.create(dto);
    // Преднамеренно задерживаем ответ ПОСЛЕ коммита: таймаут клиента не отменяет операцию.
    if (delayMs) await delay(delayMs);
    return this.present(invoice);
  }

  async get(id: string) {
    return this.present(await this.invoices.get(id));
  }

  async complete(id: string, dto: CompleteInvoiceDto) {
    const invoice = await this.invoices.complete(id, dto.status);
    if (dto.delivery === 'send') {
      if (dto.delayMs) await delay(dto.delayMs);
      for (let i = 0; i < dto.copies; i++) await this.deliver(invoice);
    }
    return this.get(id);
  }

  private present(invoice: InvoiceEntity) {
    const origin = process.env.PROVIDER_PUBLIC_URL ?? 'http://localhost:3003';
    return { ...invoice, checkoutUrl: new URL(`/checkout/${invoice.id}`, origin).toString() };
  }

  private async deliver(invoice: InvoiceEntity) {
    const body = JSON.stringify({
      eventId: invoice.eventId,
      providerPaymentId: invoice.id,
      merchantPaymentId: invoice.merchantPaymentId,
      amount: invoice.amount,
      currency: invoice.currency,
      status: invoice.status,
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac(
      'sha256',
      process.env.PROVIDER_WEBHOOK_SECRET ?? 'local-provider-webhook-only',
    )
      .update(`${timestamp}.${body}`)
      .digest('hex');
    await this.invoices.beginDelivery(invoice.id);
    let delivered = false;
    try {
      // Адрес фиксирован конфигурацией: клиент не может прислать произвольный callback URL.
      await axios.post(
        process.env.PAYMENTS_WEBHOOK_URL ?? 'http://127.0.0.1:3002/webhooks/simulator',
        body,
        {
          timeout: 6000,
          headers: {
            'content-type': 'application/json',
            'x-provider-timestamp': timestamp,
            'x-provider-signature': signature,
          },
        },
      );
      delivered = true;
    } catch {
      this.logger.warn(
        `Webhook ${invoice.eventId} не подтверждён, результат сохранён у провайдера`,
      );
    }
    await this.invoices.endDelivery(invoice.id, delivered);
  }
}
