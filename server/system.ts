/** Laptop memory telemetry for the RAM meter. */
import os from 'os';
import { IncomingMessage, ServerResponse } from 'http';
import { logError } from './logger';

// 7. System & RAM Usage Telemetry (GET /api/system/memory)
export async function handleSystemMemory(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  res.setHeader('Content-Type', 'application/json');
  try {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    const percent = total > 0 ? Math.round((used / total) * 100) : 0;
    const proc = process.memoryUsage();

    res.end(
      JSON.stringify({
        system: {
          totalBytes: total,
          freeBytes: free,
          usedBytes: used,
          usedPercent: percent,
          totalGb: (total / (1024 ** 3)).toFixed(1),
          usedGb: (used / (1024 ** 3)).toFixed(1),
          freeGb: (free / (1024 ** 3)).toFixed(1),
        },
        process: {
          rssBytes: proc.rss,
          rssMb: (proc.rss / (1024 ** 2)).toFixed(0),
          heapUsedMb: (proc.heapUsed / (1024 ** 2)).toFixed(0),
          heapTotalMb: (proc.heapTotal / (1024 ** 2)).toFixed(0),
        },
        timestamp: Date.now(),
      })
    );
  } catch (err) {
    logError('system', err);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'Failed to read memory' }));
  }
  return;
}
