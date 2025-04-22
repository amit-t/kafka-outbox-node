import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  ScanCommand,
  CreateTableCommand,
} from '@aws-sdk/lib-dynamodb';
import { OutboxEvent, OutboxStorage } from '../index';

export interface DynamoDBOutboxStorageConfig {
  region?: string;
  endpoint?: string;
  tableName?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
}

export class DynamoDBOutboxStorage implements OutboxStorage {
  private client: DynamoDBDocumentClient;
  private tableName: string;
  
  constructor(config: DynamoDBOutboxStorageConfig) {
    const dynamoClient = new DynamoDBClient({
      region: config.region || 'us-east-1',
      endpoint: config.endpoint,
      credentials: config.credentials,
    });
    
    this.client = DynamoDBDocumentClient.from(dynamoClient);
    this.tableName = config.tableName || 'outbox_events';
  }
  
  /**
   * Initialize the DynamoDB table if it doesn't exist
   */
  async initialize(): Promise<void> {
    try {
      const createTableParams = {
        TableName: this.tableName,
        KeySchema: [
          { AttributeName: 'id', KeyType: 'HASH' },
        ],
        AttributeDefinitions: [
          { AttributeName: 'id', AttributeType: 'S' },
          { AttributeName: 'published', AttributeType: 'N' },
          { AttributeName: 'created_at', AttributeType: 'S' },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'published-created_at-index',
            KeySchema: [
              { AttributeName: 'published', KeyType: 'HASH' },
              { AttributeName: 'created_at', KeyType: 'RANGE' },
            ],
            Projection: {
              ProjectionType: 'ALL',
            },
            ProvisionedThroughput: {
              ReadCapacityUnits: 5,
              WriteCapacityUnits: 5,
            },
          },
        ],
        ProvisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5,
        },
      };
      
      await this.client.send(new CreateTableCommand(createTableParams));
      
      // Wait for table to be created
      await new Promise(resolve => setTimeout(resolve, 5000));
      
    } catch (error: any) {
      // If table already exists, continue
      if (error.name !== 'ResourceInUseException') {
        throw error;
      }
    }
  }
  
  async saveEvent(event: OutboxEvent): Promise<void> {
    const params = {
      TableName: this.tableName,
      Item: {
        id: event.id,
        payload: JSON.stringify(event.payload),
        created_at: event.createdAt.toISOString(),
        published: event.published ? 1 : 0,
        topic: event.topic || 'default',
      },
    };
    
    await this.client.send(new PutCommand(params));
  }
  
  async markPublished(id: string): Promise<void> {
    const params = {
      TableName: this.tableName,
      Key: { id },
      UpdateExpression: 'SET published = :published, published_at = :published_at',
      ExpressionAttributeValues: {
        ':published': 1,
        ':published_at': new Date().toISOString(),
      },
    };
    
    await this.client.send(new UpdateCommand(params));
  }
  
  async getUnpublishedEvents(): Promise<OutboxEvent[]> {
    const params = {
      TableName: this.tableName,
      IndexName: 'published-created_at-index',
      KeyConditionExpression: 'published = :published',
      ExpressionAttributeValues: {
        ':published': 0,
      },
      Limit: 100,
    };
    
    try {
      const result = await this.client.send(new QueryCommand(params));
      
      if (!result.Items || result.Items.length === 0) {
        return [];
      }
      
      return result.Items.map((item: Record<string, any>) => ({
        id: item.id,
        payload: JSON.parse(item.payload),
        createdAt: new Date(item.created_at),
        published: item.published === 1,
        topic: item.topic,
      }));
    } catch (error) {
      // If the index is not ready, fall back to scan
      if ((error as any).name === 'ResourceNotFoundException') {
        const scanParams = {
          TableName: this.tableName,
          FilterExpression: 'published = :published',
          ExpressionAttributeValues: {
            ':published': 0,
          },
          Limit: 100,
        };
        
        const result = await this.client.send(new ScanCommand(scanParams));
        
        if (!result.Items || result.Items.length === 0) {
          return [];
        }
        
        return result.Items.map((item: Record<string, any>) => ({
          id: item.id,
          payload: JSON.parse(item.payload),
          createdAt: new Date(item.created_at),
          published: item.published === 1,
          topic: item.topic,
        }));
      }
      
      throw error;
    }
  }
  
  async close(): Promise<void> {
    // No explicit close needed for DynamoDB client
  }
}
