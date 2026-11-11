import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CreatePaymentDto, MockResultDto } from './dto';
import { InternalGuard } from './internal.guard';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('health')
  health() {
    return { service: 'payments-service', status: 'ok', provider: 'mock' };
  }

  @Post('payments')
  @UseGuards(InternalGuard)
  @ApiSecurity('internal')
  create(@Body() dto: CreatePaymentDto) {
    return this.payments.create(dto);
  }

  @Get('payments/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.payments.get(id);
  }

  @Post('payments/:id/mock-result')
  simulate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MockResultDto) {
    return this.payments.simulate(id, dto);
  }
}
