import type { DataSourceOptions } from 'typeorm';
import { OrderEntity } from './entities/order.entity';
import { OrderItemEntity } from './entities/order-item.entity';
import { CreateOrders1794355200000 } from './migrations/1794355200000-CreateOrders';

// Один конфиг для Nest-приложения, CLI миграций и интеграционных тестов.
export function databaseOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    url: process.env.DATABASE_URL ?? 'postgresql://orders:orders_local@127.0.0.1:15432/orders',
    entities: [OrderEntity, OrderItemEntity],
    migrations: [CreateOrders1794355200000],
    synchronize: false,
    migrationsRun: false,
    migrationsTransactionMode: 'all',
    extra: { connectionTimeoutMillis: 3000 },
  };
}
