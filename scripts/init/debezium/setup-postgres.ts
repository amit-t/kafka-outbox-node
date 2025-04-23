/**
 * Setup script for configuring PostgreSQL for Debezium CDC (Change Data Capture).
 * This script configures PostgreSQL with the necessary settings to enable CDC with Debezium.
 */

import { Client } from 'pg';
import { logInfo, logSuccess, logError } from '../../logger';

interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  /**
   * The name of the logical replication slot to create.
   * Default: 'debezium_slot'
   */
  slotName?: string;
  /**
   * The name of the publication to create.
   * Default: 'dbz_publication'
   */
  publicationName?: string;
  /**
   * The name of the table to include in the publication.
   * Default: 'outbox_events'
   */
  tableName?: string;
}

/**
 * Sets up PostgreSQL for Debezium CDC.
 * 
 * This function:
 * 1. Ensures the wal_level is set to logical
 * 2. Creates a replication slot for Debezium
 * 3. Creates a publication for the outbox table
 * 
 * @param config PostgreSQL configuration
 */
async function setupPostgresForDebezium(config: PostgresConfig): Promise<void> {
  // Apply defaults
  const slotName = config.slotName || 'debezium_slot';
  const publicationName = config.publicationName || 'dbz_publication';
  const tableName = config.tableName || 'outbox_events';

  // Create a database client
  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password
  });

  try {
    logInfo('Connecting to PostgreSQL...');
    await client.connect();
    logSuccess('Connected to PostgreSQL');

    // Check if the current user has superuser privileges
    logInfo('Checking superuser privileges...');
    const superuserResult = await client.query(`
      SELECT usesuper FROM pg_user WHERE usename = current_user;
    `);
    
    const isSuperUser = superuserResult.rows[0]?.usesuper === true;
    if (!isSuperUser) {
      logError('The current user does not have superuser privileges. Some operations may fail.');
    }

    // Check and update wal_level if needed
    logInfo('Checking WAL level...');
    const walLevelResult = await client.query(`
      SHOW wal_level;
    `);
    
    const currentWalLevel = walLevelResult.rows[0].wal_level;
    if (currentWalLevel !== 'logical') {
      logInfo(`Current WAL level is ${currentWalLevel}, needs to be 'logical'`);
      
      if (isSuperUser) {
        // Update postgresql.conf and restart required
        logInfo('To enable logical replication, you need to:');
        logInfo('1. Update postgresql.conf:');
        logInfo('   wal_level = logical');
        logInfo('2. Restart PostgreSQL');
        logInfo('3. Run this script again');
      } else {
        logError('Cannot change wal_level: superuser privileges required');
      }
      return;
    }
    
    logSuccess('WAL level is already set to logical');

    // Create replication slot if it doesn't exist
    logInfo(`Checking for replication slot '${slotName}'...`);
    const slotResult = await client.query(`
      SELECT * FROM pg_replication_slots WHERE slot_name = $1;
    `, [slotName]);
    
    if (slotResult.rows.length === 0) {
      try {
        logInfo(`Creating replication slot '${slotName}'...`);
        await client.query(`
          SELECT pg_create_logical_replication_slot($1, 'pgoutput');
        `, [slotName]);
        logSuccess(`Created replication slot '${slotName}'`);
      } catch (error: any) {
        if (error.message.includes('already exists')) {
          logInfo(`Replication slot '${slotName}' already exists`);
        } else {
          throw error;
        }
      }
    } else {
      logInfo(`Replication slot '${slotName}' already exists`);
    }

    // Check if table exists
    logInfo(`Checking if table '${tableName}' exists...`);
    const tableResult = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = $1
      );
    `, [tableName]);
    
    if (!tableResult.rows[0].exists) {
      logError(`Table '${tableName}' does not exist. Please create it first.`);
      return;
    }
    
    logSuccess(`Table '${tableName}' exists`);

    // Create publication if it doesn't exist
    logInfo(`Checking for publication '${publicationName}'...`);
    const pubResult = await client.query(`
      SELECT * FROM pg_publication WHERE pubname = $1;
    `, [publicationName]);
    
    if (pubResult.rows.length === 0) {
      logInfo(`Creating publication '${publicationName}' for table '${tableName}'...`);
      await client.query(`
        CREATE PUBLICATION ${publicationName} FOR TABLE ${tableName};
      `);
      logSuccess(`Created publication '${publicationName}'`);
    } else {
      // Check if the table is in the publication
      const pubTablesResult = await client.query(`
        SELECT * FROM pg_publication_tables 
        WHERE pubname = $1 AND tablename = $2;
      `, [publicationName, tableName]);
      
      if (pubTablesResult.rows.length === 0) {
        logInfo(`Adding table '${tableName}' to publication '${publicationName}'...`);
        await client.query(`
          ALTER PUBLICATION ${publicationName} ADD TABLE ${tableName};
        `);
        logSuccess(`Added table '${tableName}' to publication '${publicationName}'`);
      } else {
        logInfo(`Table '${tableName}' is already in publication '${publicationName}'`);
      }
    }

    // Ensure table has primary key
    logInfo(`Checking primary key on table '${tableName}'...`);
    const pkResult = await client.query(`
      SELECT a.attname
      FROM   pg_index i
      JOIN   pg_attribute a ON a.attrelid = i.indrelid
                            AND a.attnum = ANY(i.indkey)
      WHERE  i.indrelid = $1::regclass
      AND    i.indisprimary;
    `, [`public.${tableName}`]);
    
    if (pkResult.rows.length === 0) {
      logError(`Table '${tableName}' does not have a primary key, which is required for Debezium`);
    } else {
      const pkColumns = pkResult.rows.map(r => r.attname).join(', ');
      logSuccess(`Table '${tableName}' has primary key: ${pkColumns}`);
    }

    // Ensure table has replica identity
    logInfo(`Checking replica identity on table '${tableName}'...`);
    const replicaResult = await client.query(`
      SELECT relreplident
      FROM pg_class
      WHERE oid = $1::regclass;
    `, [`public.${tableName}`]);
    
    const replicaIdentity = replicaResult.rows[0].relreplident;
    if (replicaIdentity === 'd') {
      logInfo(`Setting replica identity to FULL for table '${tableName}'...`);
      await client.query(`
        ALTER TABLE ${tableName} REPLICA IDENTITY FULL;
      `);
      logSuccess(`Set replica identity to FULL for table '${tableName}'`);
    } else if (replicaIdentity === 'f') {
      logSuccess(`Table '${tableName}' already has FULL replica identity`);
    } else {
      logWarning(`Table '${tableName}' has replica identity '${replicaIdentity}', recommended: FULL`);
    }

    logSuccess('PostgreSQL is now configured for Debezium CDC');
    
  } catch (error) {
    logError('Error setting up PostgreSQL for Debezium:', error);
    throw error;
  } finally {
    try {
      logInfo('Closing PostgreSQL connection...');
      await client.end();
      logInfo('PostgreSQL connection closed');
    } catch (endError) {
      logError('Error closing PostgreSQL connection:', endError);
    }
  }
}

// Function to log warnings (not available in the script logger)
function logWarning(message: string): void {
  console.warn(`[WARNING] ${message}`);
}

// Run the setup function
if (require.main === module) {
  const config: PostgresConfig = {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'outbox',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    slotName: process.env.SLOT_NAME,
    publicationName: process.env.PUBLICATION_NAME,
    tableName: process.env.TABLE_NAME
  };

  setupPostgresForDebezium(config).catch(error => {
    logError('Failed to setup PostgreSQL for Debezium:', error);
    process.exit(1);
  });
}

export { setupPostgresForDebezium, PostgresConfig };
