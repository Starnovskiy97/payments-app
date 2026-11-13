import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreatePaymentInbox1794441600001 implements MigrationInterface {
  name = 'CreatePaymentInbox1794441600001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE payment_inbox (
      event_id uuid PRIMARY KEY,
      payload_hash char(64) NOT NULL,
      event_type varchar(64) NOT NULL,
      order_id uuid NOT NULL,
      processed_at timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query('CREATE INDEX payment_inbox_order_idx ON payment_inbox(order_id)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE payment_inbox');
  }
}
