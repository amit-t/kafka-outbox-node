import { Connection, Pool, PoolConfig, PoolConnection, createPool } from 'mysql2/promise';
import { OutboxEvent, OutboxStorage } from '../index';

export interface MySQLOutboxStorageConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  tableName?: string;
}

export class MySQLOutboxStorage implements OutboxStorage {
  private pool: Pool;
  private tableName: string;

  constructor(config: MySQLOutboxStorageConfig) {
    const poolConfig: PoolConfig = {
      uri: config.connectionString,
      host: config.host || 'localhost',
      port: config.port || 3306,
      database: config.database || 'outbox',
      user: config.user || 'root',
      password: config.password || '',
    };

    this.pool = createPool(poolConfig);
    this.tableName = config.tableName || 'outbox_events';
  }

  /**
   * Initialize the database with required tables if they don't exist
   */
  async initialize(): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await this.executeInTransaction(conn, async () => {
        const query = `
          CREATE TABLE IF NOT EXISTS ${this.tableName} (
            id VARCHAR(36) PRIMARY KEY,
            payload JSON NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            published BOOLEAN NOT NULL DEFAULT FALSE,
            topic VARCHAR(255) NOT NULL,
            published_at TIMESTAMP NULL
          )
        `;
        await conn.query(query);

        // Create indexes
        await conn.query(`
          CREATE INDEX IF NOT EXISTS idx_outbox_events_published 
          ON ${this.tableName} (published)
        `);
        
        await conn.query(`
          CREATE INDEX IF NOT EXISTS idx_outbox_events_created_at 
          ON ${this.tableName} (created_at)
        `);
      });
    } finally {
      conn.release();
    }
  }

  async saveEvent(event: OutboxEvent): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await this.executeInTransaction(conn, async () => {
        const query = `
          INSERT INTO ${this.tableName} 
          (id, payload, created_at, published, topic) 
          VALUES (?, ?, ?, ?, ?)
        `;
        await conn.query(query, [
          event.id, 
          JSON.stringify(event.payload), 
          event.createdAt, 
          event.published ? 1 : 0,
          event.topic || 'default',
        ]);
      });
    } finally {
      conn.release();
    }
  }

  async markPublished(id: string): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await this.executeInTransaction(conn, async () => {
        const query = `
          UPDATE ${this.tableName} 
          SET published = TRUE, published_at = CURRENT_TIMESTAMP 
          WHERE id = ?
        `;
        await conn.query(query, [id]);
      });
    } finally {
      conn.release();
    }
  }

  async getUnpublishedEvents(): Promise<OutboxEvent[]> {
    const conn = await this.pool.getConnection();
    try {
      const [rows] = await conn.query(`
        SELECT id, payload, created_at, published, topic 
        FROM ${this.tableName} 
        WHERE published = FALSE 
        ORDER BY created_at ASC
        LIMIT 100
      `);
      
      return (rows as any[]).map(row => ({
        id: row.id,
        payload: JSON.parse(row.payload),
        createdAt: new Date(row.created_at),
        published: Boolean(row.published),
        topic: row.topic,
      }));
    } finally {
      conn.release();
    }
  }

  private async executeInTransaction(conn: PoolConnection, fn: () => Promise<void>): Promise<void> {
    try {
      await conn.beginTransaction();
      await fn();
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
