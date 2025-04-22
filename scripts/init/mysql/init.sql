-- MySQL initialization script for Kafka Outbox Pattern

-- Create database if it doesn't exist
CREATE DATABASE IF NOT EXISTS outbox;

-- Use the outbox database
USE outbox;

-- Create outbox_events table for storing events to be sent to Kafka
CREATE TABLE IF NOT EXISTS outbox_events (
  id VARCHAR(36) PRIMARY KEY,
  payload JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published BOOLEAN NOT NULL DEFAULT FALSE,
  topic VARCHAR(255) NOT NULL,
  published_at TIMESTAMP NULL
) ENGINE=InnoDB;

-- Index for querying unpublished events
CREATE INDEX IF NOT EXISTS idx_outbox_events_published ON outbox_events(published);

-- Index for ordering by created_at
CREATE INDEX IF NOT EXISTS idx_outbox_events_created_at ON outbox_events(created_at);

-- Compound index for efficient querying of unpublished events by creation time
CREATE INDEX IF NOT EXISTS idx_outbox_events_pub_created ON outbox_events(published, created_at);

-- Create example orders table (for transaction examples)
CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(36) PRIMARY KEY,
  customer_id VARCHAR(36) NOT NULL,
  total_amount DECIMAL(10, 2) NOT NULL,
  status VARCHAR(20) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
