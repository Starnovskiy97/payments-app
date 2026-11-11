import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreatePayments1794355200001 implements MigrationInterface {
  name = 'CreatePayments1794355200001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE payments (
        id uuid PRIMARY KEY,
        order_id uuid NOT NULL,
        idempotency_key varchar(128) NOT NULL
          CONSTRAINT payments_key_format CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
        amount integer NOT NULL CONSTRAINT payments_amount_range CHECK (amount BETWEEN 1 AND 100000000),
        currency varchar(3) NOT NULL CONSTRAINT payments_currency_supported CHECK (currency = 'RUB'),
        method varchar(16) NOT NULL CONSTRAINT payments_method_supported CHECK (method IN ('card', 'sbp', 'crypto')),
        provider varchar(32) NOT NULL,
        status varchar(16) NOT NULL DEFAULT 'pending'
          CONSTRAINT payments_status_supported CHECK (status IN ('pending', 'succeeded', 'failed')),
        notification_status varchar(16) NOT NULL DEFAULT 'not_sent'
          CONSTRAINT payments_notification_status_supported CHECK (notification_status IN ('not_sent', 'delivered', 'failed')),
        notification_attempts integer NOT NULL DEFAULT 0
          CONSTRAINT payments_notification_attempts_nonnegative CHECK (notification_attempts >= 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT payments_order_key_unique UNIQUE (order_id, idempotency_key)
      )
    `);
    // Отказы остаются в истории, но не блокируют новую попытку оплаты.
    await queryRunner.query(`
      CREATE UNIQUE INDEX payments_one_active_per_order
      ON payments(order_id) WHERE status IN ('pending', 'succeeded')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE payments');
  }
}
