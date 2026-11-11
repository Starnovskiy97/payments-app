import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CreateOrderDto, PaymentResultDto, PayOrderDto } from './dto';
import { InternalGuard } from './internal.guard';
import { OrdersService, PRODUCTS } from './orders.service';

@ApiTags('orders')
@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('health')
  health() {
    return { service: 'orders-service', status: 'ok' };
  }

  @Get('products')
  products() {
    return PRODUCTS;
  }

  @Get('orders')
  list() {
    return this.orders.list();
  }

  @Post('orders')
  create(@Body() dto: CreateOrderDto) {
    return this.orders.create(dto);
  }

  @Get('orders/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(id);
  }

  @Post('orders/:id/pay')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Один ключ на попытку оплаты. При сетевой ошибке повторить тот же ключ.',
  })
  pay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PayOrderDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.orders.pay(id, dto, key);
  }

  @Post('internal/payment-results')
  @UseGuards(InternalGuard)
  @ApiSecurity('internal')
  result(@Body() dto: PaymentResultDto) {
    return this.orders.handlePaymentResult(dto);
  }
}
