/**
 * One download per song from the third-party audio source (see audioSource.ts), shared by
 * everyone who wants it: the browser's <audio> element streaming it, the full fetch that decodes
 * it for beat analysis, a phone. Each is served from the file as it grows, so playback can start
 * after the first chunk instead of after the whole song. The download keeps going if a listener
 * leaves, and the finished file becomes the song's entry in the audio cache.
 */
import fs from 'fs';
import { IncomingMessage, ServerResponse } from 'http';
import { forgetAudio, resolveAudio } from './audioSource';
import { parseRange } from './sendFile';

const CHUNK_BYTES = 1024 * 1024; // ranged requests: proxies throttle long single downloads less
const CHUNK_TIMEOUT_MS = 60_000;
const CHUNK_TRIES = 3;
const FORGET_FINISHED_MS = 60_000; // keep a finished download around briefly for late readers
const SKIP_AHEAD_BYTES = 512 * 1024; // a seek further ahead than this is fetched on its own

interface Download {
  videoId: string;
  path: string; // the .part file while downloading, the cache file once done
  mime: string;
  total: number; // bytes, from the source's Content-Range
  written: number;
  done: boolean;
  error: Error | null;
  wake: Set<() => void>; // readers waiting for more bytes
}

const downloads = new Map<string, Download>();
const starting = new Map<string, Promise<Download>>();

const notify = (dl: Download) => {
  for (const w of [...dl.wake]) w();
};

/** Fetches bytes [start, end] of the audio, retrying (and re-resolving an expired link) on failure. */
async function fetchRange(videoId: string, start: number, end: number): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= CHUNK_TRIES; attempt++) {
    let source: string | undefined;
    try {
      const info = await resolveAudio(videoId);
      source = info.source;
      const res = await fetch(info.url, { headers: { Range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS) });
      if (res.status === 206 || (res.status === 200 && start === 0)) return res;
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
      forgetAudio(videoId, attempt === CHUNK_TRIES ? source : undefined); // re-resolve; mark the instance bad after the last try
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * The song's download, started if needed. Resolves once the size is known (the first chunk has
 * answered), so a reader can send headers; rejects if no source can provide the song.
 */
export function getDownload(videoId: string, cacheFile: string, onComplete: () => void): Promise<Download> {
  const running = downloads.get(videoId);
  if (running && !running.error) return Promise.resolve(running);
  const pending = starting.get(videoId);
  if (pending) return pending;

  const job = (async () => {
    const info = await resolveAudio(videoId);
    const first = await fetchRange(videoId, 0, CHUNK_BYTES - 1);
    const total = Number(first.headers.get('content-range')?.match(/\/(\d+)$/)?.[1] ?? first.headers.get('content-length'));
    if (!total) throw new Error('The audio source did not say how big the song is');

    const part = `${cacheFile}.${process.pid}-${Date.now()}.part`;
    const dl: Download = { videoId, path: part, mime: info.mime, total, written: 0, done: false, error: null, wake: new Set() };
    downloads.set(videoId, dl);
    void run(dl, first, cacheFile, onComplete);
    return dl;
  })().finally(() => starting.delete(videoId));
  starting.set(videoId, job);
  return job;
}

/** Downloads the whole song into the cache (sharing a download already running) and waits for it to finish. */
export async function downloadToCache(videoId: string, cacheFile: string, onComplete: () => void): Promise<void> {
  const dl = await getDownload(videoId, cacheFile, onComplete);
  while (!dl.done) {
    if (dl.error) throw dl.error;
    await new Promise<void>((resolve) => {
      const w = () => {
        dl.wake.delete(w);
        resolve();
      };
      dl.wake.add(w);
    });
  }
}

async function run(dl: Download, first: Response, cacheFile: string, onComplete: () => void) {
  const fd = await fs.promises.open(dl.path, 'w');
  try {
    let res: Response | null = first;
    while (dl.written < dl.total) {
      if (!res) res = await fetchRange(dl.videoId, dl.written, Math.min(dl.total, dl.written + CHUNK_BYTES) - 1);
      const reader = res.body!.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await fd.write(value, 0, value.length, dl.written);
        dl.written += value.length;
        notify(dl);
      }
      res = null;
    }
    await fd.close();
    await fs.promises.rename(dl.path, cacheFile);
    dl.path = cacheFile;
    dl.done = true;
    notify(dl);
    onComplete();
  } catch (err) {
    await fd.close().catch(() => {});
    dl.error = err instanceof Error ? err : new Error(String(err));
    console.warn(`Audio download failed for ${dl.videoId}:`, dl.error.message);
    notify(dl);
    await fs.promises.unlink(dl.path).catch(() => {});
  } finally {
    setTimeout(() => {
      if (downloads.get(dl.videoId) === dl) downloads.delete(dl.videoId);
    }, FORGET_FINISHED_MS).unref?.();
  }
}

/** Serves the song (or the byte range asked for) while it downloads, waiting for bytes not there yet. */
export async function sendFromDownload(req: IncomingMessage, res: ServerResponse, dl: Download, headers: Record<string, string>) {
  const range = parseRange(req.headers.range, dl.total);
  if (range === 'invalid') {
    res.statusCode = 416;
    res.setHeader('Content-Range', `bytes */${dl.total}`);
    res.end();
    return;
  }
  const { start, end } = range ?? { start: 0, end: dl.total - 1 };
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.setHeader('Content-Type', dl.mime);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Length', String(end - start + 1));
  if (range) {
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${dl.total}`);
  }

  let closed = false;
  res.on('close', () => {
    closed = true;
    notify(dl);
  });
  const waitForBytes = () =>
    new Promise<void>((resolve) => {
      const w = () => {
        dl.wake.delete(w);
        resolve();
      };
      dl.wake.add(w);
    });
  const drained = () => new Promise<void>((resolve) => res.once('drain', resolve));

  // A seek far past what's downloaded: fetch that part from the source now rather than wait
  if (!dl.done && start > dl.written + SKIP_AHEAD_BYTES) {
    try {
      const upstream = await fetchRange(dl.videoId, start, end);
      const reader = upstream.body!.getReader();
      while (!closed) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(Buffer.from(value))) await drained();
      }
      if (closed) await reader.cancel().catch(() => {});
      else res.end();
    } catch (err) {
      console.warn(`Seek-ahead for ${dl.videoId} failed:`, (err as Error).message);
      res.destroy();
    }
    return;
  }

  let fd: fs.promises.FileHandle | null = null;
  let openedPath = '';
  try {
    const buf = Buffer.alloc(64 * 1024);
    let pos = start;
    while (pos <= end && !closed) {
      if (dl.error) throw dl.error;
      if (pos >= dl.written) {
        await waitForBytes();
        continue;
      }
      // Opened late, and again after the .part file is renamed into the cache
      if (!fd || openedPath !== dl.path) {
        await fd?.close();
        openedPath = dl.path;
        fd = await fs.promises.open(openedPath, 'r');
      }
      const want = Math.min(buf.length, dl.written - pos, end - pos + 1);
      const { bytesRead } = await fd.read(buf, 0, want, pos);
      if (!bytesRead) {
        await waitForBytes();
        continue;
      }
      pos += bytesRead;
      if (!res.write(Buffer.from(buf.subarray(0, bytesRead)))) await drained();
    }
    if (!closed) res.end();
  } catch (err) {
    console.warn(`Streaming ${dl.videoId} failed:`, (err as Error).message);
    res.destroy(); // headers are out: cut the connection so the browser sees the failure
  } finally {
    await fd?.close().catch(() => {});
  }
}
