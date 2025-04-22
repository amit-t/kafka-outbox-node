// Redis initialization script for Kafka Outbox Pattern

import { createClient } from 'redis';
import { logInfo, logSuccess, logError } from '../../logger';

const KEY_PREFIX = 'outbox:';

interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  keyPrefix: string;
}

async function initializeRedis(): Promise<void> {
  // Configuration
  const config: RedisConfig = {
    host: 'localhost',
    port: 6379,
    keyPrefix: KEY_PREFIX
  };

  // Create Redis client
  const client = createClient({
    url: `redis://${config.host}:${config.port}`,
  });

  try {
    await client.connect();
    logInfo('Connected to Redis');

    // Clear any existing outbox keys if needed
    // Uncomment if you want to clean up during initialization
    /*
    const keys = await client.keys(`${config.keyPrefix}*`);
    if (keys.length > 0) {
      await client.del(keys);
      logInfo(`Deleted ${keys.length} existing keys`);
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
      logSuccess('Created unpublished events sorted set');
    } else {
      logInfo('Unpublished events sorted set already exists');
    }

    logSuccess('Redis initialization complete');
  } catch (error) {
    logError('Error initializing Redis:', error);
  } finally {
    await client.quit();
    logInfo('Redis connection closed');
  }
}

// Run the initialization function
initializeRedis().catch(error => {
  logError('Failed to initialize Redis:', error);
  process.exit(1);
});
