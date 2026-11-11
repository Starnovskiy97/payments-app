export type Method = 'card' | 'sbp' | 'crypto';
export interface Product {
  id: string;
  name: string;
  price: number;
}
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
export interface Payment {
  id: string;
  orderId: string;
  amount: number;
  currency: 'RUB';
  method: Method;
  status: 'pending' | 'succeeded' | 'failed';
  provider: string;
  providerPaymentId: string | null;
  checkoutUrl: string | null;
  notificationStatus: 'not_sent' | 'delivered' | 'failed';
  notificationAttempts: number;
  createdAt: string;
}
