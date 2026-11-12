import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class AddResultEvent1794355200004 implements MigrationInterface {
  name = 'AddResultEvent1794355200004';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE payments
      ADD COLUMN result_event_id uuid,
      ADD COLUMN result_recorded_at timestamptz,
      DROP CONSTRAINT payments_notification_status_supported`);
    await queryRunner.query(`ALTER TABLE payments ADD CONSTRAINT payments_notification_status_supported
      CHECK (notification_status IN ('not_sent', 'published', 'delivered', 'failed'))`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Откат не может называть публикацию обработкой: возвращаем такие записи в not_sent.
    await queryRunner.query(
      "UPDATE payments SET notification_status = 'not_sent' WHERE notification_status = 'published'",
    );
    await queryRunner.query(`ALTER TABLE payments DROP CONSTRAINT payments_notification_status_supported,
      DROP COLUMN result_event_id, DROP COLUMN result_recorded_at`);
    await queryRunner.query(`ALTER TABLE payments ADD CONSTRAINT payments_notification_status_supported
      CHECK (notification_status IN ('not_sent', 'delivered', 'failed'))`);
  }
}
