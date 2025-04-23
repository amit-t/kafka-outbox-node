import { Logger } from '../logger';
// Using any for fetch to avoid type errors
const fetch = global.fetch || require('cross-fetch');

/**
 * Configuration options for the Debezium CDC connector.
 * 
 * @interface DebeziumConfig
 */
export interface DebeziumConfig {
  /**
   * The database type to connect to
   */
  databaseType: 'postgres' | 'mysql' | 'mongodb';
  
  /**
   * Host of the database to connect to
   */
  host: string;
  
  /**
   * Port of the database to connect to
   */
  port: number;
  
  /**
   * Database name to connect to
   */
  database: string;
  
  /**
   * Username for database authentication
   */
  username: string;
  
  /**
   * Password for database authentication
   */
  password: string;
  
  /**
   * Name of the table/collection containing outbox events
   * Default: 'outbox_events'
   */
  outboxTable?: string;
  
  /**
   * Debezium connector name, used for identification
   * Default: 'kafka-outbox-connector'
   */
  connectorName?: string;
  
  /**
   * Kafka bootstrap servers for Debezium's Connect API
   * Default: 'localhost:9092'
   */
  kafkaBootstrapServers?: string;
  
  /**
   * Topic prefix for outbox events
   * Default: 'outbox.'
   */
  topicPrefix?: string;
  
  /**
   * Schema registry URL if using Avro serialization (optional)
   */
  schemaRegistryUrl?: string;
  
  /**
   * Additional Debezium connector configuration properties
   */
  additionalConfig?: Record<string, string>;
  
  /**
   * Logger instance
   */
  logger?: Logger;
}

/**
 * Mapper function that transforms outbox event fields to Kafka message fields
 */
export type EventTransformer = (event: Record<string, any>) => {
  topic?: string;
  key?: string;
  value: any;
  headers?: Record<string, string>;
};

/**
 * Options for the Debezium outbox event router
 */
export interface OutboxRouterOptions {
  /**
   * Field in the outbox table that contains the event type/aggregate type
   * Default: 'eventType'
   */
  eventTypeField?: string;
  
  /**
   * Field in the outbox table that contains the payload
   * Default: 'payload'
   */
  payloadField?: string;
  
  /**
   * Field in the outbox table that contains the topic name override (if any)
   * Default: 'topic'
   */
  topicField?: string;
  
  /**
   * Field in the outbox table that contains the event key
   * Default: 'id'
   */
  eventIdField?: string;
  
  /**
   * Custom event transformer function
   */
  eventTransformer?: EventTransformer;
}

/**
 * Type of the HTTP response when registering a Debezium connector
 */
interface ConnectorResponse {
  name: string;
  config: Record<string, string>;
  tasks: { connector: string; task: number }[];
}

/**
 * Debezium CDC Connector for the Kafka Outbox pattern.
 * 
 * This class manages the lifecycle of a Debezium connector that watches for
 * changes to the outbox table and automatically publishes them to Kafka.
 * 
 * @example
 * ```typescript
 * const debeziumConnector = new DebeziumConnector({
 *   databaseType: 'postgres',
 *   host: 'localhost',
 *   port: 5432,
 *   database: 'mydb',
 *   username: 'postgres',
 *   password: 'postgres',
 *   topicPrefix: 'myapp.',
 *   logger: myLogger
 * });
 * 
 * // Register the connector with Kafka Connect
 * await debeziumConnector.register();
 * 
 * // Later, when shutting down the application
 * await debeziumConnector.unregister();
 * ```
 */
export class DebeziumConnector {
  private config: DebeziumConfig;
  private routerOptions: OutboxRouterOptions;
  private logger: Logger;
  private connectUrl: string;
  private isRegistered: boolean = false;

  /**
   * Creates a new DebeziumConnector instance.
   * 
   * @param config Configuration for the Debezium connector
   * @param routerOptions Options for the outbox event router
   */
  constructor(config: DebeziumConfig, routerOptions: OutboxRouterOptions = {}) {
    this.config = {
      outboxTable: 'outbox_events',
      connectorName: 'kafka-outbox-connector',
      kafkaBootstrapServers: 'localhost:9092',
      topicPrefix: 'outbox.',
      ...config
    };
    
    this.routerOptions = {
      eventTypeField: 'eventType',
      payloadField: 'payload',
      topicField: 'topic',
      eventIdField: 'id',
      ...routerOptions
    };
    
    this.logger = this.config.logger || console as unknown as Logger;
    
    // Set the Kafka Connect REST API URL (default to localhost:8083)
    this.connectUrl = 'http://localhost:8083';
  }
  
