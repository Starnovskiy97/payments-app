import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreatePaymentOutbox1794441600000 implements MigrationInterface {
  name = 'CreatePaymentOutbox1794441600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE payment_outbox (
        event_id uuid PRIMARY KEY,
        payment_id uuid NOT NULL UNIQUE REFERENCES payments(id),
        payload jsonb NOT NULL,
        status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'published')),
        attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        next_attempt_at timestamptz NOT NULL DEFAULT now(),
        locked_by uuid,
        locked_until timestamptz,
        published_at timestamptz,
        last_error varchar(1000),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT payment_outbox_lease_consistent CHECK (
          (status = 'processing' AND locked_by IS NOT NULL AND locked_until IS NOT NULL) OR
          (status <> 'processing' AND locked_by IS NULL AND locked_until IS NULL)
        ),
        CONSTRAINT payment_outbox_publication_consistent CHECK ((status = 'published') = (published_at IS NOT NULL))
      )
    `);
    await queryRunner.query(
      "CREATE INDEX payment_outbox_pending_idx ON payment_outbox(next_attempt_at, created_at) WHERE status = 'pending'",
    );
    await queryRunner.query(
      "CREATE INDEX payment_outbox_expired_lease_idx ON payment_outbox(locked_until) WHERE status = 'processing'",
    );

    // Сохраняем историю; неподтверждённые финальные результаты прошлого этапа становятся заданиями.
    await queryRunner.query(`UPDATE payments SET
      result_event_id = COALESCE(result_event_id, gen_random_uuid()),
      result_recorded_at = COALESCE(result_recorded_at, now())
      WHERE status IN ('succeeded', 'failed')`);
    await queryRunner.query(`
      INSERT INTO payment_outbox (event_id, payment_id, payload, status, attempts, published_at)
      SELECT result_event_id, id,
        jsonb_build_object(
          'eventId', result_event_id,
          'type', CASE WHEN status = 'succeeded' THEN 'payment.succeeded' ELSE 'payment.failed' END,
          'version', 1, 'paymentId', id, 'orderId', order_id, 'amount', amount, 'currency', currency,
          'occurredAt', to_char(result_recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        ),
        CASE WHEN notification_status IN ('published', 'delivered') THEN 'published' ELSE 'pending' END,
        notification_attempts,
        CASE WHEN notification_status IN ('published', 'delivered') THEN now() ELSE NULL END
      FROM payments WHERE status IN ('succeeded', 'failed')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE payment_outbox');
  }
}
