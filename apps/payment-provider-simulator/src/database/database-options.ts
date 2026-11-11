import type { DataSourceOptions } from 'typeorm';
import { InvoiceEntity } from './invoice.entity';
import { CreateInvoices1794355200002 } from './1794355200002-CreateInvoices';

export function databaseOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    url:
      process.env.DATABASE_URL ?? 'postgresql://provider:provider_local@127.0.0.1:15436/provider',
    entities: [InvoiceEntity],
    migrations: [CreateInvoices1794355200002],
    synchronize: false,
    migrationsRun: false,
    migrationsTransactionMode: 'all',
    extra: { connectionTimeoutMillis: 3000 },
  };
}