  /**
   * Sets the Kafka Connect REST API URL.
   * 
   * @param url The Kafka Connect REST API URL
   */
  setConnectUrl(url: string): void {
    this.connectUrl = url;
  }
  
  /**
   * Builds the Debezium connector configuration based on the database type.
   * 
   * @returns The connector configuration object
   */
  private buildConnectorConfig(): Record<string, string> {
    const { databaseType, host, port, database, username, password, outboxTable, connectorName, topicPrefix } = this.config;
    const { eventTypeField, payloadField, topicField, eventIdField } = this.routerOptions;
    
    // Base connector config
    const config: Record<string, string> = {
      "name": connectorName!,
      "connector.class": this.getConnectorClass(databaseType),
      "tasks.max": "1",
      "database.hostname": host,
      "database.port": port.toString(),
      "database.user": username,
      "database.password": password,
      "database.dbname": database,
      "topic.prefix": topicPrefix!,
      "table.include.list": outboxTable!,
      "tombstones.on.delete": "false",
      
      // Outbox router configuration
      "transforms": "outbox",
      "transforms.outbox.type": "io.debezium.transforms.outbox.EventRouter",
      "transforms.outbox.table.field.event.id": eventIdField!,
      "transforms.outbox.table.field.event.key": eventIdField!,
      "transforms.outbox.table.field.event.payload": payloadField!,
      "transforms.outbox.table.field.event.type": eventTypeField!,
      "transforms.outbox.topic.property.name": topicField!,
      "transforms.outbox.route.by.field": topicField!,
      "transforms.outbox.route.topic.replacement": "${routedByValue}"
    };
    
    // Add database-specific config
    if (databaseType === 'postgres') {
      config["plugin.name"] = "pgoutput";
      config["publication.name"] = "dbz_publication";
      config["slot.name"] = "dbz_slot";
    } else if (databaseType === 'mysql') {
      config["database.server.id"] = "1";
      config["database.server.name"] = "mysql-outbox-server";
      config["database.history.kafka.bootstrap.servers"] = this.config.kafkaBootstrapServers!;
      config["database.history.kafka.topic"] = "schema-changes.outbox";
    } else if (databaseType === 'mongodb') {
      config["mongodb.connection.string"] = `mongodb://${username}:${password}@${host}:${port}/${database}`;
      config["collection.include.list"] = outboxTable!;
    }
    
    // Add schema registry config if provided
    if (this.config.schemaRegistryUrl) {
      config["key.converter"] = "io.confluent.connect.avro.AvroConverter";
      config["value.converter"] = "io.confluent.connect.avro.AvroConverter";
      config["key.converter.schema.registry.url"] = this.config.schemaRegistryUrl;
      config["value.converter.schema.registry.url"] = this.config.schemaRegistryUrl;
    } else {
      config["key.converter"] = "org.apache.kafka.connect.json.JsonConverter";
      config["value.converter"] = "org.apache.kafka.connect.json.JsonConverter";
      config["key.converter.schemas.enable"] = "false";
      config["value.converter.schemas.enable"] = "false";
    }
    
    // Add additional config if provided
    if (this.config.additionalConfig) {
      Object.entries(this.config.additionalConfig).forEach(([key, value]) => {
        config[key] = value;
      });
    }
    
    return config;
  }
  
  /**
   * Gets the appropriate connector class based on the database type.
   * 
   * @param databaseType The database type
   * @returns The connector class name
   */
  private getConnectorClass(databaseType: string): string {
    switch (databaseType) {
      case 'postgres':
        return 'io.debezium.connector.postgresql.PostgresConnector';
      case 'mysql':
        return 'io.debezium.connector.mysql.MySqlConnector';
      case 'mongodb':
        return 'io.debezium.connector.mongodb.MongoDbConnector';
      default:
        throw new Error(`Unsupported database type: ${databaseType}`);
    }
  }
  
