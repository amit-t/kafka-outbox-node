import { KafkaOutbox } from '../src';
import { PostgresOutboxStorage } from '../src/storage/postgres';

async function run() {
  console.log('Starting Kafka Outbox example...');
  
  // Create a Postgres storage instance
  const storage = new PostgresOutboxStorage({
    host: 'localhost',
    port: 5432,
    database: 'outbox',
    user: 'postgres',
    password: 'postgres',
  });
  
  // Create the outbox with the Postgres storage
  const outbox = new KafkaOutbox({
    kafkaBrokers: ['localhost:29092'],
    defaultTopic: 'outbox-events',
    clientId: 'example-app',
    storage,
    pollInterval: 2000, // Poll every 2 seconds
  });
  
  try {
    // Connect to Kafka
    console.log('Connecting to Kafka...');
    await outbox.connect();
    console.log('Connected to Kafka successfully');
    
    // Add some events to the outbox
    console.log('Adding events to outbox...');
    await outbox.addEvent({ message: 'Hello, world!', timestamp: new Date().toISOString() });
    await outbox.addEvent({ message: 'Another event', data: { foo: 'bar' } });
    
    // Specific topic
    await outbox.addEvent(
      { message: 'Event with custom topic', priority: 'high' },
      'high-priority-events'
    );
    
    console.log('Events added to outbox successfully');
    
    // Publish events manually
    console.log('Publishing events...');
    const count = await outbox.publishEvents();
    console.log(`Published ${count} events`);
    
    // Start polling (will continue to check for unpublished events)
    console.log('Starting polling for events...');
    outbox.startPolling();
    
    // Keep the process running to demonstrate polling
    console.log('Polling for events. Press Ctrl+C to stop...');
    
    // Handle shutdown
    process.on('SIGINT', async () => {
      console.log('Shutting down...');
      outbox.stopPolling();
      await outbox.disconnect();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('Error in example:', error);
    await outbox.disconnect();
    process.exit(1);
  }
}

run();
