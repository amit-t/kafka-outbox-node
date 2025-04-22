# Kafka Outbox Pattern - Docker Development Environment

This document describes how to use the Docker environment to develop, test, and debug the `kafka-outbox-node` library locally.

## Infrastructure Components

The `docker-compose.yml` file sets up the following components:

1. **Zookeeper**: Required for Kafka
2. **Kafka**: Message broker for event publishing
3. **PostgreSQL**: Database for storing outbox events
4. **Kafka UI**: Web interface for monitoring Kafka topics and messages

## Getting Started

### Prerequisites

- Docker and Docker Compose installed
- Node.js 18+
- pnpm (preferred package manager)

### Starting the Environment

```bash
# Start all services
docker-compose up -d

# Check that all services are running
docker-compose ps
```

### Service Access Information

| Service     | Access                  | Credentials               |
|-------------|-------------------------|---------------------------|
| Kafka       | localhost:29092         | N/A                       |
| PostgreSQL  | localhost:5432          | postgres / postgres       |
| Kafka UI    | http://localhost:8080   | N/A                       |

## Running the Examples

The repository includes example scripts to demonstrate how to use the library with the Docker infrastructure:

```bash
# Build the library first
pnpm build

# Run the basic example
pnpm tsx examples/basic-usage.ts
```

## Testing with the Infrastructure

The Docker environment is configured to support all testing scenarios for the library:

1. **Unit Tests**: `pnpm test`
2. **Integration Tests**: (Coming soon)

## Debugging

### Viewing Kafka Messages

1. Open the Kafka UI at http://localhost:8080
2. Navigate to the "Topics" section
3. Select the topic you want to inspect (e.g., "outbox-events")
4. View messages and their metadata

### Database Inspection

Connect to PostgreSQL:

```bash
docker exec -it postgres psql -U postgres -d outbox
```

Useful PostgreSQL commands:

```sql
-- View outbox events
SELECT * FROM outbox_events;

-- View unpublished events
SELECT * FROM outbox_events WHERE published = false;

-- View published events
SELECT * FROM outbox_events WHERE published = true;
```

## Stopping the Environment

```bash
# Stop all services
docker-compose down

# Stop and remove volumes (will delete all data)
docker-compose down -v
```

## Troubleshooting

### Kafka Connection Issues

If your application can't connect to Kafka, ensure you're using the correct broker address:
- Inside Docker containers: `kafka:9092`
- From host machine: `localhost:29092`

### PostgreSQL Connection Issues

Verify PostgreSQL is running and accessible:
```bash
docker exec -it postgres pg_isready -U postgres
```

Expected output: `/var/run/postgresql:5432 - accepting connections`
