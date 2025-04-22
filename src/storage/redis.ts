import { createClient, RedisClientType } from 'redis';
import { OutboxEvent, OutboxStorage } from '../index';

export interface RedisOutboxStorageConfig {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  keyPrefix?: string;
  unpublishedSetKey?: string;
}

export class RedisOutboxStorage implements OutboxStorage {
  private client: RedisClientType;
  private keyPrefix: string;
  private unpublishedSetKey: string;
  private isExternalClient: boolean = false;
  
  /**
   * Create a Redis storage adapter
   * 
   * @param config Configuration for Redis connection
   * @param externalClient Optional externally managed Redis client
   */
  constructor(config: RedisOutboxStorageConfig, externalClient?: RedisClientType) {
    this.keyPrefix = config.keyPrefix || 'outbox:';
    this.unpublishedSetKey = config.unpublishedSetKey || 'outbox:unpublished';
    
    if (externalClient) {
      this.client = externalClient;
      this.isExternalClient = true;
    } else {
      this.client = createClient({
        url: config.url,
        socket: {
          host: config.host || 'localhost',
          port: config.port || 6379,
        },
        password: config.password,
      });
    }
  }
  
  /**
   * Connect to Redis if not already connected
   */
  private async connect(): Promise<void> {
    if (!this.isExternalClient && !this.client.isOpen) {
      await this.client.connect();
    }
  }
  
  async saveEvent(event: OutboxEvent): Promise<void> {
    await this.connect();
    
    const eventKey = `${this.keyPrefix}${event.id}`;
    const eventData = {
      id: event.id,
      payload: JSON.stringify(event.payload),
      createdAt: event.createdAt.toISOString(),
      published: event.published,
      topic: event.topic || 'default',
      publishedAt: null,
    };
    
    // Create a Redis transaction (multi) to ensure atomicity
    const multi = this.client.multi();
    
    // Store the event as a hash
    multi.hSet(eventKey, eventData as any);
    
    // If event is not published, add the event ID to the unpublished set
    if (!event.published) {
      multi.zAdd(this.unpublishedSetKey, {
        score: event.createdAt.getTime(),
        value: event.id,
      });
    }
    
    // Execute the transaction
    await multi.exec();
  }
  
  async markPublished(id: string): Promise<void> {
    await this.connect();
    
    const eventKey = `${this.keyPrefix}${id}`;
    
    // Create a Redis transaction (multi) to ensure atomicity
    const multi = this.client.multi();
    
    // Update the published status and publishedAt timestamp
    multi.hSet(eventKey, {
      published: true,
      publishedAt: new Date().toISOString(),
    } as any);
    
    // Remove the event ID from the unpublished set
    multi.zRem(this.unpublishedSetKey, id);
    
    // Execute the transaction
    await multi.exec();
  }
  
  async getUnpublishedEvents(): Promise<OutboxEvent[]> {
    await this.connect();
    
    // Get event IDs from the unpublished set, ordered by createdAt timestamp (score)
    const eventIds = await this.client.zRange(this.unpublishedSetKey, 0, 99);
    
    if (eventIds.length === 0) {
      return [];
    }
    
    const events: OutboxEvent[] = [];
    
    for (const id of eventIds) {
      const eventKey = `${this.keyPrefix}${id}`;
      const eventData = await this.client.hGetAll(eventKey);
      
      if (eventData && Object.keys(eventData).length > 0) {
        events.push({
          id: eventData.id,
          payload: JSON.parse(eventData.payload),
          createdAt: new Date(eventData.createdAt),
          published: eventData.published === 'true',
          topic: eventData.topic,
        });
      }
    }
    
    return events;
  }
  
  /**
   * Get all events (for debugging/admin purposes)
   */
  async getAllEvents(): Promise<OutboxEvent[]> {
    await this.connect();
    
    // Scan all keys matching the prefix pattern
    const keys: string[] = [];
    let cursor = 0;
    
    do {
      const result = await this.client.scan(cursor, {
        MATCH: `${this.keyPrefix}*`,
        COUNT: 100,
      });
      
      cursor = result.cursor;
      keys.push(...result.keys);
    } while (cursor !== 0);
    
    // Filter out non-event keys
    const eventKeys = keys.filter(key => 
      key !== this.unpublishedSetKey && key.startsWith(this.keyPrefix));
    
    if (eventKeys.length === 0) {
      return [];
    }
    
    const events: OutboxEvent[] = [];
    
    for (const key of eventKeys) {
      const eventData = await this.client.hGetAll(key);
      
      if (eventData && Object.keys(eventData).length > 0) {
        events.push({
          id: eventData.id,
          payload: JSON.parse(eventData.payload),
          createdAt: new Date(eventData.createdAt),
          published: eventData.published === 'true',
          topic: eventData.topic,
        });
      }
    }
    
    return events;
  }
  
  /**
   * Clear all events from Redis (for testing purposes)
   */
  async clear(): Promise<void> {
    await this.connect();
    
    // Scan all keys matching the prefix pattern
    const keys: string[] = [];
    let cursor = 0;
    
    do {
      const result = await this.client.scan(cursor, {
        MATCH: `${this.keyPrefix}*`,
        COUNT: 100,
      });
      
      cursor = result.cursor;
      keys.push(...result.keys);
    } while (cursor !== 0);
    
    if (keys.length > 0) {
      await this.client.del(keys);
    }
  }
  
  /**
   * Close the Redis connection if using an internal client
   */
  async close(): Promise<void> {
    if (!this.isExternalClient && this.client.isOpen) {
      await this.client.quit();
    }
  }
}
