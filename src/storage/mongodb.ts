import { MongoClient, Collection, Db, Document } from 'mongodb';
import { OutboxEvent, OutboxStorage } from '../index';

export interface MongoDBOutboxStorageConfig {
  connectionString: string;
  databaseName?: string;
  collectionName?: string;
}

export class MongoDBOutboxStorage implements OutboxStorage {
  private client: MongoClient;
  private db: Db | undefined;
  private collection: Collection<Document> | undefined;
  private databaseName: string;
  private collectionName: string;
  private isExternalClient: boolean = false;
  
  /**
   * Create a MongoDB storage adapter
   * 
   * @param config Configuration for MongoDB connection
   * @param externalClient Optional externally managed MongoDB client (useful for transactions)
   */
  constructor(config: MongoDBOutboxStorageConfig, externalClient?: { client: MongoClient, db: Db }) {
    if (externalClient) {
      this.client = externalClient.client;
      this.db = externalClient.db;
      this.isExternalClient = true;
    } else {
      this.client = new MongoClient(config.connectionString);
    }
    
    this.databaseName = config.databaseName || 'outbox';
    this.collectionName = config.collectionName || 'outbox_events';
  }
  
  /**
   * Initialize the collection with proper indexes
   */
  async initialize(): Promise<void> {
    await this.connect();
    
    // Create indexes
    await this.collection!.createIndex({ published: 1 });
    await this.collection!.createIndex({ createdAt: 1 });
    await this.collection!.createIndex({ published: 1, createdAt: 1 });
  }
  
  /**
   * Connect to MongoDB if not already connected
   */
  private async connect(): Promise<void> {
    if (!this.db) {
      if (!this.isExternalClient) {
        await this.client.connect();
      }
      this.db = this.client.db(this.databaseName);
      this.collection = this.db.collection(this.collectionName);
    }
  }
  
  async saveEvent(event: OutboxEvent): Promise<void> {
    await this.connect();
    
    const document = {
      // Use the event ID as a string ID instead of _id to avoid ObjectId conversion issues
      id: event.id,
      payload: event.payload,
      createdAt: event.createdAt,
      published: event.published,
      topic: event.topic || 'default',
      publishedAt: null
    };
    
    await this.collection!.insertOne(document);
  }
  
  async markPublished(id: string): Promise<void> {
    await this.connect();
    
    await this.collection!.updateOne(
      { id: id },
      { 
        $set: { 
          published: true,
          publishedAt: new Date()
        } 
      }
    );
  }
  
  async getUnpublishedEvents(): Promise<OutboxEvent[]> {
    await this.connect();
    
    const documents = await this.collection!
      .find({ published: false })
      .sort({ createdAt: 1 })
      .limit(100)
      .toArray();
    
    return documents.map(doc => ({
      id: doc.id,
      payload: doc.payload,
      createdAt: new Date(doc.createdAt),
      published: doc.published,
      topic: doc.topic,
    }));
  }
  
  /**
   * Get all events (for debugging/admin purposes)
   */
  async getAllEvents(): Promise<OutboxEvent[]> {
    await this.connect();
    
    const documents = await this.collection!
      .find({})
      .sort({ createdAt: 1 })
      .toArray();
    
    return documents.map(doc => ({
      id: doc.id,
      payload: doc.payload,
      createdAt: new Date(doc.createdAt),
      published: doc.published,
      topic: doc.topic,
    }));
  }
  
  /**
   * Clear all events from the collection (for testing purposes)
   */
  async clear(): Promise<void> {
    await this.connect();
    await this.collection!.deleteMany({});
  }
  
  /**
   * Close the MongoDB connection if using an internal client
   */
  async close(): Promise<void> {
    if (!this.isExternalClient && this.client) {
      await this.client.close();
      this.db = undefined;
      this.collection = undefined;
    }
  }
}
