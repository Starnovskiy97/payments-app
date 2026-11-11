import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseOptions } from './database/database-options';
import { PaymentEntity } from './database/entities/payment.entity';
import { InternalGuard } from './internal.guard';
import { MockPaymentProvider } from './mock-payment.provider';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentsRepository } from './payments.repository';

@Module({
  imports: [
    TypeOrmModule.forRoot({ ...databaseOptions(), retryAttempts: 2, retryDelay: 1000 }),
    TypeOrmModule.forFeature([PaymentEntity]),
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentsRepository, MockPaymentProvider, InternalGuard],
})
export class AppModule {}