  /**
   * Registers the Debezium connector with Kafka Connect.
   * 
   * @returns Promise that resolves when the connector is registered
   */
  async register(): Promise<void> {
    if (this.isRegistered) {
      this.logger.warn(`Connector ${this.config.connectorName} is already registered`);
      return;
    }
    
    try {
      this.logger.info(`Registering Debezium connector: ${this.config.connectorName}`);
      
      const connectorConfig = this.buildConnectorConfig();
      this.logger.debug('Connector configuration', connectorConfig);
      
      const response = await fetch(`${this.connectUrl}/connectors`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: this.config.connectorName,
          config: connectorConfig
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to register connector: ${response.status} ${response.statusText} - ${errorText}`);
      }
      
      const data = await response.json() as ConnectorResponse;
      this.logger.info(`Successfully registered connector: ${data.name}`);
      this.isRegistered = true;
    } catch (error) {
      this.logger.error('Error registering Debezium connector:', error);
      throw error;
    }
  }
  
  /**
   * Unregisters the Debezium connector from Kafka Connect.
   * 
   * @returns Promise that resolves when the connector is unregistered
   */
  async unregister(): Promise<void> {
    if (!this.isRegistered) {
      this.logger.warn(`Connector ${this.config.connectorName} is not registered`);
      return;
    }
    
    try {
      this.logger.info(`Unregistering Debezium connector: ${this.config.connectorName}`);
      
      const response = await fetch(`${this.connectUrl}/connectors/${this.config.connectorName}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to unregister connector: ${response.status} ${response.statusText} - ${errorText}`);
      }
      
      this.logger.info(`Successfully unregistered connector: ${this.config.connectorName}`);
      this.isRegistered = false;
    } catch (error) {
      this.logger.error('Error unregistering Debezium connector:', error);
      throw error;
    }
  }
  
  /**
   * Gets the status of the Debezium connector.
   * 
   * @returns Promise that resolves with the connector status
   */
  async getStatus(): Promise<Record<string, any>> {
    try {
      const response = await fetch(`${this.connectUrl}/connectors/${this.config.connectorName}/status`);
      
      if (!response.ok) {
        if (response.status === 404) {
          this.isRegistered = false;
          return { name: this.config.connectorName, state: 'NOT_FOUND' };
        }
        
        const errorText = await response.text();
        throw new Error(`Failed to get connector status: ${response.status} ${response.statusText} - ${errorText}`);
      }
      
      const data = await response.json();
      this.isRegistered = data.connector?.state === 'RUNNING';
      return data;
    } catch (error) {
      this.logger.error('Error getting Debezium connector status:', error);
      throw error;
    }
  }
  
  /**
   * Pauses the Debezium connector.
   * 
   * @returns Promise that resolves when the connector is paused
   */
  async pause(): Promise<void> {
    if (!this.isRegistered) {
      throw new Error(`Connector ${this.config.connectorName} is not registered`);
    }
    
    try {
      this.logger.info(`Pausing Debezium connector: ${this.config.connectorName}`);
      
      const response = await fetch(`${this.connectUrl}/connectors/${this.config.connectorName}/pause`, {
        method: 'PUT'
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to pause connector: ${response.status} ${response.statusText} - ${errorText}`);
      }
      
      this.logger.info(`Successfully paused connector: ${this.config.connectorName}`);
    } catch (error) {
      this.logger.error('Error pausing Debezium connector:', error);
      throw error;
    }
  }
  
  /**
   * Resumes the Debezium connector.
   * 
   * @returns Promise that resolves when the connector is resumed
   */
  async resume(): Promise<void> {
    if (!this.isRegistered) {
      throw new Error(`Connector ${this.config.connectorName} is not registered`);
    }
    
    try {
      this.logger.info(`Resuming Debezium connector: ${this.config.connectorName}`);
      
      const response = await fetch(`${this.connectUrl}/connectors/${this.config.connectorName}/resume`, {
        method: 'PUT'
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to resume connector: ${response.status} ${response.statusText} - ${errorText}`);
      }
      
      this.logger.info(`Successfully resumed connector: ${this.config.connectorName}`);
    } catch (error) {
      this.logger.error('Error resuming Debezium connector:', error);
      throw error;
    }
  }
  
  /**
   * Restarts the Debezium connector.
   * 
   * @returns Promise that resolves when the connector is restarted
   */
  async restart(): Promise<void> {
    if (!this.isRegistered) {
      throw new Error(`Connector ${this.config.connectorName} is not registered`);
    }
    
    try {
      this.logger.info(`Restarting Debezium connector: ${this.config.connectorName}`);
      
      const response = await fetch(`${this.connectUrl}/connectors/${this.config.connectorName}/restart`, {
        method: 'POST'
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to restart connector: ${response.status} ${response.statusText} - ${errorText}`);
      }
      
      this.logger.info(`Successfully restarted connector: ${this.config.connectorName}`);
    } catch (error) {
      this.logger.error('Error restarting Debezium connector:', error);
      throw error;
    }
  }
}
