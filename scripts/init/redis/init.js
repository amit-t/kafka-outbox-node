// Redis initialization script for Kafka Outbox Pattern
// This script can be run with Node.js

const { createClient } = require('redis');

async function initializeRedis() {
  // Configuration - replace with your Redis connection details
  const config = {
    host: 'localhost',
    port: 6379,
    password: null, // Set to your Redis password if required
    keyPrefix: 'outbox:'
  };

  // Connect to Redis
  const client = createClient({
    socket: {
      host: config.host,
      port: config.port
    },
    password: config.password
  });

  try {
    await client.connect();
    console.log('Connected to Redis');

    // Clear any existing outbox keys if needed
    // Uncomment if you want to clean up during initialization
    /*
    const keys = await client.keys(`${config.keyPrefix}*`);
    if (keys.length > 0) {
      await client.del(keys);
      console.log(`Deleted ${keys.length} existing keys`);
    }
    */

    // Create sorted set for tracking unpublished events
    // This is just initializing the key, it will be empty
    const unpublishedSetKey = `${config.keyPrefix}unpublished`;
    const exists = await client.exists(unpublishedSetKey);
    
    if (!exists) {
      // Add a dummy record just to ensure the sorted set exists
      // This will be removed automatically when real data is added
      await client.zAdd(unpublishedSetKey, {
        score: 0,
        value: 'initialization-placeholder'
      });
      await client.zRem(unpublishedSetKey, 'initialization-placeholder');
      console.log('Created unpublished events sorted set');
    } else {
      console.log('Unpublished events sorted set already exists');
    }

    console.log('Redis initialization complete');
  } catch (error) {
    console.error('Error initializing Redis:', error);
  } finally {
    await client.quit();
  }
}

// Run the initialization function
initializeRedis().catch(console.error);
