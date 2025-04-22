// MongoDB initialization script for Kafka Outbox Pattern

// Connect to MongoDB
// This can be run with: mongo mongodb://localhost:27017/outbox init.js

// Create outbox database if it doesn't exist
db = db.getSiblingDB('outbox');

// Create outbox_events collection if it doesn't exist
if (!db.getCollectionNames().includes('outbox_events')) {
  db.createCollection('outbox_events');
}

// Create indexes for efficient querying
db.outbox_events.createIndex({ "published": 1 });
db.outbox_events.createIndex({ "createdAt": 1 });
db.outbox_events.createIndex({ "published": 1, "createdAt": 1 });

// Create orders collection for transaction examples
if (!db.getCollectionNames().includes('orders')) {
  db.createCollection('orders');
}

// Create indexes for orders collection
db.orders.createIndex({ "customerId": 1 });
db.orders.createIndex({ "createdAt": 1 });

print("MongoDB initialization complete: created outbox_events collection with indexes");
