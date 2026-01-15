export interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  component: string;
  message: string;
  metadata?: Record<string, any>;
}

class ObservabilityService {
  private logs: LogEntry[] = [];
  private readonly MAX_LOGS = 1000;
  private stats = {
    total_logged: 0,
    by_level: { info: 0, warn: 0, error: 0 }
  };

  log(level: 'info' | 'warn' | 'error', component: string, message: string, metadata?: Record<string, any>): void {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      component,
      message,
      metadata
    };

    // Enforce max logs limit
    if (this.logs.length >= this.MAX_LOGS) {
      this.logs.shift(); // Remove oldest
    }
    
    this.logs.push(entry);
    this.stats.total_logged++;
    this.stats.by_level[level]++;
    this.emitLog(entry);
  }

  info(component: string, message: string, metadata?: Record<string, any>): void {
    this.log('info', component, message, metadata);
  }

  warn(component: string, message: string, metadata?: Record<string, any>): void {
    this.log('warn', component, message, metadata);
  }

  error(component: string, message: string, metadata?: Record<string, any>): void {
    this.log('error', component, message, metadata);
  }

  private emitLog(entry: LogEntry): void {
    const timestamp = new Date(entry.timestamp).toISOString();
    const prefix = `[${timestamp}] [${entry.level.toUpperCase()}] [${entry.component}]`;
    const message = `${prefix} ${entry.message}`;
    
    if (entry.metadata) {
      console.log(message, entry.metadata);
    } else {
      console.log(message);
    }
  }

  getLogs(filter?: { level?: string; component?: string; limit?: number }): LogEntry[] {
    let results = this.logs;
    
    if (filter) {
      results = results.filter(log => {
        if (filter.level && log.level !== filter.level) return false;
        if (filter.component && log.component !== filter.component) return false;
        return true;
      });
    }
    
    if (filter?.limit) {
      results = results.slice(-filter.limit);
    }
    
    return results;
  }

  getStats() {
    return {
      ...this.stats,
      current_logs: this.logs.length,
      max_logs: this.MAX_LOGS
    };
  }

  clear(): void {
    this.logs = [];
  }
}

export const observability = new ObservabilityService();
