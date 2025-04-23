import { Logger, LoggerOptions, createDefaultLogger, nullLogger } from './logger';

// Re-export logger types and utilities for library users
export { Logger, LoggerOptions, createDefaultLogger, nullLogger } from './logger';

// Export Debezium CDC connector
export { DebeziumConnector, DebeziumConfig, OutboxRouterOptions, EventTransformer } from './debezium';

/**
 * Configuration options for the KafkaOutbox class.
 *
 * @interface KafkaOutboxConfig
 * @property {string[]} kafkaBrokers - Array of Kafka broker addresses (e.g., ['localhost:9092'])
 * @property {string} [defaultTopic='outbox-events'] - Default topic if not specified when adding events
 * @property {string} [clientId='kafka-outbox-node'] - Client ID for Kafka connection
 * @property {OutboxStorage} storage - Storage adapter implementation for persisting events
 * @property {number} [pollInterval=5000] - Interval in milliseconds for polling unpublished events
 * @property {Object} [kafkaOptions] - Additional KafkaJS configuration options
 * @property {Logger|LoggerOptions|false} [logger] - Logging configuration
 */
export interface KafkaOutboxConfig {
  kafkaBrokers: string[];
  defaultTopic?: string;
  clientId?: string;
  storage: OutboxStorage;
  pollInterval?: number; // in ms
  kafkaOptions?: {
    ssl?: boolean;
    sasl?: {
      mechanism: 'plain' | 'scram-sha-256' | 'scram-sha-512';
      username: string;
      password: string;
    };
    connectionTimeout?: number;
    authenticationTimeout?: number;
    reauthenticationThreshold?: number;
  };
  /**
   * Logging configuration options
   * - Set to `false` to disable logging
   * - Set to a Logger instance to use a custom logger
   * - Set to a LoggerOptions object to customize the default Pino logger
   * - Leave undefined to use the default Pino logger with info level
   */
  logger?: Logger | LoggerOptions | false;
}

/**
 * Represents an event stored in the outbox.
 *
 * @interface OutboxEvent
 * @property {string} id - Unique identifier for the event
 * @property {any} payload - The event payload to be sent to Kafka
 * @property {Date} createdAt - Timestamp when the event was created
 * @property {boolean} published - Whether the event has been successfully published to Kafka
 * @property {string} [topic] - Optional override for the Kafka topic
 */
export interface OutboxEvent {
  id: string;
  payload: any;
  createdAt: Date;
  published: boolean;
  topic?: string; // Optional topic override
}

/**
 * Interface for storage adapters that persist outbox events.
 * Implementations are available for various databases (PostgreSQL, MySQL, MongoDB, Redis, DynamoDB).
 *
 * @interface OutboxStorage
 */
export interface OutboxStorage {
  /**
   * Saves a new event to the outbox storage.
   * 
   * @param {OutboxEvent} event - The event to save
   * @returns {Promise<void>} Promise that resolves when the event is saved
   */
  saveEvent(event: OutboxEvent): Promise<void>;
  /**
   * Marks an event as published after successful delivery to Kafka.
   * 
   * @param {string} id - The ID of the event to mark as published
   * @returns {Promise<void>} Promise that resolves when the event is marked as published
   */
  markPublished(id: string): Promise<void>;
  /**
   * Retrieves all unpublished events from the storage.
   * 
   * @returns {Promise<OutboxEvent[]>} Promise that resolves with an array of unpublished events
   */
  getUnpublishedEvents(): Promise<OutboxEvent[]>;
  /**
   * Closes the connection to the storage (optional).
   * 
   * @returns {Promise<void>} Promise that resolves when the connection is closed
   */
  close?(): Promise<void>;
}

import { Kafka, Producer } from 'kafkajs';

/**
 * Main class implementing the Kafka Outbox pattern.
 * 
 * The Kafka Outbox pattern ensures reliable event delivery to Kafka by first storing
 * events in a database (outbox) and then asynchronously publishing them to Kafka.
 * This provides at-least-once delivery guarantees and transactional consistency
 * between database operations and event publishing.
 *
 * @example
 * ```typescript
 * // Create a storage adapter
 * const storage = new PostgresOutboxStorage({
 *   host: 'localhost',
 *   port: 5432,
 *   database: 'mydb',
 *   user: 'postgres',
 *   password: 'password'
 * });
 *
 * // Create and configure the outbox
 * const outbox = new KafkaOutbox({
 *   kafkaBrokers: ['localhost:9092'],
 *   defaultTopic: 'my-events',
 *   storage,
 *   logger: { level: 'debug' }
 * });
 *
 * // Connect, add an event, and start polling
 * await outbox.connect();
 * await outbox.addEvent({ orderId: '123', status: 'created' });
 * outbox.startPolling();
 * ```
 */
