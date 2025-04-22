# kafka-outbox-node

A Node.js library implementing the Kafka Outbox pattern for reliable event publishing in distributed systems.

## Features
- Outbox pattern implementation for Kafka
- TypeScript support
- Pluggable storage (DB, file, etc.)
- Designed for microservices

## Installation

```sh
pnpm add kafka-outbox-node
```

## Usage

```ts
import { KafkaOutbox } from 'kafka-outbox-node';

const outbox = new KafkaOutbox({ /* config */ });
// Use outbox to publish events
```

## Development

- Build: `pnpm build`
- Test: `pnpm test`
- Lint: `pnpm lint`
- Format: `pnpm format`

## License
MIT
