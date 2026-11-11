import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import axios from 'axios';
import { CreateOrderDto, PaymentResultDto, PayOrderDto } from './dto';
import { OrdersRepository, type Order } from './orders.repository';

export const PRODUCTS = [
  { id: 'backend-course', name: 'Учебный курс по бэкенду', price: 50000 },
  { id: 'microservices-book', name: 'Книга о микросервисах', price: 120000 },
];

interface Payment {
  id: string;
  orderId: string;
  amount: number;
  currency: 'RUB';
  method: PayOrderDto['method'];
  status: 'pending' | 'succeeded' | 'failed';
  notificationStatus: 'not_sent' | 'delivered' | 'failed';
  createdAt: string;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  private readonly payments = axios.create({
    baseURL: process.env.PAYMENTS_SERVICE_URL ?? 'http://127.0.0.1:3002',
    timeout: 3000,
    headers: { 'x-internal-token': process.env.INTERNAL_API_TOKEN ?? 'local-learning-only' },
  });

  constructor(private readonly orders: OrdersRepository) {}

  list() {
    return this.orders.list();
  }

  get(id: string) {
    return this.orders.get(id);
  }

  async create(dto: CreateOrderDto) {
    const product = PRODUCTS.find((item) => item.id === dto.productId);
    if (!product) throw new BadRequestException('Неизвестный товар');
    const order = await this.orders.create({
      productId: product.id,
      productName: product.name,
      quantity: dto.quantity,
      unitPrice: product.price,
    });
    this.logger.log(`Создан заказ ${order.id}, сумма ${order.amount} коп.`);
    return order;
  }

  async pay(id: string, dto: PayOrderDto, key: string | undefined): Promise<Payment> {
    if (!key || !/^[\w-]{8,128}$/.test(key)) {
      throw new BadRequestException('Нужен заголовок Idempotency-Key: 8–128 букв, цифр, _ или -');
    }
    const order = await this.get(id);
    // Для оплаченного заказа разрешён только поиск существующей попытки.
    // Не создаём новый платёж даже при утрате старых данных сервиса платежей.
    return this.createPayment(order, dto, key);
  }

  private async createPayment(order: Order, dto: PayOrderDto, key: string) {
    try {
      const path = order.status === 'paid' ? '/payments/lookup' : '/payments';
      const { data } = await this.payments.post<Payment>(path, {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        method: dto.method,
        idempotencyKey: key,
      });
      // Повтор исходного запроса восстанавливает локальную связь и статус,
      // если предыдущий ответ или уведомление потерялись между сервисами.
      await this.orders.recordPayment(order.id, data.id, data.status === 'succeeded');
      this.logger.log(`Заказ ${order.id} → платёж ${data.id}`);
      return data;
    } catch (error) {
      if (order.status === 'paid' && axios.isAxiosError(error) && error.response?.status === 404) {
        throw new ConflictException('Заказ уже оплачен. Новый платёж создать нельзя');
      }
      if (axios.isAxiosError<{ message?: unknown }>(error) && error.response?.status === 409) {
        const message = error.response.data.message;
        throw new ConflictException(typeof message === 'string' ? message : 'Конфликт платежа');
      }
      this.logger.warn(`Не удалось создать платёж для заказа ${order.id}`);
      throw new BadGatewayException(
        'Payments-service недоступен или отклонил запрос. Повторите с тем же Idempotency-Key',
      );
    }
  }

  private async fetchPayment(id: string) {
    try {
      return (await this.payments.get<Payment>(`/payments/${id}`)).data;
    } catch {
      throw new BadGatewayException('Не удалось получить платёж из payments-service');
    }
  }

  async handlePaymentResult(dto: PaymentResultDto) {
    const order = await this.get(dto.orderId);
    if (!order.paymentIds.includes(dto.paymentId))
      throw new ConflictException('Платёж не принадлежит заказу');
    // Не доверяем одному лишь телу уведомления: сверяем состояние в payments-service.
    const payment = await this.fetchPayment(dto.paymentId);
    if (
      payment.orderId !== order.id ||
      payment.amount !== order.amount ||
      payment.currency !== order.currency ||
      payment.status !== dto.status
    ) {
      throw new ConflictException('Данные платежа не совпадают с заказом или уведомлением');
    }
    if (payment.status === 'succeeded') await this.orders.markPaid(order.id);
    const updated = await this.get(order.id);
    // Повторное уведомление безопасно. Неуспешная попытка не отменяет уже оплаченную покупку.
    this.logger.log(
      `Результат ${dto.status}: платёж ${dto.paymentId}, заказ ${order.id} (${updated.status})`,
    );
    return updated;
  }
}
