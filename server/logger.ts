/* server/logger.ts
 * Simple logger that appends timestamped, human‑readable error lines to a log file.
 * All server modules can import { logError } from './logger' and call it with a
 * context tag (e.g. 'search', 'stream') and the error object/value.
 */
import * as fs from 'fs';
import * as path from 'path';

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'server-issues.log');

// Ensure the logs directory exists once at module load time.
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
} catch (_) {
  // ignore – mkdirSync is idempotent
}

/**
 * Append a friendly error line to the log file.
 *   [ISO‑timestamp] [context] message\n
 * The function does not await the write – it is fire‑and‑forget so it never
 * blocks request handling.
 */
export function logError(context: string, err: unknown): void {
  const ts = new Date().toISOString();
  const msg = typeof err === 'object' && err !== null && 'stack' in err
    ? (err as any).stack
    : String(err);
  const line = `[${ts}] [${context}] ${msg}\n`;
  fs.appendFile(LOG_FILE, line, () => {
    /* ignore callback – we only need best‑effort logging */
  });
}
