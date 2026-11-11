import 'reflect-metadata';
import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Учебное приложение не предназначено для production');
  }
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173' });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  const config = new DocumentBuilder()
    .setTitle('Orders service — учебный API')
    .setDescription('Заказы и HTTP-взаимодействие с payments-service. Суммы в копейках.')
    .setVersion('0.1.0')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-internal-token' }, 'internal')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3001), '127.0.0.1');
}

void bootstrap();
