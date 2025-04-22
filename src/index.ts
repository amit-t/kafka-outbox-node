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

  constructor(config: KafkaOutboxConfig) {
    this.config = {
      defaultTopic: 'outbox-events',
      clientId: 'kafka-outbox-node',
      pollInterval: 5000, // Default 5 seconds
      ...config
    };

    this.kafka = new Kafka({
      clientId: this.config.clientId,
      brokers: this.config.kafkaBrokers,
    });

    this.producer = this.kafka.producer();
  }

  /**
   * Connects to Kafka and initializes the producer
   */
  async connect(): Promise<void> {
    await this.producer.connect();
  }

  /**
   * Disconnects from Kafka and stops polling
   */
  async disconnect(): Promise<void> {
    this.stopPolling();
    await this.producer.disconnect();
    if (this.config.storage.close) {
      await this.config.storage.close();
    }
  }

  /**
   * Adds an event to the outbox
   * @param payload The event payload
   * @param topic Optional topic override
   */
  async addEvent(payload: any, topic?: string): Promise<string> {
    const event: OutboxEvent = {
      id: crypto.randomUUID(),
      payload,
      createdAt: new Date(),
      published: false,
      topic: topic || this.config.defaultTopic
    };
    await this.config.storage.saveEvent(event);
    return event.id;
  }

  /**
   * Publishes all unpublished events to Kafka
   */
  async publishEvents(): Promise<number> {
    const events = await this.config.storage.getUnpublishedEvents();
    if (events.length === 0) {
      return 0;
    }

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
      const messages = topicEvents.map(event => ({
        key: event.id,
        value: JSON.stringify(event.payload),
        headers: {
          'event-id': event.id,
          'created-at': event.createdAt.toISOString()
        }
      }));

      await this.producer.send({
        topic,
        messages
      });

      // Mark events as published
      for (const event of topicEvents) {
        await this.config.storage.markPublished(event.id);
      }
    }

    return events.length;
  }

  /**
   * Starts polling for unpublished events
   */
  startPolling(): void {
    if (this.isPolling) return;
    
    this.isPolling = true;
    const poll = async () => {
      if (!this.isPolling) return;
      
      try {
        await this.publishEvents();
      } catch (error) {
        console.error('Error publishing events:', error);
      }
      
      if (this.isPolling) {
        this.pollTimeoutId = setTimeout(poll, this.config.pollInterval);
      }
    };
    
    poll();
  }

  /**
   * Stops polling for unpublished events
   */
  stopPolling(): void {
    this.isPolling = false;
    if (this.pollTimeoutId) {
      clearTimeout(this.pollTimeoutId);
      this.pollTimeoutId = undefined;
    }
  }
}
