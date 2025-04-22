# Kafka Outbox Node

A Node.js library implementing the Kafka Outbox pattern for reliable event publishing in distributed systems. This pattern ensures messages are consistently delivered to Kafka, even when the transaction and message publishing need to happen atomically.

[![npm version](https://img.shields.io/npm/v/kafka-outbox-node.svg)](https://www.npmjs.com/package/kafka-outbox-node)
[![License](https://img.shields.io/npm/l/kafka-outbox-node.svg)](https://github.com/amit-t/kafka-outbox-node/blob/main/LICENSE)

## Features

- **At-least-once delivery**: Ensures that published events are always delivered to Kafka, even if the application crashes.
- **Multiple storage adapters**: Support for PostgreSQL, MySQL, MongoDB, Redis, DynamoDB, and in-memory storage.
- **Configurable polling**: Automatic background polling to publish events.
- **TypeScript support**: First-class TypeScript support with type definitions.
- **Secure**: Supports authentication and SSL for Kafka connection.
- **Batching**: Efficiently publishes events in batches by topic.
- **Topic routing**: Route events to different topics.
- **Customizable logging**: Use the built-in Pino logger or integrate with your existing logging infrastructure.

## Installation

```sh
pnpm add kafka-outbox-node
```

## Quick Start

```ts
import { KafkaOutbox, InMemoryOutboxStorage } from 'kafka-outbox-node';

// Create a storage instance (in-memory, PostgreSQL, MySQL, or DynamoDB)
const storage = new InMemoryOutboxStorage();

// Create the outbox with the storage
const outbox = new KafkaOutbox({
  kafkaBrokers: ['localhost:9092'],
  defaultTopic: 'outbox-events',
  clientId: 'my-service',
  storage,
});

// Connect to Kafka
await outbox.connect();

// Add an event to the outbox
await outbox.addEvent({ message: 'Hello, world!', timestamp: new Date().toISOString() });

// Publish events manually
const count = await outbox.publishEvents();
console.log(`Published ${count} events`);

// Or start polling to publish events automatically
outbox.startPolling();

// When shutting down the application
await outbox.disconnect();
```

### Usage Examples

```ts
// With default Pino logger
const outbox = new KafkaOutbox({
  kafkaBrokers: ['localhost:9092'],
  storage: new PostgresOutboxStorage({ /* config */ }),
});

// With custom logger
const outbox = new KafkaOutbox({
  kafkaBrokers: ['localhost:9092'],
  storage: new PostgresOutboxStorage({ /* config */ }),
  logger: myCustomLogger // Any logger with trace, debug, info, warn, error methods
});

// With detailed debug logging
const outbox = new KafkaOutbox({
  kafkaBrokers: ['localhost:9092'],
  storage: new PostgresOutboxStorage({ /* config */ }),
  logger: { level: 'debug', prettyPrint: true }
});

```

## Storage Adapters

### PostgreSQL

```ts
import { KafkaOutbox, PostgresOutboxStorage } from 'kafka-outbox-node';

const storage = new PostgresOutboxStorage({
  host: 'localhost',
  port: 5432,
  database: 'outbox',
  user: 'postgres',
  password: 'postgres',
});

const outbox = new KafkaOutbox({
  kafkaBrokers: ['localhost:9092'],
  storage,
});
```

### MySQL

```ts
import { KafkaOutbox, MySQLOutboxStorage } from 'kafka-outbox-node';

const storage = new MySQLOutboxStorage({
  host: 'localhost',
  port: 3306,
  database: 'outbox',
  user: 'root',
  password: 'password',
});

const outbox = new KafkaOutbox({
  kafkaBrokers: ['localhost:9092'],
  storage,
});
```

### MongoDB

```ts
import { KafkaOutbox, MongoDBOutboxStorage } from 'kafka-outbox-node';

const storage = new MongoDBOutboxStorage({
  connectionString: 'mongodb://localhost:27017/outbox',
});

// Initialize the collection with proper indexes if needed
await storage.initialize();

const outbox = new KafkaOutbox({
  kafkaBrokers: ['localhost:9092'],
  storage,
});
```

### Redis

```ts
import { KafkaOutbox, RedisOutboxStorage } from 'kafka-outbox-node';

const storage = new RedisOutboxStorage({
  host: 'localhost',
  port: 6379,
  keyPrefix: 'outbox:', // Optional
});

const outbox = new KafkaOutbox({
  kafkaBrokers: ['localhost:9092'],
  storage,
});
```

### DynamoDB

```ts
import { KafkaOutbox, DynamoDBOutboxStorage } from 'kafka-outbox-node';

const storage = new DynamoDBOutboxStorage({
  region: 'us-east-1',
  tableName: 'outbox-events',
  credentials: {
    accessKeyId: 'your-access-key',
    secretAccessKey: 'your-secret-key',
  },
});

// Initialize the table if it doesn't exist
await storage.initialize();

const outbox = new KafkaOutbox({
  kafkaBrokers: ['localhost:9092'],
  storage,
});
```

## API Reference

### KafkaOutbox

#### Constructor

```ts
new KafkaOutbox(config: KafkaOutboxConfig)
```

#### Configuration

```ts
interface KafkaOutboxConfig {
  kafkaBrokers: string[];             // Array of Kafka broker addresses
  defaultTopic?: string;              // Default topic if not specified when adding events
  clientId?: string;                  // Client ID for Kafka
  storage: OutboxStorage;             // Storage adapter implementation
  pollInterval?: number;              // Interval in ms for polling (default: 5000)
  kafkaOptions?: {                    // Additional Kafka options
    ssl?: boolean;                    // Enable SSL
    sasl?: {                          // Authentication options
      mechanism: 'plain' | 'scram-sha-256' | 'scram-sha-512';
      username: string;
      password: string;
    };
    connectionTimeout?: number;       // Connection timeout in ms
    authenticationTimeout?: number;   // Authentication timeout in ms
    reauthenticationThreshold?: number; // Reauthentication threshold in ms
  };
  logger?: Logger | LoggerOptions | false; // Customizable logging options
}
```

#### Methods

- `connect()`: Connect to Kafka.
- `disconnect()`: Disconnect from Kafka and stop polling.
- `addEvent(payload: any, topic?: string)`: Add an event to the outbox.
- `publishEvents()`: Publish unpublished events to Kafka.
- `startPolling()`: Start polling for unpublished events.
- `stopPolling()`: Stop polling for unpublished events.

### OutboxStorage Interface

Storage adapters implement this interface:

```ts
interface OutboxStorage {
  saveEvent(event: OutboxEvent): Promise<void>;
  markPublished(id: string): Promise<void>;
  getUnpublishedEvents(): Promise<OutboxEvent[]>;
  close?(): Promise<void>;
}
```

## Logging Configuration

The library comes with built-in logging using [Pino](https://github.com/pinojs/pino), but can be configured to work with your existing logging infrastructure:

```ts
// 1. Use the default Pino logger (info level)
const outbox = new KafkaOutbox({
  kafkaBrokers: ['localhost:9092'],
  storage,
  // No logger config = default Pino logger with info level
});

// 2. Customize the built-in Pino logger
const outbox = new KafkaOutbox({
  kafkaBrokers: ['localhost:9092'],
  storage,
  logger: {
    level: 'debug',        // One of: trace, debug, info, warn, error, fatal
    name: 'my-service',    // Logger name for identification
    prettyPrint: true      // Pretty print for development
  }
});

// 3. Use your own logger (Winston, Bunyan, etc.)
const outbox = new KafkaOutbox({
  kafkaBrokers: ['localhost:9092'],
  storage,
  logger: myCustomLogger   // Must implement trace, debug, info, warn, error methods
});

// 4. Disable logging completely
const outbox = new KafkaOutbox({
  kafkaBrokers: ['localhost:9092'],
  storage,
  logger: false
});
```

## Advanced Usage

### Custom Error Handling

```ts
outbox.startPolling();

process.on('uncaughtException', async (error) => {
  console.error('Uncaught exception:', error);
  await outbox.disconnect();
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await outbox.disconnect();
  process.exit(0);
});
```

### Custom Topic Routing

```ts
// Add an event to a specific topic
await outbox.addEvent(
  { orderId: '12345', status: 'completed' },
  'order-events'
);

// Add an event to the default topic
await outbox.addEvent({ message: 'Hello, world!' });
```

## Development

- Build: `pnpm build`
- Test: `pnpm test`
- Lint: `pnpm lint`
- Format: `pnpm format`

## Local Development with Docker

See [DOCKER.md](./DOCKER.md) for instructions on setting up a local development environment with Docker.

## License

MIT
