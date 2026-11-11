import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class AddProviderReference1794355200003 implements MigrationInterface {
  name = 'AddProviderReference1794355200003';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE payments ADD COLUMN provider_payment_id varchar(128), ADD COLUMN checkout_url varchar(2048)',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX payments_provider_reference_unique ON payments(provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX payments_provider_reference_unique');
    await queryRunner.query(
      'ALTER TABLE payments DROP COLUMN provider_payment_id, DROP COLUMN checkout_url',
    );
  }
}
