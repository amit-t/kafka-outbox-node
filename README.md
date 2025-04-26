# Kafka Outbox Node

A Node.js library implementing the Kafka Outbox pattern for reliable event publishing in distributed systems. This pattern ensures messages are consistently delivered to Kafka, even when the transaction and message publishing need to happen atomically.

[![npm version](https://img.shields.io/npm/v/kafka-outbox-node.svg?style=flat-square)](https://www.npmjs.com/package/kafka-outbox-node)
[![npm downloads](https://img.shields.io/npm/dm/kafka-outbox-node.svg?style=flat-square)](https://www.npmjs.com/package/kafka-outbox-node)
[![License](https://img.shields.io/npm/l/kafka-outbox-node.svg?style=flat-square)](https://github.com/amit-t/kafka-outbox-node/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue?style=flat-square)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-14.x_|_16.x_|_18.x_|_20.x-green?style=flat-square)](https://nodejs.org/)

## Features

- **At-least-once delivery**: Ensures that published events are always delivered to Kafka, even if the application crashes.
- **Multiple storage adapters**: Support for PostgreSQL, MySQL, MongoDB, Redis, DynamoDB, and in-memory storage.
- **Configurable polling**: Automatic background polling to publish events.
- **Debezium CDC integration**: Use Debezium for Change Data Capture to stream outbox events directly to Kafka.
- **TypeScript support**: First-class TypeScript support with type definitions.
- **Secure**: Supports authentication and SSL for Kafka connection.
- **Batching**: Efficiently publishes events in batches by topic.
- **Topic routing**: Route events to different topics.
- **Customizable logging**: Use the built-in Pino logger or integrate with your existing logging infrastructure.

## Installation

```sh
# Latest version
pnpm add kafka-outbox-node

# Or specify version
pnpm add kafka-outbox-node@0.1.1
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
// The outbox uses the configured logger
// No need for console.log statements

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

// 5. Access the logger from the outbox instance
const { logger } = outbox;
logger.info('Outbox initialized successfully');
logger.debug({ event: myEvent }, 'Adding event to outbox');
```

## Debezium CDC Integration

For high-throughput applications, you can use Debezium's Change Data Capture (CDC) to stream outbox events directly to Kafka without polling:

```ts
// Configure PostgreSQL for Debezium CDC
import { setupPostgresForDebezium } from 'kafka-outbox-node/dist/scripts/init/debezium/setup-postgres';

await setupPostgresForDebezium({
  host: 'localhost',
  port: 5432,
  database: 'mydb',
  user: 'postgres',
  password: 'password',
  tableName: 'outbox_events' // The table containing outbox events
});

// Create and register a Debezium connector
import { DebeziumConnector } from 'kafka-outbox-node';

const connector = new DebeziumConnector({
  databaseType: 'postgres',
  host: 'localhost',
  port: 5432,
  database: 'mydb',
  username: 'postgres',
  password: 'password',
  outboxTable: 'outbox_events',
  connectorName: 'my-outbox-connector',
  kafkaBootstrapServers: 'localhost:9092',
  topicPrefix: 'app.',
  // You can use the same logger instance across your application
  logger: myLogger // Must implement trace, debug, info, warn, error methods
}, {
  eventTypeField: 'event_type',
  payloadField: 'payload',
  topicField: 'topic',
  eventIdField: 'id'
});

// Register with Kafka Connect
await connector.register();

// With Debezium configured, you can use the standard KafkaOutbox for adding events,
// but don't need to call startPolling() or publishEvents() as Debezium handles that
const outbox = new KafkaOutbox({
  kafkaBrokers: ['localhost:9092'],
  storage: new PostgresOutboxStorage({
    host: 'localhost',
    port: 5432,
    database: 'mydb',
    user: 'postgres',
    password: 'password',
  })
});

// Add an event (but don't need to publish it explicitly)
await outbox.addEvent({ orderId: '123', status: 'created' });
```

### Requirements for Debezium CDC

1. **Kafka Connect**: You need a running Kafka Connect cluster with Debezium connectors installed
2. **Database Configuration**: The database must be configured for CDC (e.g., PostgreSQL needs logical replication enabled)
3. **Outbox Table Structure**: The outbox table should include fields for event type, payload, and optionally topic

### Running with Docker

The library includes a Docker Compose configuration with Debezium and all required components:

```bash
# Start the Docker environment (Kafka, PostgreSQL, Kafka Connect with Debezium, etc.)
pnpm docker:up

# The environment includes:
# - PostgreSQL (configured for CDC): localhost:5432
# - Kafka: localhost:29092
# - Kafka Connect: localhost:8083
# - Debezium UI: http://localhost:8084
# - Kafka UI: http://localhost:8080

# Register a Debezium connector for the outbox pattern
pnpm tsx scripts/register-debezium-connector.ts

# Now you can run the example
pnpm tsx examples/debezium-cdc-example.ts

# When finished
pnpm docker:down
```

The Docker setup handles all the configuration needed for Debezium, including:

- Setting up PostgreSQL with logical replication enabled
- Creating the necessary tables with the correct replica identity
- Providing a pre-configured Kafka Connect instance with Debezium connectors
- Setting up the publications and replication slots

## Advanced Usage

### Custom Error Handling

```ts
outbox.startPolling();

// The outbox instance has a logger property you can use
const { logger } = outbox;

process.on('uncaughtException', async (error) => {
  logger.error({ err: error }, 'Uncaught exception');
  await outbox.disconnect();
  process.exit(1);
});

process.on('SIGINT', async () => {
  logger.info('Shutting down...');
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
