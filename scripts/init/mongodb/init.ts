// MongoDB initialization script for Kafka Outbox Pattern

import { MongoClient } from 'mongodb';

async function initializeMongoDB(): Promise<void> {
  // Configuration
  const config = {
    connectionString: 'mongodb://localhost:27017',
    databaseName: 'outbox'
  };

  // Connect to MongoDB
  const client = new MongoClient(config.connectionString);

  try {
    await client.connect();
    console.log('Connected to MongoDB');

    // Get database
    const db = client.db(config.databaseName);

    // Check if collections exist and create them if they don't
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);

    // Create outbox_events collection if it doesn't exist
    if (!collectionNames.includes('outbox_events')) {
      await db.createCollection('outbox_events');
      console.log('Created outbox_events collection');
    }

    // Create indexes for efficient querying
    await db.collection('outbox_events').createIndex({ "published": 1 });
    await db.collection('outbox_events').createIndex({ "createdAt": 1 });
    await db.collection('outbox_events').createIndex({ "published": 1, "createdAt": 1 });
    console.log('Created indexes on outbox_events collection');

    // Create orders collection for transaction examples
    if (!collectionNames.includes('orders')) {
      await db.createCollection('orders');
      console.log('Created orders collection');
    }

    // Create indexes for orders collection
    await db.collection('orders').createIndex({ "customerId": 1 });
    await db.collection('orders').createIndex({ "createdAt": 1 });
    console.log('Created indexes on orders collection');

    console.log('MongoDB initialization complete');
  } catch (error) {
    console.error('Error initializing MongoDB:', error);
  } finally {
    await client.close();
    console.log('MongoDB connection closed');
  }
}

// Run the initialization function
initializeMongoDB().catch(error => {
  console.error('Failed to initialize MongoDB:', error);
  process.exit(1);
});
