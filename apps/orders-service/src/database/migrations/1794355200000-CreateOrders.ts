import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreateOrders1794355200000 implements MigrationInterface {
  name = 'CreateOrders1794355200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE orders (
        id uuid PRIMARY KEY,
        amount integer NOT NULL CONSTRAINT orders_amount_positive CHECK (amount > 0),
        currency varchar(3) NOT NULL CONSTRAINT orders_currency_supported CHECK (currency = 'RUB'),
        status varchar(16) NOT NULL DEFAULT 'pending'
          CONSTRAINT orders_status_supported CHECK (status IN ('pending', 'paid')),
        payment_ids uuid[] NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE order_items (
        id uuid PRIMARY KEY,
        order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id varchar(100) NOT NULL,
        product_name varchar(255) NOT NULL,
        unit_price integer NOT NULL CONSTRAINT order_items_price_positive CHECK (unit_price > 0),
        quantity integer NOT NULL CONSTRAINT order_items_quantity_range CHECK (quantity BETWEEN 1 AND 10)
      )
    `);
    await queryRunner.query('CREATE INDEX order_items_order_id_idx ON order_items(order_id)');
    await queryRunner.query('CREATE INDEX orders_created_at_idx ON orders(created_at DESC)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE order_items');
    await queryRunner.query('DROP TABLE orders');
  }
}
