import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const MAX_LOG_BYTES = 20 * 1024 * 1024;
const MAX_LOG_ENTRY_BYTES = 1024 * 1024;
const MAX_STRING_LENGTH = 10_000;
const REDACTED = '[redacted]';

type LogAPI = {
  warn: (...args: unknown[]) => void;
};

export type AdvancedDebugLogAPI = {
  setEnabled: (enabled: boolean) => void;
  isEnabled: () => boolean;
  event: (event: string, data?: Record<string, unknown>, level?: 'debug' | 'info' | 'warn' | 'error') => void;
  getLogPath: () => string;
};

function isSensitiveKey(key: string): boolean {
  return /password|secret|token|authorization|api[-_]?key|cookie/i.test(key);
}

function scrubString(value: string): string {
  let next = value
    .replace(/([?&](?:password|secret|token|apiKey|api_key)=)[^&\s]+/gi, `$1${REDACTED}`)
    .replace(/(authorization:\s*bearer\s+)[^\s]+/gi, `$1${REDACTED}`);

  if (next.length > MAX_STRING_LENGTH) {
    next = `${next.slice(0, MAX_STRING_LENGTH)}...[truncated ${next.length - MAX_STRING_LENGTH} chars]`;
  }
  return next;
}

function sanitize(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return scrubString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (typeof value !== 'object') return String(value);

  if (Buffer.isBuffer(value)) return `[Buffer ${value.byteLength} bytes]`;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: scrubString(value.message),
      stack: value.stack ? scrubString(value.stack) : undefined,
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return '[Circular]';
  if (depth >= 8) return '[MaxDepth]';

  seen.add(value);

  if (Array.isArray(value)) {
    const items = value.slice(0, 100).map((item) => sanitize(item, seen, depth + 1));
    if (value.length > 100) items.push(`[truncated ${value.length - 100} items]`);
    return items;
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(input)) {
    output[key] = isSensitiveKey(key) ? REDACTED : sanitize(item, seen, depth + 1);
  }
  return output;
}

export class AdvancedDebugLogger implements AdvancedDebugLogAPI {
  private enabled: boolean;
  private log: LogAPI;
  private dir = join(homedir(), '.kai', 'plugin-logs', 'bluebubbles');
  private activePath = join(this.dir, 'advanced-debug.log');
  private rotatedPath = join(this.dir, 'advanced-debug.1.log');

  constructor(options: { enabled: boolean; log: LogAPI }) {
    this.enabled = options.enabled;
    this.log = options.log;
    if (this.enabled) {
      this.ensureDir();
    }
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (enabled) {
      this.ensureDir();
      this.event('advanced_debug.enabled', {
        logPath: this.activePath,
        maxBytes: MAX_LOG_BYTES,
      }, 'info');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getLogPath(): string {
    return this.activePath;
  }

  event(event: string, data: Record<string, unknown> = {}, level: 'debug' | 'info' | 'warn' | 'error' = 'debug'): void {
    if (!this.enabled) return;

    try {
      this.ensureDir();
      const entry = {
        ts: new Date().toISOString(),
        level,
        event,
        data: sanitize(data),
      };
      let line = `${JSON.stringify(entry)}\n`;
      if (Buffer.byteLength(line, 'utf8') > MAX_LOG_ENTRY_BYTES) {
        line = `${JSON.stringify({
          ts: entry.ts,
          level,
          event,
          data: {
            entryTruncated: true,
            originalBytes: Buffer.byteLength(line, 'utf8'),
          },
        })}\n`;
      }
      this.rotateIfNeeded(Buffer.byteLength(line, 'utf8'));
      appendFileSync(this.activePath, line, 'utf8');
    } catch (err) {
      this.log.warn('Advanced debug log write failed:', err);
    }
  }

  private ensureDir(): void {
    mkdirSync(this.dir, { recursive: true });
  }

  private rotateIfNeeded(nextBytes: number): void {
    if (!existsSync(this.activePath)) return;

    const currentBytes = statSync(this.activePath).size;
    if (currentBytes + nextBytes <= MAX_LOG_BYTES) return;

    try {
      if (existsSync(this.rotatedPath)) rmSync(this.rotatedPath, { force: true });
      renameSync(this.activePath, this.rotatedPath);
    } catch (err) {
      this.log.warn('Advanced debug log rotation failed:', err);
    }
  }
}
