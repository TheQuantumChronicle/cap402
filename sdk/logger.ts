/**
 * CAP-402 SDK Logger
 * 
 * Structured logging with levels, context, and optional file output.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  agent_id?: string;
  category: string;
  message: string;
  context?: Record<string, any>;
  duration_ms?: number;
}

export interface LoggerConfig {
  level: LogLevel;
  agent_id?: string;
  include_timestamp?: boolean;
  include_context?: boolean;
  color?: boolean;
  onLog?: (entry: LogEntry) => void;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4
};

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: COLORS.dim,
  info: COLORS.blue,
  warn: COLORS.yellow,
  error: COLORS.red,
  silent: ''
};

const LEVEL_ICONS: Record<LogLevel, string> = {
  debug: '🔍',
  info: 'ℹ️ ',
  warn: '⚠️ ',
  error: '❌',
  silent: ''
};

export class Logger {
  private config: LoggerConfig;
  private logs: LogEntry[] = [];
  private timers: Map<string, number> = new Map();

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: config.level ?? 'info',
      agent_id: config.agent_id,
      include_timestamp: config.include_timestamp ?? true,
      include_context: config.include_context ?? true,
      color: config.color ?? true,
      onLog: config.onLog
    };
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
  }

  private formatTimestamp(): string {
    return new Date().toISOString();
  }

  private formatMessage(entry: LogEntry): string {
    const parts: string[] = [];
    const c = this.config.color ? COLORS : { reset: '', dim: '', red: '', green: '', yellow: '', blue: '', magenta: '', cyan: '' };
    const levelColor = this.config.color ? LEVEL_COLORS[entry.level] : '';

    if (this.config.include_timestamp) {
      parts.push(`${c.dim}[${entry.timestamp}]${c.reset}`);
    }

    if (entry.agent_id) {
      parts.push(`${c.cyan}[${entry.agent_id}]${c.reset}`);
    }

    parts.push(`${levelColor}[${entry.level.toUpperCase()}]${c.reset}`);
    parts.push(`${c.magenta}[${entry.category}]${c.reset}`);
    parts.push(entry.message);

    if (entry.duration_ms !== undefined) {
      parts.push(`${c.dim}(${entry.duration_ms}ms)${c.reset}`);
    }

    let output = parts.join(' ');

    if (this.config.include_context && entry.context && Object.keys(entry.context).length > 0) {
      output += `\n  ${c.dim}${JSON.stringify(entry.context)}${c.reset}`;
    }

    return output;
  }

  private log(level: LogLevel, category: string, message: string, context?: Record<string, any>, duration_ms?: number): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: this.formatTimestamp(),
      level,
      agent_id: this.config.agent_id,
      category,
      message,
      context,
      duration_ms
    };

    this.logs.push(entry);

    // Keep only last 1000 logs in memory
    if (this.logs.length > 1000) {
      this.logs.shift();
    }

    // Output to console
    const formatted = this.formatMessage(entry);
    switch (level) {
      case 'debug':
        console.debug(formatted);
        break;
      case 'info':
        console.info(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      case 'error':
        console.error(formatted);
        break;
    }

    // Call custom handler
    if (this.config.onLog) {
      this.config.onLog(entry);
    }
  }

  debug(category: string, message: string, context?: Record<string, any>): void {
    this.log('debug', category, message, context);
  }

  info(category: string, message: string, context?: Record<string, any>): void {
    this.log('info', category, message, context);
  }

  warn(category: string, message: string, context?: Record<string, any>): void {
    this.log('warn', category, message, context);
  }

  error(category: string, message: string, context?: Record<string, any>): void {
    this.log('error', category, message, context);
  }

  /**
   * Start a timer for measuring operation duration
   */
  time(label: string): void {
    this.timers.set(label, Date.now());
  }

  /**
   * End a timer and log the duration
   */
  timeEnd(label: string, category: string, message?: string): number {
    const start = this.timers.get(label);
    if (!start) {
      this.warn('logger', `Timer "${label}" not found`);
      return 0;
    }

    const duration = Date.now() - start;
    this.timers.delete(label);
    this.log('debug', category, message || label, undefined, duration);
    return duration;
  }

  /**
   * Log a trade event
   */
  trade(action: 'prepare' | 'execute' | 'cancel', details: {
    token_in: string;
    token_out: string;
    amount: number;
    status?: string;
    tx_hash?: string;
  }): void {
    const icon = action === 'execute' ? '✅' : action === 'prepare' ? '📝' : '❌';
    this.info('trade', `${icon} ${action.toUpperCase()}: ${details.amount} ${details.token_in} → ${details.token_out}`, details);
  }

  /**
   * Log an A2A event
   */
  a2a(action: string, details: {
    from_agent?: string;
    to_agent?: string;
    capability?: string;
    status?: string;
  }): void {
    this.info('a2a', `🤝 ${action}`, details);
  }

  /**
   * Log a signal event
   */
  signal(type: string, token: string, details?: Record<string, any>): void {
    const icon = type === 'buy' ? '📈' : type === 'sell' ? '📉' : '📊';
    this.info('signal', `${icon} ${type.toUpperCase()} signal for ${token}`, details);
  }

  /**
   * Log a security event
   */
  security(event: string, details?: Record<string, any>): void {
    this.info('security', `🔒 ${event}`, details);
  }

  /**
   * Get recent logs
   */
  getLogs(options?: { level?: LogLevel; category?: string; limit?: number }): LogEntry[] {
    let logs = [...this.logs];

    if (options?.level) {
      const minLevel = LOG_LEVELS[options.level];
      logs = logs.filter(l => LOG_LEVELS[l.level] >= minLevel);
    }

    if (options?.category) {
      logs = logs.filter(l => l.category === options.category);
    }

    if (options?.limit) {
      logs = logs.slice(-options.limit);
    }

    return logs;
  }

  /**
   * Clear logs
   */
  clearLogs(): void {
    this.logs = [];
  }

  /**
   * Set log level
   */
  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  /**
   * Set agent ID
   */
  setAgentId(agentId: string): void {
    this.config.agent_id = agentId;
  }

  /**
   * Create a child logger with additional context
   */
  child(category: string): CategoryLogger {
    return new CategoryLogger(this, category);
  }
}

/**
 * Category-specific logger
 */
export class CategoryLogger {
  constructor(private parent: Logger, private category: string) {}

  debug(message: string, context?: Record<string, any>): void {
    this.parent.debug(this.category, message, context);
  }

  info(message: string, context?: Record<string, any>): void {
    this.parent.info(this.category, message, context);
  }

  warn(message: string, context?: Record<string, any>): void {
    this.parent.warn(this.category, message, context);
  }

  error(message: string, context?: Record<string, any>): void {
    this.parent.error(this.category, message, context);
  }
}

// ============================================
// DEFAULT LOGGER
// ============================================

export const logger = new Logger();

/**
 * Create a logger for an agent
 */
export function createLogger(agentId: string, level: LogLevel = 'info'): Logger {
  return new Logger({ agent_id: agentId, level });
}

/**
 * Set global log level
 */
export function setLogLevel(level: LogLevel): void {
  logger.setLevel(level);
}
