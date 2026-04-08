/**
 * Structured Logging Utility
 *
 * Provides a lightweight, structured logger with:
 * - Log levels: debug, info, warn, error
 * - Optional JSON-format output for machine consumption
 * - Optional debug dumps of intermediate pipeline artifacts
 * - No external dependencies
 */

// ============================================================================
// Types
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

export interface LoggerOptions {
  /** Minimum level to emit. Default: 'info'. */
  level?: LogLevel;
  /** Emit log lines as JSON. Default: false (human-readable). */
  json?: boolean;
  /** Label prepended to every log line. */
  label?: string;
  /** When true, debug dump calls write to this output function. Default: console.log. */
  dumpOutput?: (line: string) => void;
}

// ============================================================================
// Severity ranking
// ============================================================================

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ============================================================================
// Logger
// ============================================================================

export class Logger {
  private readonly minLevel: number;
  private readonly json: boolean;
  private readonly label: string;
  private readonly dumpOutput: (line: string) => void;

  constructor(options: LoggerOptions = {}) {
    this.minLevel = LEVEL_RANK[options.level ?? 'info'];
    this.json = options.json ?? false;
    this.label = options.label ?? 'worker';
    this.dumpOutput = options.dumpOutput ?? ((line) => process.stdout.write(line + '\n'));
  }

  // --------------------------------------------------------------------------
  // Core log method
  // --------------------------------------------------------------------------

  log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < this.minLevel) return;

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...(context ? { context } : {}),
    };

    if (this.json) {
      this.dumpOutput(JSON.stringify({ label: this.label, ...entry }));
    } else {
      const prefix = `[${entry.timestamp}] [${this.label}] [${level.toUpperCase()}]`;
      const ctx = context ? ' ' + JSON.stringify(context) : '';
      const output = `${prefix} ${message}${ctx}`;
      switch (level) {
        case 'debug':
        case 'info':
          this.dumpOutput(output);
          break;
        case 'warn':
          process.stderr.write(output + '\n');
          break;
        case 'error':
          process.stderr.write(output + '\n');
          break;
      }
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }

  // --------------------------------------------------------------------------
  // Debug dump – optional artifact snapshots
  // --------------------------------------------------------------------------

  /**
   * Dump an intermediate pipeline artifact for debugging.
   *
   * Only emits when the configured log level is 'debug'.
   *
   * @param label - Human-readable artifact name (e.g. "validated player pool")
   * @param artifact - The object to serialise
   */
  dump(label: string, artifact: unknown): void {
    if (LEVEL_RANK['debug'] < this.minLevel) return;
    const serialised = JSON.stringify(artifact, null, 2);
    this.dumpOutput(`[DUMP:${label}]\n${serialised}`);
  }

  // --------------------------------------------------------------------------
  // Child logger with a narrower label
  // --------------------------------------------------------------------------

  child(sublabel: string, overrides: Partial<LoggerOptions> = {}): Logger {
    return new Logger({
      level: (Object.keys(LEVEL_RANK) as LogLevel[]).find(
        (k) => LEVEL_RANK[k] === this.minLevel
      ) ?? 'info',
      json: this.json,
      label: `${this.label}:${sublabel}`,
      dumpOutput: this.dumpOutput,
      ...overrides,
    });
  }
}

// ============================================================================
// Default singleton logger
// ============================================================================

/**
 * A shared logger instance pre-configured from the environment.
 *
 * Set LOG_LEVEL=debug to enable debug output.
 * Set LOG_JSON=true for JSON-formatted lines.
 */
export const logger = new Logger({
  level: (process.env.LOG_LEVEL as LogLevel | undefined) ?? 'info',
  json: process.env.LOG_JSON === 'true',
  label: 'worker',
});