export class KafkaOutbox {
  private config: KafkaOutboxConfig;
  private kafka: Kafka;
  private producer: Producer;
  private isPolling: boolean = false;
  private pollTimeoutId?: NodeJS.Timeout;
  private logger: Logger;

  /**
   * Creates a new KafkaOutbox instance.
   * 
   * @param {KafkaOutboxConfig} config - Configuration for the KafkaOutbox
   */
  constructor(config: KafkaOutboxConfig) {
    this.config = {
      defaultTopic: 'outbox-events',
      clientId: 'kafka-outbox-node',
      pollInterval: 5000, // Default 5 seconds
      ...config
    };

    // Initialize logger
    if (this.config.logger === false) {
      // Logging disabled
      this.logger = nullLogger;
    } else if (typeof this.config.logger === 'object' && 'info' in this.config.logger) {
      // Custom logger provided
      this.logger = this.config.logger as Logger;
    } else {
      // Create default logger with optional config
      const loggerOptions = typeof this.config.logger === 'object' ? 
        this.config.logger as LoggerOptions : {};
      this.logger = createDefaultLogger(loggerOptions);
    }

    this.logger.debug('Initializing KafkaOutbox');

    const kafkaConfig: any = {
      clientId: this.config.clientId,
      brokers: this.config.kafkaBrokers,
    };

    // Add Kafka options if provided
    if (this.config.kafkaOptions) {
      Object.assign(kafkaConfig, this.config.kafkaOptions);
    }

    this.kafka = new Kafka(kafkaConfig);
    this.producer = this.kafka.producer();
    
    this.logger.debug('KafkaOutbox initialized', { 
      clientId: this.config.clientId,
      brokers: this.config.kafkaBrokers,
      defaultTopic: this.config.defaultTopic
    });
  }

  /**
   * Connects to Kafka and initializes the producer.
   * Must be called before attempting to publish events.
   * 
   * @example
   * ```typescript
   * await outbox.connect();
   * ```
   * 
   * @returns {Promise<void>} Promise that resolves when connected successfully
   * @throws {Error} If connection to Kafka fails
   */
  async connect(): Promise<void> {
    this.logger.debug('Connecting to Kafka...');
    try {
      await this.producer.connect();
      this.logger.info('Successfully connected to Kafka');
    } catch (error) {
      this.logger.error('Failed to connect to Kafka', error);
      throw error;
    }
  }

  /**
   * Disconnects from Kafka and stops polling.
   * Should be called when shutting down the application to clean up resources.
   * 
   * This method will:
   * 1. Stop the polling mechanism if active
   * 2. Disconnect the Kafka producer
   * 3. Close the storage connection if supported
   * 
   * @example
   * ```typescript
   * // Graceful shutdown
   * process.on('SIGTERM', async () => {
   *   await outbox.disconnect();
   *   process.exit(0);
   * });
   * ```
   * 
   * @returns {Promise<void>} Promise that resolves when disconnected successfully
   * @throws {Error} If disconnection fails
   */
  async disconnect(): Promise<void> {
    this.logger.debug('Disconnecting from Kafka...');
    this.stopPolling();
    
    try {
      await this.producer.disconnect();
      this.logger.debug('Kafka producer disconnected');
      
      if (this.config.storage.close) {
        await this.config.storage.close();
        this.logger.debug('Storage connection closed');
      }
      
      this.logger.info('Successfully disconnected from Kafka');
    } catch (error) {
      this.logger.error('Error disconnecting from Kafka', error);
      throw error;
    }
  }

  /**
   * Adds an event to the outbox storage.
   * 
   * The event is stored in the configured storage but not immediately published to Kafka.
   * It will be published either by explicitly calling `publishEvents()` or automatically
   * if polling is enabled with `startPolling()`.
   * 
   * @example
   * ```typescript
   * // Add event with default topic
   * const eventId = await outbox.addEvent({ orderId: '123', status: 'created' });
   * 
   * // Add event with specific topic
   * await outbox.addEvent(
   *   { customerId: '456', action: 'registered' },
   *   'user-events'
   * );
   * ```
   * 
   * @param {any} payload - The event payload to be sent to Kafka
   * @param {string} [topic] - Optional topic override (uses defaultTopic from config if not specified)
   * @returns {Promise<string>} Promise that resolves with the ID of the created event
   * @throws {Error} If saving the event fails
   */
  async addEvent(payload: any, topic?: string): Promise<string> {
    const eventTopic = topic || this.config.defaultTopic;
    this.logger.debug('Adding event to outbox', { topic: eventTopic });
    
    const event: OutboxEvent = {
      id: crypto.randomUUID(),
      payload,
      createdAt: new Date(),
      published: false,
      topic: eventTopic
    };
    
    try {
      await this.config.storage.saveEvent(event);
      this.logger.info('Event added to outbox', { 
        eventId: event.id, 
        topic: eventTopic
      });
      return event.id;
    } catch (error) {
      this.logger.error('Failed to add event to outbox', error);
      throw error;
    }
  }

