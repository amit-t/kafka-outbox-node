import { KafkaOutbox, createDefaultLogger } from '../src';
import { InMemoryOutboxStorage } from '../src/storage/memory';

async function run() {
  // Create a logger with pretty printing for the example
  const logger = createDefaultLogger({
    level: 'debug',
    name: 'kafka-outbox-example'
  });
  
  logger.info('Starting Kafka Outbox example...');
  
  // Create the outbox with the InMemory storage
  const outbox = new KafkaOutbox({
    kafkaBrokers: ['localhost:9092'],
    clientId: 'outbox-example',
    storage: new InMemoryOutboxStorage(),
    pollInterval: 2000, // Poll every 2 seconds
    logger // Pass the logger to the outbox
  });
  
  try {
    // Connect to Kafka
    logger.info('Connecting to Kafka...');
    await outbox.connect();
    logger.info('Connected to Kafka successfully');
    
    // Add some events to the outbox
    logger.info('Adding events to outbox...');
    await outbox.addEvent({ message: 'Hello, world!', timestamp: new Date().toISOString() });
    await outbox.addEvent({ message: 'Another event', data: { foo: 'bar' } });
    
    // Specific topic
    await outbox.addEvent(
      { message: 'Event with custom topic', priority: 'high' },
      'high-priority-events'
    );
    
    logger.info('Events added to outbox successfully');
    
    // Publish events manually
    logger.info('Publishing events...');
    const count = await outbox.publishEvents();
    logger.info(`Published ${count} events`);
    
    // Start polling (will continue to check for unpublished events)
    logger.info('Starting polling for events...');
    outbox.startPolling();
    
    // Keep the process running to demonstrate polling
    logger.info('Polling for events. Press Ctrl+C to stop...');
    
    // Handle shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down...');
      outbox.stopPolling();
      await outbox.disconnect();
      process.exit(0);
    });
    
  } catch (error) {
    logger.error(`Error in example: ${error}`);
    await outbox.disconnect();
    process.exit(1);
  }
}

run();
