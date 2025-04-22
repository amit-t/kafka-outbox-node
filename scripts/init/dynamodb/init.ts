// DynamoDB initialization script for Kafka Outbox Pattern
// This script creates the required DynamoDB table with proper indexes

import { 
  DynamoDBClient, 
  CreateTableCommand, 
  ListTablesCommand,
  ListTablesCommandOutput 
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { logInfo, logSuccess, logError } from '../../logger';

interface DynamoDBConfig {
  region: string;
  endpoint: string;
  tableName: string;
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
  };
}

async function initializeDynamoDB(): Promise<void> {
  // Configuration - replace with your AWS details
  const config: DynamoDBConfig = {
    region: 'us-east-1',
    endpoint: 'http://localhost:8000', // For local DynamoDB, remove for AWS
    tableName: 'outbox_events',
    credentials: {
      // For local testing
      accessKeyId: 'local',
      secretAccessKey: 'local'
      // For AWS, use IAM or environment variables instead
    }
  };

  // Create DynamoDB client
  const dynamoClient = new DynamoDBClient({
    region: config.region,
    endpoint: config.endpoint,
    credentials: config.credentials
  });
  
  const client = DynamoDBDocumentClient.from(dynamoClient);
  
  try {
    // Check if table already exists
    const { TableNames }: ListTablesCommandOutput = await client.send(new ListTablesCommand({}));
    
    if (TableNames?.includes(config.tableName)) {
      logInfo(`Table '${config.tableName}' already exists.`);
      return;
    }
    
    // Table doesn't exist, create it
    const createTableParams = {
      TableName: config.tableName,
      KeySchema: [
        { AttributeName: 'id', KeyType: 'HASH' as const }, // Partition key
      ],
      AttributeDefinitions: [
        { AttributeName: 'id', AttributeType: 'S' as const },
        { AttributeName: 'published', AttributeType: 'N' as const },
        { AttributeName: 'created_at', AttributeType: 'S' as const },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'published-created_at-index',
          KeySchema: [
            { AttributeName: 'published', KeyType: 'HASH' as const },
            { AttributeName: 'created_at', KeyType: 'RANGE' as const },
          ],
          Projection: {
            ProjectionType: 'ALL' as const,
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
    
    await client.send(new CreateTableCommand(createTableParams));
    logSuccess(`Table '${config.tableName}' created successfully.`);
    
  } catch (error) {
    logError('Error initializing DynamoDB:', error);
  }
}

// Run the initialization function
initializeDynamoDB().catch(error => {
  logError('Failed to initialize DynamoDB:', error);
  process.exit(1);
});
