import { Logger, LoggerOptions, createDefaultLogger, nullLogger } from './logger';

// Re-export logger types and utilities for library users
export { Logger, LoggerOptions, createDefaultLogger, nullLogger } from './logger';

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

export interface OutboxEvent {
  id: string;
  payload: any;
  createdAt: Date;
  published: boolean;
  topic?: string; // Optional topic override
}

export interface OutboxStorage {
  saveEvent(event: OutboxEvent): Promise<void>;
  markPublished(id: string): Promise<void>;
  getUnpublishedEvents(): Promise<OutboxEvent[]>;
  close?(): Promise<void>;
}

import { Kafka, Producer } from 'kafkajs';

export class KafkaOutbox {
  private config: KafkaOutboxConfig;
  private kafka: Kafka;
  private producer: Producer;
  private isPolling: boolean = false;
  private pollTimeoutId?: NodeJS.Timeout;
  private logger: Logger;

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
   * Connects to Kafka and initializes the producer
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
   * Disconnects from Kafka and stops polling
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
   * Adds an event to the outbox
   * @param payload The event payload
   * @param topic Optional topic override
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
   * Publishes all unpublished events to Kafka
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
   * Starts polling for unpublished events
   */
  startPolling(): void {
    if (this.isPolling) {
      this.logger.debug('Polling already started, ignoring request');
      return;
    }
    
    this.logger.info(`Starting polling with interval ${this.config.pollInterval}ms`);
    this.isPolling = true;
    
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
   * Stops polling for unpublished events
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
