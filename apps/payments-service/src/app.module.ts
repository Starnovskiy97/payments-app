import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseOptions } from './database/database-options';
import { PaymentEntity } from './database/entities/payment.entity';
import { InternalGuard } from './internal.guard';
import { PAYMENT_PROVIDER } from './providers/payment-provider';
import { SimulatorPaymentProvider } from './providers/simulator-payment.provider';
import { ProviderSignatureGuard } from './provider-signature.guard';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentsRepository } from './payments.repository';
import { PaymentEventsPublisher } from './payment-events.publisher';
import { PaymentOutboxEntity } from './database/entities/payment-outbox.entity';
import { OutboxRepository } from './outbox/outbox.repository';
import { OutboxWorker } from './outbox/outbox.worker';

@Module({
  imports: [
    TypeOrmModule.forRoot({ ...databaseOptions(), retryAttempts: 2, retryDelay: 1000 }),
    TypeOrmModule.forFeature([PaymentEntity, PaymentOutboxEntity]),
  ],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    PaymentsRepository,
    PaymentEventsPublisher,
    OutboxRepository,
    OutboxWorker,
    InternalGuard,
    ProviderSignatureGuard,
    { provide: PAYMENT_PROVIDER, useClass: SimulatorPaymentProvider },
  ],
})
export class AppModule {}
