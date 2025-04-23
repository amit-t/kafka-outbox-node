/**
 * Example showing how to use Debezium CDC with the Kafka Outbox pattern.
 * 
 * This example demonstrates:
 * 1. Setting up a PostgreSQL database with CDC enabled
 * 2. Creating an outbox table
 * 3. Configuring a Debezium connector for the outbox pattern
 * 4. Writing events to the outbox table in a transaction
 * 5. Having Debezium automatically capture and publish those events to Kafka
 */

import { Pool, PoolClient } from 'pg';
import { KafkaOutbox, DebeziumConnector, createDefaultLogger } from '../src';
import { PostgresOutboxStorage } from '../src/storage/postgres';

// Create a logger
const logger = createDefaultLogger({
  level: 'debug',
  name: 'debezium-cdc-example'
});

// Create a PostgreSQL client
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'outbox',
  user: 'postgres',
  password: 'postgres',
});

/**
 * Create the orders table and process a new order with an outbox event
 */
async function createOrderWithEvent(): Promise<string> {
  // Get a client from the pool
  const client = await pool.connect();
  
  try {
    // Begin a transaction
    await client.query('BEGIN');
    
    // 1. Insert a new order
    const orderId = 'ORD-' + Math.floor(Math.random() * 10000);
    const customerId = 'CUST-' + Math.floor(Math.random() * 1000);
    
    await client.query(`
      INSERT INTO orders (id, customer_id, amount, status, created_at)
      VALUES ($1, $2, $3, $4, $5)
    `, [orderId, customerId, 99.99, 'CREATED', new Date()]);
    
    // 2. Insert an outbox event manually
    // In a real application, you'd set up triggers to do this automatically,
    // but for this example we'll do it manually
    await client.query(`
      INSERT INTO outbox_events (
        id, 
        payload, 
        created_at, 
        published, 
        topic, 
        event_type
      ) VALUES (
        $1, 
        $2, 
        $3, 
        $4, 
        $5,
        $6
      )
    `, [
      `evt-${orderId}`,
      JSON.stringify({
        orderId,
        customerId,
        amount: 99.99,
        status: 'CREATED',
        timestamp: new Date().toISOString()
      }),
      new Date(),
      false,
      'orders',
      'OrderCreated'
    ]);
    
    // 3. Commit the transaction (both order and event are committed together)
    await client.query('COMMIT');
    
    logger.info(`Order ${orderId} created successfully with outbox event`);
    return orderId;
    
  } catch (error) {
    // If anything fails, roll back the entire transaction
    await client.query('ROLLBACK');
    logger.error(`Error creating order: ${error}`);
    throw error;
  } finally {
    // Release the client back to the pool
    client.release();
  }
}

/**
 * Initialize the database by creating the necessary tables
 */
async function initializeDatabase(): Promise<void> {
  const client = await pool.connect();
  
  try {
    // Create orders table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id VARCHAR(255) PRIMARY KEY,
        customer_id VARCHAR(255) NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        status VARCHAR(50) NOT NULL,
        created_at TIMESTAMP NOT NULL
      )
    `);
    
    // Create outbox_events table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS outbox_events (
        id VARCHAR(255) PRIMARY KEY,
        payload JSONB NOT NULL,
        created_at TIMESTAMP NOT NULL,
        published BOOLEAN NOT NULL DEFAULT false,
        topic VARCHAR(255),
        event_type VARCHAR(255) NOT NULL
      )
    `);
    
    // Set replica identity to FULL for the outbox table (needed for Debezium)
    await client.query(`
      ALTER TABLE outbox_events REPLICA IDENTITY FULL
    `);
    
    logger.info('Database initialized successfully');
  } finally {
    client.release();
  }
}

/**
 * Set up the Debezium connector
 */
async function setupDebeziumConnector(): Promise<DebeziumConnector> {
  // Create a Debezium connector to watch the outbox table
  const debeziumConnector = new DebeziumConnector({
    databaseType: 'postgres',
    host: 'localhost',
    port: 5432,
    database: 'outbox',
    username: 'postgres',
    password: 'postgres',
    outboxTable: 'outbox_events',
    connectorName: 'orders-outbox-connector',
    kafkaBootstrapServers: 'localhost:9092',
    topicPrefix: 'app.',
    logger: logger
  }, {
    eventTypeField: 'event_type',
    payloadField: 'payload',
    topicField: 'topic',
    eventIdField: 'id'
  });
  
  // Set the Kafka Connect URL (if different from default)
  debeziumConnector.setConnectUrl('http://localhost:8083');
  
  // Register the connector with Kafka Connect
  try {
    await debeziumConnector.register();
    logger.info('Debezium connector registered successfully');
  } catch (error) {
    logger.error(`Failed to register Debezium connector: ${error}`);
    // If it fails because it already exists, we can continue
    if (String(error).includes('already exists')) {
      logger.info('Connector already exists, continuing...');
    } else {
      throw error;
    }
  }
  
  return debeziumConnector;
}

/**
 * Main function to run the example
 */
async function run() {
  try {
    logger.info('Starting Debezium CDC example...');
    
    // Initialize the database
    await initializeDatabase();
    
    // Set up the Debezium connector
    const debeziumConnector = await setupDebeziumConnector();
    
    // Create an order with an event
    // The event will be automatically picked up and published by Debezium
    const orderId = await createOrderWithEvent();
    logger.info(`Created order ${orderId} with event. Debezium will automatically publish it.`);
    
    // In a real application, you'd keep running, but for this example we'll wait briefly
    // to allow Debezium to pick up the change, then shut down
    logger.info('Waiting for Debezium to process the event (5 seconds)...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check the status of the connector
    const status = await debeziumConnector.getStatus();
    logger.info(`Connector status: ${JSON.stringify(status)}`);
    
    // Unregister the connector (optional, you might want to keep it running in a real app)
    // await debeziumConnector.unregister();
    // logger.info('Debezium connector unregistered');
    
    logger.info('Example completed successfully.');
    
  } catch (error) {
    logger.error(`Example failed: ${error}`);
  } finally {
    // Close the pool
    await pool.end();
  }
}

// Run the example
if (require.main === module) {
  run().catch(error => {
    logger.error(`Unhandled error: ${error}`);
    process.exit(1);
  });
}
