import pino, { Logger as PinoLogger } from 'pino';

/**
 * Logger interface that matches common logging methods
 * This allows users to provide their own logger implementation
 */
export interface Logger {
  trace(msg: string, ...args: any[]): void;
  debug(msg: string, ...args: any[]): void;
  info(msg: string, ...args: any[]): void;
  warn(msg: string, ...args: any[]): void;
  error(msg: string, ...args: any[]): void;
  fatal?(msg: string, ...args: any[]): void;
}

/**
 * Default logger options
 */
export interface LoggerOptions {
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';
  name?: string;
  prettyPrint?: boolean;
}

/**
 * Creates the default Pino logger with provided options
 */
export function createDefaultLogger(options: LoggerOptions = {}): Logger {
  const defaultOptions = {
    level: options.level || 'info',
    name: options.name || 'kafka-outbox',
    transport: options.prettyPrint ? {
      target: 'pino-pretty',
      options: {
        colorize: true
      }
    } : undefined
  };

  return pino(defaultOptions);
}

/**
 * Null logger that doesn't log anything
 * Used when logging is disabled
 */
export const nullLogger: Logger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {}
};
