import { createDefaultLogger, Logger, LoggerOptions } from '../src/logger';
import chalk from 'chalk';

/**
 * Creates a script logger for initialization scripts
 * @param options Logger options (optional)
 * @returns Logger instance
 */
export function createScriptLogger(options?: LoggerOptions): Logger {
  const defaultOptions: LoggerOptions = {
    level: 'info',
    name: 'kafka-outbox-init',
    ...options
  };

  // Create a Pino logger with good defaults for CLI scripts
  return createDefaultLogger(defaultOptions);
  
  // Note: For CLI scripts, you may want to consider installing pino-pretty
  // and using it as a transport in your application
}

// Default script logger instance
export const scriptLogger = createScriptLogger();

// Color-enhanced logging functions for the CLI
export const logSuccess = (message: string): void => {
  scriptLogger.info(chalk.green(message));
};

export const logInfo = (message: string): void => {
  scriptLogger.info(chalk.blue(message));
};

export const logWarning = (message: string): void => {
  scriptLogger.warn(chalk.yellow(message));
};

export const logError = (message: string, error?: any): void => {
  if (error) {
    scriptLogger.error(`${chalk.red(message)} ${error}`);
  } else {
    scriptLogger.error(chalk.red(message));
  }
};
