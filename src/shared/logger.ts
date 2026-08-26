type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LOG_LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'INFO';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatLog(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  });
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => {
    if (shouldLog('DEBUG')) console.debug(formatLog('DEBUG', message, meta));
  },
  info: (message: string, meta?: Record<string, unknown>) => {
    if (shouldLog('INFO')) console.info(formatLog('INFO', message, meta));
  },
  warn: (message: string, meta?: Record<string, unknown>) => {
    if (shouldLog('WARN')) console.warn(formatLog('WARN', message, meta));
  },
  error: (message: string, meta?: Record<string, unknown>) => {
    if (shouldLog('ERROR')) console.error(formatLog('ERROR', message, meta));
  },
};
