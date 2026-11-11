import 'reflect-metadata';
import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';

async function bootstrap() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Учебный симулятор нельзя запускать в production');
  const app = await NestFactory.create(AppModule);
  if (await app.get(DataSource).showMigrations()) {
    await app.close();
    throw new Error(
      'Есть неприменённые миграции payments-service. Выполните npm run db:migrate из корня.',
    );
  }
  app.enableCors({ origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173' });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  const config = new DocumentBuilder()
    .setTitle('Payments service — только фиктивные платежи')
    .setDescription('Все способы оплаты имитируются. Реальные средства не используются.')
    .setVersion('0.1.0')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-internal-token' }, 'internal')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3002), '127.0.0.1');
}

void bootstrap();
