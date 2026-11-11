import type { DataSourceOptions } from 'typeorm';
import { PaymentEntity } from './entities/payment.entity';
import { CreatePayments1794355200001 } from './migrations/1794355200001-CreatePayments';

export function databaseOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    url:
      process.env.DATABASE_URL ?? 'postgresql://payments:payments_local@127.0.0.1:15434/payments',
    entities: [PaymentEntity],
    migrations: [CreatePayments1794355200001],
    synchronize: false,
    migrationsRun: false,
    migrationsTransactionMode: 'all',
    extra: { connectionTimeoutMillis: 3000 },
  };
}
