import { Module } from '@nestjs/common';
import { InternalGuard } from './internal.guard';
import { MockPaymentProvider } from './mock-payment.provider';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, MockPaymentProvider, InternalGuard],
})
export class AppModule {}
