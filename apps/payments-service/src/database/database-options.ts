import type { DataSourceOptions } from 'typeorm';
import { PaymentEntity } from './entities/payment.entity';
import { CreatePayments1794355200001 } from './migrations/1794355200001-CreatePayments';
import { AddProviderReference1794355200003 } from './migrations/1794355200003-AddProviderReference';
import { AddResultEvent1794355200004 } from './migrations/1794355200004-AddResultEvent';
import { CreatePaymentOutbox1794441600000 } from './migrations/1794441600000-CreatePaymentOutbox';
import { PaymentOutboxEntity } from './entities/payment-outbox.entity';

export function databaseOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    url:
      process.env.DATABASE_URL ?? 'postgresql://payments:payments_local@127.0.0.1:15434/payments',
    entities: [PaymentEntity, PaymentOutboxEntity],
    migrations: [
      CreatePayments1794355200001,
      AddProviderReference1794355200003,
      AddResultEvent1794355200004,
      CreatePaymentOutbox1794441600000,
    ],
    synchronize: false,
    migrationsRun: false,
    migrationsTransactionMode: 'all',
    extra: { connectionTimeoutMillis: 3000 },
  };
}
