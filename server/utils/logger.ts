type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

function timestamp(): string {
  return new Date().toISOString();
}

function log(level: LogLevel, message: string, ...args: unknown[]): void {
  const prefix = `[${timestamp()}] [${level.padEnd(5)}]`;
  if (level === 'ERROR') console.error(prefix, message, ...args);
  else if (level === 'WARN') console.warn(prefix, message, ...args);
  else console.log(prefix, message, ...args);
}

export const logger = {
  info: (message: string, ...args: unknown[]) => log('INFO', message, ...args),
  warn: (message: string, ...args: unknown[]) => log('WARN', message, ...args),
  error: (message: string, ...args: unknown[]) => log('ERROR', message, ...args),
  debug: (message: string, ...args: unknown[]) => log('DEBUG', message, ...args),
};
