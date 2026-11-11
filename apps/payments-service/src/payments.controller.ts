import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CreatePaymentDto, ProviderWebhookDto } from './dto';
import { ProviderSignatureGuard } from './provider-signature.guard';
import { InternalGuard } from './internal.guard';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('health')
  health() {
    return { service: 'payments-service', status: 'ok', provider: 'simulator' };
  }

  @Post('payments')
  @UseGuards(InternalGuard)
  @ApiSecurity('internal')
  create(@Body() dto: CreatePaymentDto) {
    return this.payments.create(dto);
  }

  @Post('payments/lookup')
  @HttpCode(200)
  @UseGuards(InternalGuard)
  @ApiSecurity('internal')
  lookup(@Body() dto: CreatePaymentDto) {
    return this.payments.lookup(dto);
  }

  @Get('payments/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.payments.get(id);
  }

  @Post('payments/:id/sync')
  @HttpCode(200)
  sync(@Param('id', ParseUUIDPipe) id: string) {
    return this.payments.sync(id);
  }

  @Post('webhooks/simulator')
  @HttpCode(200)
  @UseGuards(ProviderSignatureGuard)
  webhook(@Body() dto: ProviderWebhookDto) {
    return this.payments.handleWebhook(dto);
  }
}
