import type { Payment } from '../payments.repository';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface ProviderPayment {
  id: string;
  merchantPaymentId: string;
  amount: number;
  currency: 'RUB';
  method: 'card' | 'sbp' | 'crypto';
  status: 'pending' | 'succeeded' | 'failed';
  checkoutUrl: string;
}

export interface PaymentProvider {
  readonly name: string;
  create(payment: Payment): Promise<ProviderPayment>;
  get(id: string): Promise<ProviderPayment>;
}
