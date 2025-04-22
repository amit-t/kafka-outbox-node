/**
 * Advanced example demonstrating the Outbox pattern with PostgreSQL transactions
 * 
 * This example shows how to:
 * 1. Use the Outbox pattern with a real database transaction
 * 2. Create an order and publish an event in the same transaction
 * 3. Handle failures gracefully
 */
import { Pool } from 'pg';
import { KafkaOutbox } from '../src';
import { PostgresOutboxStorage } from '../src/storage/postgres';

// Create a PostgreSQL client
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'outbox',
  user: 'postgres',
  password: 'postgres',
});

// Simple Order model
interface Order {
  id: string;
  customerId: string;
  totalAmount: number;
  status: 'pending' | 'completed' | 'cancelled';
  createdAt: Date;
}

async function createOrderWithEvent() {
  // Get a client from the pool
  const client = await pool.connect();
  
  try {
    // Start a transaction
    await client.query('BEGIN');
    
    // 1. Create the order in the database
    const orderId = crypto.randomUUID();
    const order: Order = {
      id: orderId,
      customerId: 'cust-123',
      totalAmount: 99.99,
      status: 'pending',
      createdAt: new Date(),
    };
    
    const insertQuery = `
      INSERT INTO orders (id, customer_id, total_amount, status, created_at)
      VALUES ($1, $2, $3, $4, $5)
    `;
    
    await client.query(insertQuery, [
      order.id,
      order.customerId,
      order.totalAmount,
      order.status,
      order.createdAt,
    ]);
    
    // 2. Create an event in the outbox table in the SAME transaction
    const storage = new PostgresOutboxStorage({
      // Use the same client that's managing the transaction
      client, // <-- This is the important part - sharing the transaction
    });
    
    const outbox = new KafkaOutbox({
      kafkaBrokers: ['localhost:29092'],
      defaultTopic: 'order-events',
      storage,
    });
    
    // Add event to outbox (this uses the same transaction)
    await outbox.addEvent({
      eventType: 'order_created',
      orderId: order.id,
      customerId: order.customerId,
      totalAmount: order.totalAmount,
      timestamp: order.createdAt.toISOString(),
    });
    
    // 3. Commit the transaction (both order and event are committed together)
    await client.query('COMMIT');
    
    console.log(`Order ${orderId} created successfully with outbox event`);
    
    // Connect to Kafka to publish the event 
    // (this happens outside the transaction)
    const kafkaOutbox = new KafkaOutbox({
      kafkaBrokers: ['localhost:29092'],
      defaultTopic: 'order-events',
      storage: new PostgresOutboxStorage({
        host: 'localhost',
        port: 5432,
        database: 'outbox',
        user: 'postgres',
        password: 'postgres',
      }),
    });
    
    await kafkaOutbox.connect();
    
    try {
      // Publish any unpublished events 
      const count = await kafkaOutbox.publishEvents();
      console.log(`Published ${count} events to Kafka`);
    } finally {
      await kafkaOutbox.disconnect();
    }
    
  } catch (error) {
    // If anything fails, roll back the entire transaction
    await client.query('ROLLBACK');
    console.error('Error creating order:', error);
    throw error;
  } finally {
    // Release the client back to the pool
    client.release();
  }
}

// Function to create the database tables if they don't exist
async function initializeDatabase() {
  const client = await pool.connect();
  try {
    // Create orders table
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id VARCHAR(36) PRIMARY KEY,
        customer_id VARCHAR(36) NOT NULL,
        total_amount DECIMAL(10, 2) NOT NULL,
        status VARCHAR(20) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL
      )
    `);
    
    // The outbox table should be created by the PostgresOutboxStorage
    // but we're adding it here explicitly for the example
    await client.query(`
      CREATE TABLE IF NOT EXISTS outbox_events (
        id VARCHAR(36) PRIMARY KEY,
        payload JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        published BOOLEAN NOT NULL DEFAULT FALSE,
        topic VARCHAR(255) NOT NULL,
        published_at TIMESTAMP WITH TIME ZONE
      )
    `);
    
    console.log('Database initialized successfully');
  } finally {
    client.release();
  }
}

// Run the example
async function run() {
  try {
    await initializeDatabase();
    await createOrderWithEvent();
  } catch (error) {
    console.error('Example failed:', error);
  } finally {
    // Close the pool
    await pool.end();
  }
}

run();
