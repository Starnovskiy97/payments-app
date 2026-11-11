import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreateInvoices1794355200002 implements MigrationInterface {
  name = 'CreateInvoices1794355200002';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE invoices (
        id uuid PRIMARY KEY,
        merchant_payment_id uuid NOT NULL UNIQUE,
        amount integer NOT NULL CHECK (amount BETWEEN 1 AND 100000000),
        currency varchar(3) NOT NULL CHECK (currency = 'RUB'),
        method varchar(16) NOT NULL CHECK (method IN ('card', 'sbp', 'crypto')),
        status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
        event_id uuid,
        webhook_status varchar(16) NOT NULL DEFAULT 'not_sent' CHECK (webhook_status IN ('not_sent', 'delivered', 'failed')),
        webhook_attempts integer NOT NULL DEFAULT 0 CHECK (webhook_attempts >= 0),
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE invoices');
  }
}
