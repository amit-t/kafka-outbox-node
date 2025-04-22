-- Outbox table for storing events to be sent to Kafka
CREATE TABLE IF NOT EXISTS outbox_events (
  id VARCHAR(36) PRIMARY KEY,
  payload JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published BOOLEAN NOT NULL DEFAULT FALSE,
  topic VARCHAR(255) NOT NULL,
  published_at TIMESTAMP WITH TIME ZONE
);

-- Index for querying unpublished events
CREATE INDEX IF NOT EXISTS idx_outbox_events_published ON outbox_events(published);

-- Index for ordering by created_at
CREATE INDEX IF NOT EXISTS idx_outbox_events_created_at ON outbox_events(created_at);

-- Grants for the postgres user (default user)
GRANT ALL PRIVILEGES ON TABLE outbox_events TO postgres;
