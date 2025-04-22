#!/usr/bin/env node

/**
 * Kafka Outbox - Database Initialization Script Manager
 * 
 * This script provides a unified way to initialize any supported database
 * for use with the Kafka Outbox pattern.
 */

import { program } from 'commander';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';
import { scriptLogger, logInfo, logSuccess, logError, logWarning } from './logger';

// Promisify exec
const execAsync = promisify(exec);

// Define supported database types
type DatabaseType = 'postgres' | 'mysql' | 'mongodb' | 'redis' | 'dynamodb';

// Database specific connection options
interface DatabaseConnectionOptions {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  connectionString?: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

// Helper function to run TypeScript files with tsx
async function runTypescriptFile(filePath: string): Promise<void> {
  try {
    logInfo(`Running TypeScript file: ${filePath}`);
    await execAsync(`pnpm tsx ${filePath}`);
  } catch (error) {
    logError(`Error running TypeScript file:`, error);
    throw error;
  }
}

// Helper function to run SQL files with appropriate CLI tools
async function runSqlFile(
  filePath: string, 
  dbType: 'postgres' | 'mysql', 
  options: DatabaseConnectionOptions
): Promise<void> {
  try {
    logInfo(`Running SQL file: ${filePath}`);
    
    let command = '';
    if (dbType === 'postgres') {
      const host = options.host || 'localhost';
      const port = options.port || 5432;
      const user = options.username || 'postgres';
      const password = options.password ? `-W${options.password}` : '';
      const database = options.database || 'outbox';
      
      command = `PGPASSWORD="${options.password}" psql -h ${host} -p ${port} -U ${user} -d ${database} -f ${filePath}`;
    } else if (dbType === 'mysql') {
      const host = options.host || 'localhost';
      const port = options.port || 3306;
      const user = options.username || 'root';
      const password = options.password ? `-p${options.password}` : '';
      const database = options.database || '';
      
      command = `mysql -h ${host} -P ${port} -u ${user} ${password} ${database} < ${filePath}`;
    }
    
    await execAsync(command);
  } catch (error) {
    logError(`Error running SQL file:`, error);
    throw error;
  }
}

// Main initialization function
async function initializeDatabase(
  dbType: DatabaseType, 
  options: DatabaseConnectionOptions = {}
): Promise<void> {
  const scriptDir = path.join(__dirname, 'init', dbType);
  
  try {
    // Check if script directory exists
    if (!fs.existsSync(scriptDir)) {
      throw new Error(`No initialization scripts found for database type: ${dbType}`);
    }
    
    logInfo(`Initializing ${dbType} database...`);
    
    // Run the appropriate initialization script based on database type
    switch (dbType) {
      case 'postgres':
      case 'mysql': {
        const sqlFile = path.join(scriptDir, 'init.sql');
        if (!fs.existsSync(sqlFile)) {
          throw new Error(`SQL initialization file not found: ${sqlFile}`);
        }
        await runSqlFile(sqlFile, dbType, options);
        break;
      }
        
      case 'mongodb':
      case 'redis':
      case 'dynamodb': {
        const tsFile = path.join(scriptDir, 'init.ts');
        if (!fs.existsSync(tsFile)) {
          throw new Error(`TypeScript initialization file not found: ${tsFile}`);
        }
        await runTypescriptFile(tsFile);
        break;
      }
      
      default:
        throw new Error(`Unsupported database type: ${dbType}`);
    }
    
    logSuccess(`${dbType} database initialized successfully`);
  } catch (error) {
    logError(`Failed to initialize ${dbType} database:`, error);
    process.exit(1);
  }
}

// Set up command line interface
program
  .name('init')
  .description('Initialize database for Kafka Outbox pattern')
  .version('1.0.0');

program
  .command('postgres')
  .description('Initialize PostgreSQL database')
  .option('-h, --host <host>', 'Database host', 'localhost')
  .option('-p, --port <port>', 'Database port', '5432')
  .option('-u, --username <username>', 'Database username', 'postgres')
  .option('-P, --password <password>', 'Database password', 'postgres')
  .option('-d, --database <database>', 'Database name', 'outbox')
  .action((options) => {
    initializeDatabase('postgres', options);
  });

program
  .command('mysql')
  .description('Initialize MySQL database')
  .option('-h, --host <host>', 'Database host', 'localhost')
  .option('-p, --port <port>', 'Database port', '3306')
  .option('-u, --username <username>', 'Database username', 'root')
  .option('-P, --password <password>', 'Database password', '')
  .option('-d, --database <database>', 'Database name', 'outbox')
  .action((options) => {
    initializeDatabase('mysql', options);
  });

program
  .command('mongodb')
  .description('Initialize MongoDB database')
  .option('-c, --connection-string <connectionString>', 'MongoDB connection string', 'mongodb://localhost:27017')
  .option('-d, --database <database>', 'Database name', 'outbox')
  .action((options) => {
    initializeDatabase('mongodb', options);
  });

program
  .command('redis')
  .description('Initialize Redis database')
  .option('-h, --host <host>', 'Redis host', 'localhost')
  .option('-p, --port <port>', 'Redis port', '6379')
  .option('-P, --password <password>', 'Redis password', '')
  .option('--key-prefix <keyPrefix>', 'Redis key prefix', 'outbox:')
  .action((options) => {
    initializeDatabase('redis', options);
  });

program
  .command('dynamodb')
  .description('Initialize DynamoDB database')
  .option('-r, --region <region>', 'AWS region', 'us-east-1')
  .option('-e, --endpoint <endpoint>', 'DynamoDB endpoint (for local)', 'http://localhost:8000')
  .option('-a, --access-key-id <accessKeyId>', 'AWS access key ID (for local use "local")', 'local')
  .option('-s, --secret-access-key <secretAccessKey>', 'AWS secret access key (for local use "local")', 'local')
  .action((options) => {
    initializeDatabase('dynamodb', options);
  });

program.parse();
