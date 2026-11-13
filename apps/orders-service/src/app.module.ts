import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseOptions } from './database/database-options';
import { OrderEntity } from './database/entities/order.entity';
import { OrderItemEntity } from './database/entities/order-item.entity';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersRepository } from './orders.repository';
import { PaymentEventsConsumer } from './payment-events.consumer';
import { PaymentInboxEntity } from './database/entities/payment-inbox.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({ ...databaseOptions(), retryAttempts: 2, retryDelay: 1000 }),
    TypeOrmModule.forFeature([OrderEntity, OrderItemEntity, PaymentInboxEntity]),
  ],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersRepository, PaymentEventsConsumer],
})
export class AppModule {}
