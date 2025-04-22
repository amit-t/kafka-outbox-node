// DynamoDB initialization script for Kafka Outbox Pattern
// This script creates the required DynamoDB table with proper indexes

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { CreateTableCommand, DynamoDBDocumentClient, ListTablesCommand } = require('@aws-sdk/lib-dynamodb');

async function initializeDynamoDB() {
  // Configuration - replace with your AWS details
  const config = {
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
    const { TableNames } = await client.send(new ListTablesCommand({}));
    
    if (TableNames.includes(config.tableName)) {
      console.log(`Table '${config.tableName}' already exists.`);
      return;
    }
    
    // Table doesn't exist, create it
    const createTableParams = {
      TableName: config.tableName,
      KeySchema: [
        { AttributeName: 'id', KeyType: 'HASH' }, // Partition key
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
    
    await client.send(new CreateTableCommand(createTableParams));
    console.log(`Table '${config.tableName}' created successfully.`);
    
  } catch (error) {
    console.error('Error initializing DynamoDB:', error);
  }
}

// Run the initialization function
initializeDynamoDB().catch(console.error);