  /**
   * Publishes all unpublished events to Kafka.
   * 
   * This method:
   * 1. Retrieves all unpublished events from storage
   * 2. Groups them by topic for efficient batching
   * 3. Sends each batch to the appropriate Kafka topic
   * 4. Marks successfully published events as published
   * 
   * Events are only marked as published after successful delivery to Kafka,
   * ensuring at-least-once delivery semantics.
   * 
   * @example
   * ```typescript
   * // Manually publish events
   * const publishedCount = await outbox.publishEvents();
   * console.log(`Published ${publishedCount} events`);
   * ```
   * 
   * @returns {Promise<number>} Promise that resolves with the number of events published
   * @throws {Error} If retrieving or publishing events fails
   */
  async publishEvents(): Promise<number> {
    this.logger.debug('Fetching unpublished events...');
    
    try {
      const events = await this.config.storage.getUnpublishedEvents();
      
      if (events.length === 0) {
        this.logger.debug('No unpublished events found');
        return 0;
      }
      
      this.logger.info(`Found ${events.length} unpublished events to publish`);

      // Group events by topic for efficient batching
      const eventsByTopic = events.reduce((acc, event) => {
        const topic = event.topic || this.config.defaultTopic || 'default';
        if (!acc[topic]) {
          acc[topic] = [];
        }
        acc[topic].push(event);
        return acc;
      }, {} as Record<string, OutboxEvent[]>);

      // Send events to Kafka by topic
      for (const [topic, topicEvents] of Object.entries(eventsByTopic)) {
        this.logger.debug(`Publishing ${topicEvents.length} events to topic ${topic}`);
        
        const messages = topicEvents.map(event => ({
          key: event.id,
          value: JSON.stringify(event.payload),
          headers: {
            'event-id': event.id,
            'created-at': event.createdAt.toISOString()
          }
        }));

        try {
          await this.producer.send({
            topic,
            messages
          });
          
          this.logger.info(`Successfully published ${messages.length} events to topic ${topic}`);

          // Mark events as published
          for (const event of topicEvents) {
            try {
              await this.config.storage.markPublished(event.id);
            } catch (markError) {
              this.logger.error(`Failed to mark event ${event.id} as published`, markError);
              // Continue with other events even if this one fails
            }
          }
        } catch (sendError) {
          this.logger.error(`Failed to publish events to topic ${topic}`, sendError);
          throw sendError;
        }
      }

      return events.length;
    } catch (error) {
      this.logger.error('Error publishing events', error);
      throw error;
    }
  }

  /**
   * Starts polling for unpublished events.
   * 
   * This method initiates a background process that periodically checks for
   * unpublished events and publishes them to Kafka. The polling interval
   * is determined by the `pollInterval` configuration option.
   * 
   * Polling continues until explicitly stopped with `stopPolling()` or
   * when the application is shut down.
   * 
   * @example
   * ```typescript
   * // Start automatic polling (runs in background)
   * outbox.startPolling();
   * ```
   * 
   * @returns {void}
   */
  startPolling(): void {
    if (this.isPolling) {
      this.logger.debug('Polling already started, ignoring request');
      return;
    }
    
    this.logger.info(`Starting polling with interval ${this.config.pollInterval}ms`);
    this.isPolling = true;
    
    /**
     * Internal polling function that is called recursively.
     * Publishes any unpublished events and schedules the next poll.
     */
    const poll = async () => {
      if (!this.isPolling) return;
      
      this.logger.debug('Polling for unpublished events...');
      try {
        const count = await this.publishEvents();
        if (count > 0) {
          this.logger.info(`Published ${count} events during polling`);  
        }
      } catch (error) {
        this.logger.error('Error publishing events during polling:', error);
      }
      
      if (this.isPolling) {
        this.logger.debug(`Scheduling next poll in ${this.config.pollInterval}ms`);
        this.pollTimeoutId = setTimeout(poll, this.config.pollInterval);
      }
    };
    
    poll();
  }

  /**
   * Stops polling for unpublished events.
   * 
   * This method cancels the background polling process started by `startPolling()`.
   * Any in-progress publishing operation will complete, but no new polling
   * cycles will be scheduled.
   * 
   * @example
   * ```typescript
   * // Stop automatic polling
   * outbox.stopPolling();
   * ```
   * 
   * @returns {void}
   */
  stopPolling(): void {
    if (!this.isPolling) {
      this.logger.debug('Polling not active, nothing to stop');
      return;
    }
    
    this.logger.info('Stopping polling for unpublished events');
    this.isPolling = false;
    
    if (this.pollTimeoutId) {
      clearTimeout(this.pollTimeoutId);
      this.pollTimeoutId = undefined;
      this.logger.debug('Polling stopped successfully');
    }
  }
}
