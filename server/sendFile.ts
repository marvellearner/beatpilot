/** Sends a file from disk with HTTP Range support, without letting a read error take the server down. */
import fs from 'fs';
import { IncomingMessage, ServerResponse } from 'http';

/** The one byte range asked for ("bytes=100-", "bytes=100-199", "bytes=-500"), or null for the whole file. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'invalid' | null {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return null; // no Range, or a multi-range request: send the whole file
  const [, from, to] = m;
  if (!from && !to) return 'invalid';
  let start: number;
  let end: number;
  if (!from) {
    start = Math.max(0, size - Number(to)); // the last N bytes
    end = size - 1;
  } else {
    start = Number(from);
    end = to ? Math.min(Number(to), size - 1) : size - 1;
  }
  return start <= end && start < size ? { start, end } : 'invalid';
}

export async function sendFile(req: IncomingMessage, res: ServerResponse, file: string, contentType: string, headers: Record<string, string> = {}) {
  const stat = await fs.promises.stat(file).catch(() => null);
  if (!stat?.isFile()) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'The audio file is no longer there' }));
    return;
  }
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Accept-Ranges', 'bytes');

  const range = parseRange(req.headers.range, stat.size);
  if (range === 'invalid') {
    res.statusCode = 416;
    res.setHeader('Content-Range', `bytes */${stat.size}`);
    res.end();
    return;
  }
  const { start, end } = range ?? { start: 0, end: stat.size - 1 };
  if (range) {
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
  }
  res.setHeader('Content-Length', String(stat.size === 0 ? 0 : end - start + 1));
  if (stat.size === 0) {
    res.end();
    return;
  }

  const stream = fs.createReadStream(file, { start, end });
  // The file can vanish between stat and open (cache cleanup, a moved song): fail this request only
  stream.on('error', (err) => {
    console.warn(`Could not read ${file}:`, err.message);
    if (!res.headersSent) {
      res.statusCode = 404;
      res.removeHeader('Content-Length');
      res.removeHeader('Content-Range');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'The audio file is no longer there' }));
    } else {
      res.destroy();
    }
  });
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}
