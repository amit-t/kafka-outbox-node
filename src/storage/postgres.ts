import { Pool, PoolClient } from 'pg';
import { OutboxEvent, OutboxStorage } from '../index';

export interface PostgresOutboxStorageConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  schema?: string;
  tableName?: string;
}

export class PostgresOutboxStorage implements OutboxStorage {
  private pool: Pool;
  private tableName: string;
  private schema: string;

  constructor(config: PostgresOutboxStorageConfig) {
    this.pool = new Pool({
      connectionString: config.connectionString,
      host: config.host || 'localhost',
      port: config.port || 5432,
      database: config.database || 'outbox',
      user: config.user || 'postgres',
      password: config.password || 'postgres',
    });
    this.schema = config.schema || 'public';
    this.tableName = config.tableName || 'outbox_events';
  }

  async saveEvent(event: OutboxEvent): Promise<void> {
    const client = await this.pool.connect();
    try {
      await this.executeInTransaction(client, async () => {
        const query = `
          INSERT INTO ${this.schema}.${this.tableName} 
          (id, payload, created_at, published, topic) 
          VALUES ($1, $2, $3, $4, $5)
        `;
        await client.query(query, [
          event.id, 
          JSON.stringify(event.payload), 
          event.createdAt, 
          event.published,
          event.topic || 'default',
        ]);
      });
    } finally {
      client.release();
    }
  }

  async markPublished(id: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await this.executeInTransaction(client, async () => {
        const query = `
          UPDATE ${this.schema}.${this.tableName} 
          SET published = true, published_at = NOW() 
          WHERE id = $1
        `;
        await client.query(query, [id]);
      });
    } finally {
      client.release();
    }
  }

  async getUnpublishedEvents(): Promise<OutboxEvent[]> {
    const client = await this.pool.connect();
    try {
      const query = `
        SELECT id, payload, created_at, published, topic 
        FROM ${this.schema}.${this.tableName} 
        WHERE published = false 
        ORDER BY created_at ASC
        LIMIT 100
      `;
      const result = await client.query(query);
      return result.rows.map((row: { 
        id: string; 
        payload: string; 
        created_at: string; 
        published: boolean; 
        topic: string; 
      }) => ({
        id: row.id,
        payload: JSON.parse(row.payload),
        createdAt: new Date(row.created_at),
        published: row.published,
        topic: row.topic,
      }));
    } finally {
      client.release();
    }
  }

  private async executeInTransaction(client: PoolClient, fn: () => Promise<void>): Promise<void> {
    try {
      await client.query('BEGIN');
      await fn();
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
