#!/usr/bin/env tsx
/**
 * Script to register a Debezium connector for the outbox pattern.
 * This is useful for testing and development without having to manually configure
 * the connector through the Kafka Connect REST API.
 */

// Using require for cross-fetch for better compatibility
const fetch = global.fetch || require('cross-fetch');
import { logInfo, logSuccess, logError } from './logger';

// Default connector configuration
const DEFAULT_CONFIG = {
  name: 'outbox-connector',
  config: {
    'connector.class': 'io.debezium.connector.postgresql.PostgresConnector',
    'tasks.max': '1',
    'database.hostname': 'localhost',
    'database.port': '5432',
    'database.user': 'postgres',
    'database.password': 'postgres',
    'database.dbname': 'outbox',
    'topic.prefix': 'outbox',
    'table.include.list': 'public.outbox_events',
    'tombstones.on.delete': 'false',
    'plugin.name': 'pgoutput',
    'publication.name': 'dbz_publication',
    'slot.name': 'debezium_slot',
    
    // Outbox Event Router configuration
    'transforms': 'outbox',
    'transforms.outbox.type': 'io.debezium.transforms.outbox.EventRouter',
    'transforms.outbox.table.field.event.id': 'id',
    'transforms.outbox.table.field.event.key': 'id',
    'transforms.outbox.table.field.event.payload': 'payload',
    'transforms.outbox.table.field.event.type': 'event_type',
    'transforms.outbox.topic.property.name': 'topic',
    'transforms.outbox.route.by.field': 'topic',
    'transforms.outbox.route.topic.replacement': '${routedByValue}',
    
    // Converter configuration
    'key.converter': 'org.apache.kafka.connect.json.JsonConverter',
    'value.converter': 'org.apache.kafka.connect.json.JsonConverter',
    'key.converter.schemas.enable': 'false',
    'value.converter.schemas.enable': 'false'
  }
};

/**
 * Register a connector with Kafka Connect
 */
async function registerConnector(
  connectUrl: string = 'http://localhost:8083',
  config: any = DEFAULT_CONFIG
): Promise<void> {
  try {
    logInfo(`Registering connector ${config.name} with Kafka Connect at ${connectUrl}`);
    
    // Check if the connector already exists
    const checkResponse = await fetch(`${connectUrl}/connectors/${config.name}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });
    
    // If connector exists, delete it first
    if (checkResponse.ok) {
      logInfo(`Connector ${config.name} already exists. Deleting it first...`);
      const deleteResponse = await fetch(`${connectUrl}/connectors/${config.name}`, {
        method: 'DELETE'
      });
      
      if (!deleteResponse.ok) {
        const errorText = await deleteResponse.text();
        throw new Error(`Failed to delete existing connector: ${deleteResponse.status} ${deleteResponse.statusText} - ${errorText}`);
      }
      
      logSuccess(`Deleted existing connector ${config.name}`);
      
      // Brief delay to ensure connector is removed
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Register the connector
    const response = await fetch(`${connectUrl}/connectors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(config)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to register connector: ${response.status} ${response.statusText} - ${errorText}`);
    }
    
    const result = await response.json();
    logSuccess(`Successfully registered connector: ${result.name}`);
    logInfo(JSON.stringify(result, null, 2));
    
  } catch (error) {
    logError('Error registering Debezium connector:', error);
    process.exit(1);
  }
}

// Main function
async function main(): Promise<void> {
  const connectUrl = process.env.CONNECT_URL || 'http://localhost:8083';
  
  // Allow overriding configuration through command-line arguments
  const args = process.argv.slice(2);
  if (args.length > 0) {
    const configPath = args[0];
    try {
      // Attempt to load configuration from file
      const customConfig = require(configPath);
      await registerConnector(connectUrl, customConfig);
    } catch (error) {
      logError(`Error loading custom configuration from ${configPath}:`, error);
      process.exit(1);
    }
  } else {
    // Use default configuration
    await registerConnector(connectUrl, DEFAULT_CONFIG);
  }
}

// Run if this file is executed directly
if (require.main === module) {
  main();
}

export { registerConnector, DEFAULT_CONFIG };
