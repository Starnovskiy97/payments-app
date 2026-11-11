import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ProviderService } from './provider.service';
import { ProviderApiGuard } from './provider-api.guard';
import { CreateInvoiceDto, CompleteInvoiceDto, NextCreateDto } from './dto';

const checkoutHtml = readFileSync(join(__dirname, '..', 'public', 'checkout.html'), 'utf8');
const checkoutScript = readFileSync(join(__dirname, '..', 'public', 'checkout.js'), 'utf8');
const axiosScript = readFileSync(
  join(dirname(require.resolve('axios/package.json')), 'dist', 'axios.min.js'),
  'utf8',
);

@ApiTags('simulator')
@Controller()
export class ProviderController {
  constructor(private readonly provider: ProviderService) {}

  @Get('health')
  health() {
    return { service: 'payment-provider-simulator', status: 'ok' };
  }

  @Post('provider/payments')
  @UseGuards(ProviderApiGuard)
  @ApiSecurity('provider')
  create(@Body() dto: CreateInvoiceDto) {
    return this.provider.create(dto);
  }

  @Get('provider/payments/:id')
  @UseGuards(ProviderApiGuard)
  @ApiSecurity('provider')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.provider.get(id);
  }

  @Get('checkout/:id')
  @Header('content-type', 'text/html; charset=utf-8')
  checkout(@Param('id', ParseUUIDPipe) _id: string) {
    return checkoutHtml;
  }

  @Get('checkout.js')
  @Header('content-type', 'application/javascript; charset=utf-8')
  script() {
    return checkoutScript;
  }

  @Get('axios.min.js')
  @Header('content-type', 'application/javascript; charset=utf-8')
  axios() {
    return axiosScript;
  }

  @Get('checkout/:id/state')
  state(@Param('id', ParseUUIDPipe) id: string) {
    return this.provider.get(id);
  }

  @Post('provider/payments/:id/complete')
  complete(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteInvoiceDto) {
    return this.provider.complete(id, dto);
  }

  @Post('simulation/next-create')
  fault(@Body() dto: NextCreateDto) {
    return this.provider.configureNextCreate(dto.delayMs);
  }
}
