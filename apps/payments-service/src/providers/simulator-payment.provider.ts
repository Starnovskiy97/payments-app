import { BadGatewayException, Injectable } from '@nestjs/common';
import axios from 'axios';
import type { Payment } from '../payments.repository';
import type { PaymentProvider, ProviderPayment } from './payment-provider';

@Injectable()
export class SimulatorPaymentProvider implements PaymentProvider {
  readonly name = 'simulator';
  private readonly client = axios.create({
    baseURL: process.env.PROVIDER_API_URL ?? 'http://127.0.0.1:3003',
    timeout: 1500,
    headers: { 'x-provider-token': process.env.PROVIDER_API_TOKEN ?? 'local-provider-api-only' },
  });

  async create(payment: Payment): Promise<ProviderPayment> {
    try {
      const { data } = await this.client.post<ProviderPayment>('/provider/payments', {
        merchantPaymentId: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        method: payment.method,
      });
      return data;
    } catch {
      throw new BadGatewayException(
        'Провайдер не ответил. Платёж мог создаться: повторите исходный ключ, не начинайте новую попытку',
      );
    }
  }

  async get(id: string): Promise<ProviderPayment> {
    try {
      return (
        await this.client.get<ProviderPayment>(`/provider/payments/${encodeURIComponent(id)}`)
      ).data;
    } catch {
      throw new BadGatewayException('Не удалось получить состояние у провайдера');
    }
  }
}
