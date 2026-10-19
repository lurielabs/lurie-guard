-- Test migration for the first PR on the published repository: the mistakes
-- lurie-guard exists to catch, on a table that already holds production data.
CREATE INDEX orders_status_idx ON orders (status);

ALTER TABLE orders ADD COLUMN region text NOT NULL;

ALTER TABLE order_items
  ADD CONSTRAINT order_items_order_fk FOREIGN KEY (order_id) REFERENCES orders (id);
