# Payments Lab

Учебный проект для изучения микросервисов и платежей: React-клиент, NestJS-сервисы заказов и платежей, отдельный симулятор платёжного провайдера. PostgreSQL хранит данные каждого сервиса, RabbitMQ доставляет события.

**Настоящие деньги не используются. Стенд предназначен только для локальной разработки.**

## Быстрый запуск

Нужны Node.js 22.14+, npm и запущенный Docker с Docker Compose v2.

```bash
npm install
npm run db:up
npm run mq:up
npm run db:migrate
npm run dev
```

- Клиент: http://localhost:5173
- Swagger заказов: http://127.0.0.1:3001/docs
- Swagger платежей: http://127.0.0.1:3002/docs
- Swagger симулятора: http://127.0.0.1:3003/docs
- RabbitMQ Management: http://127.0.0.1:15672 — `lab / lab_local`

Для первого запуска `.env` не требуется. Примеры настроек — в папках приложений.

## Проверки и остановка

```bash
npm test
npm run typecheck
npm run format:check
```

`Ctrl+C` останавливает приложения. `npm run db:down` и `npm run mq:down` останавливают инфраструктуру без удаления данных. Для тестовой инфраструктуры — `npm run db:test:down` и `npm run mq:test:down`.

## Документация

- [Руководство: архитектура, конфигурация, API и эксперименты](docs/project-guide.md).
- [Учебные разборы бэкенда](docs/backend/01-postgresql-orders.md).
- [Текущий этап: transactional outbox/inbox](docs/backend/05-outbox-inbox.md).
- [План обучения](docs/plans/microservices-payments-learning.md).
