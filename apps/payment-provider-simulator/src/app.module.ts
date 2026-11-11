import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseOptions } from './database/database-options';
import { InvoiceEntity } from './database/invoice.entity';
import { ProviderService } from './provider.service';
import { ProviderController } from './provider.controller';
import { ProviderApiGuard } from './provider-api.guard';
import { InvoicesRepository } from './invoices.repository';

@Module({
  imports: [
    TypeOrmModule.forRoot({ ...databaseOptions(), retryAttempts: 2, retryDelay: 1000 }),
    TypeOrmModule.forFeature([InvoiceEntity]),
  ],
  controllers: [ProviderController],
  providers: [ProviderService, InvoicesRepository, ProviderApiGuard],
})
export class AppModule {}
