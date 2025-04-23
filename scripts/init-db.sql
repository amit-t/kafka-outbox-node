-- Outbox table for storing events to be sent to Kafka
-- This schema is optimized for use with Debezium CDC
CREATE TABLE IF NOT EXISTS outbox_events (
  id VARCHAR(36) PRIMARY KEY,
  payload JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published BOOLEAN NOT NULL DEFAULT FALSE,
  topic VARCHAR(255) NOT NULL,
  published_at TIMESTAMP WITH TIME ZONE,
  event_type VARCHAR(255) -- Required by Debezium outbox event router
);

-- Set replica identity to FULL for Debezium CDC
ALTER TABLE outbox_events REPLICA IDENTITY FULL;

-- Index for querying unpublished events
CREATE INDEX IF NOT EXISTS idx_outbox_events_published ON outbox_events(published);

-- Index for ordering by created_at
CREATE INDEX IF NOT EXISTS idx_outbox_events_created_at ON outbox_events(created_at);

-- Grants for the postgres user (default user)
GRANT ALL PRIVILEGES ON TABLE outbox_events TO postgres;

-- Setup for Debezium CDC
-- Create a publication for the outbox table (used by Debezium)
DROP PUBLICATION IF EXISTS dbz_publication;
CREATE PUBLICATION dbz_publication FOR TABLE outbox_events;

-- Create a test table for orders
CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(255) PRIMARY KEY,
  customer_id VARCHAR(255) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  status VARCHAR(50) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Grant privileges
GRANT ALL PRIVILEGES ON TABLE orders TO postgres;

-- Add orders to the publication
ALTER PUBLICATION dbz_publication ADD TABLE orders;
