import { Module } from '@nestjs/common';
import { InternalGuard } from './internal.guard';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({ controllers: [OrdersController], providers: [OrdersService, InternalGuard] })
export class AppModule {}
