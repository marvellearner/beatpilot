/**
 * YouTube search, audio streaming with an on-disk cache, and replay heatmaps.
 * Song audio never comes from YouTube directly: it comes from a third-party front-end (see
 * audioSource.ts) and is streamed to the browser while it downloads (see audioDownload.ts).
 */
import fs from 'fs';
import path from 'path';
import { IncomingMessage, ServerResponse } from 'http';
import { ROOT_DIR } from './paths';
import { sendFile } from './sendFile';
import { resolveAudio, searchVideos } from './audioSource';
import { getDownload, sendFromDownload } from './audioDownload';
import { logError } from './logger';
import { isLocalUrl, localById, savedCopyFor, searchLocal, serveLocalFile, toSearchResult } from './localLibrary';

// Downloaded song audio (compressed, as YouTube sends it; ~4 MB per song), one file per video id
export const AUDIO_CACHE_DIR = path.join(ROOT_DIR, 'cache', 'audio');
export const AUDIO_CACHE_MAX_BYTES = 2 * 1024 ** 3; // ~500 songs; least recently played go first
const STALE_PART_MS = 60 * 60 * 1000;

export function cachedAudioPath(videoId: string): string {
  return path.join(AUDIO_CACHE_DIR, `${videoId}.audio`);
}

export let pruning = false;
/** Keeps the audio cache under its size limit by deleting the least recently played songs. */
export async function pruneAudioCache() {
  if (pruning) return;
  pruning = true;
  try {
    const all = await fs.promises.readdir(AUDIO_CACHE_DIR);
    // Downloads cut off by a crash or restart leave .part files behind; an hour old means abandoned
    for (const n of all.filter((n) => n.endsWith('.part'))) {
      const full = path.join(AUDIO_CACHE_DIR, n);
      const s = await fs.promises.stat(full).catch(() => null);
      if (s && Date.now() - s.mtimeMs > STALE_PART_MS) await fs.promises.unlink(full).catch(() => {});
    }
    const names = all.filter((n) => n.endsWith('.audio'));
    const files = await Promise.all(
      names.map(async (n) => {
        const full = path.join(AUDIO_CACHE_DIR, n);
        const s = await fs.promises.stat(full);
        return { full, size: s.size, used: s.mtimeMs };
      })
    );
    let total = files.reduce((sum, f) => sum + f.size, 0);
    if (total <= AUDIO_CACHE_MAX_BYTES) return;
    // Trim to 90% so this doesn't run after every single new song
    for (const f of files.sort((a, b) => a.used - b.used)) {
      if (total <= AUDIO_CACHE_MAX_BYTES * 0.9) break;
      await fs.promises.unlink(f.full).catch(() => {});
      total -= f.size;
    }
  } catch (err) {
    console.warn('Audio cache cleanup failed:', err);
  } finally {
    pruning = false;
  }
}
export interface SearchResult {
  title: string;
  url: string;
  author: string;
  duration: number; // in seconds
  thumbnail: string;
  timestamp: string;
  highlightTime?: number;
  highlightIntensity?: number;
}

/**
 * Extracts the 11-character video ID from any YouTube / YouTube Music link
 * (watch?v=, youtu.be/, /shorts/, /embed/, /live/, with or without https://).
 */
export function extractYouTubeVideoId(input: string): string | null {
  const match = input.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

export function canonicalYouTubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
// Heatmap and Search in-memory caches (with TTL and in-flight deduplication)
const HEATMAP_CACHE = new Map<string, { peakSeconds: number; intensity: number } | null>();
const HEATMAP_CACHE_MAX = 1000;

interface SearchCacheEntry {
  results: SearchResult[];
  savedAt: number;
}
const SEARCH_CACHE = new Map<string, SearchCacheEntry>();
const SEARCH_CACHE_MAX = 500;
const SEARCH_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getCachedSearch(key: string): SearchResult[] | null {
  const entry = SEARCH_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.savedAt > SEARCH_CACHE_TTL_MS) {
    SEARCH_CACHE.delete(key);
    return null;
  }
  return entry.results;
}

function setCachedSearch(key: string, results: SearchResult[]) {
  if (SEARCH_CACHE.size >= SEARCH_CACHE_MAX) {
    const oldestKey = SEARCH_CACHE.keys().next().value;
    if (oldestKey) SEARCH_CACHE.delete(oldestKey);
  }
  SEARCH_CACHE.set(key, { results, savedAt: Date.now() });
}

const inFlightSearches = new Map<string, Promise<SearchResult[]>>();

/**
 * YouTube's audience replay heatmap ("most replayed" moment). It is only on YouTube's own watch
 * page, so getting it would mean this laptop loading youtube.com for every song: switched off to
 * keep YouTube from blocking the IP. The best part is found from the audio instead
 * (HighlightDetector). Kept as a function so callers and cached results still work.
 */
export async function extractYouTubeHeatmap(videoId: string): Promise<{ peakSeconds: number; intensity: number } | null> {
  return HEATMAP_CACHE.get(videoId) ?? null;
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// 1. Search Song or Parse YouTube Link
export async function handleSearch(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const query = url.searchParams.get('q');
  if (!query) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Query parameter q is required' }));
    return;
  }

  res.setHeader('Content-Type', 'application/json');
  if (isLocalUrl(query)) {
    const track = localById(query.slice('local:'.length));
    res.end(JSON.stringify({ results: track ? [toSearchResult(track)] : [] }));
    return;
  }
  // Songs on this laptop come first: instant, and they work with no internet
  const local = extractYouTubeVideoId(query) ? [] : searchLocal(query, 3);

  try {
    // Check if query is already a YouTube/YouTube Music URL
    const videoId = extractYouTubeVideoId(query);

    if (videoId) {
      const cacheKey = `url:${videoId}`;
      const cached = getCachedSearch(cacheKey);
      if (cached) {
        res.end(JSON.stringify({ results: cached }));
        return;
      }

      const cleanUrl = canonicalYouTubeUrl(videoId);
      const [info, heatmap] = await Promise.all([resolveAudio(videoId), extractYouTubeHeatmap(videoId)]);

      const result: SearchResult = {
        title: info.title,
        url: cleanUrl,
        author: info.author,
        duration: info.lengthSeconds || 180,
        thumbnail: info.thumbnail,
        timestamp: formatDuration(info.lengthSeconds || 180),
        highlightTime: heatmap?.peakSeconds,
        highlightIntensity: heatmap?.intensity,
      };
      setCachedSearch(cacheKey, [result]);
      res.end(JSON.stringify({ results: [result] }));
      return;
    }

    // Otherwise, perform title search using yt-search with caching & fast in-flight deduplication
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 20));
    const cacheKey = `${query.toLowerCase().trim()}:${limit}`;
    const cachedVideos = getCachedSearch(cacheKey);
    if (cachedVideos) {
      res.end(JSON.stringify({ results: [...local, ...cachedVideos.filter((v) => !local.some((l) => l.title === v.title))] }));
      return;
    }

    // If client disconnected before YouTube fetch, abort early
    if (req.destroyed || req.socket?.destroyed) return;

    let searchPromise = inFlightSearches.get(cacheKey);
    if (!searchPromise) {
      searchPromise = (async () => {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Search timed out after 15s')), 15_000)
        );
        const hits = await Promise.race([searchVideos(query), timeoutPromise]);
        const videos: SearchResult[] = hits.slice(0, limit).map((v) => ({
          title: v.title,
          url: canonicalYouTubeUrl(v.videoId),
          author: v.author || 'Unknown Artist',
          duration: v.lengthSeconds || 180,
          thumbnail: v.thumbnail,
          timestamp: formatDuration(v.lengthSeconds || 180),
        }));

        // Non-blocking heatmap: if cached, attach immediately.
        // If not cached, resolve in background so it's ready when played, without delaying search response!
        const topId = videos[0] ? extractYouTubeVideoId(videos[0].url) : null;
        if (topId) {
          const cachedHeatmap = HEATMAP_CACHE.get(topId);
          if (cachedHeatmap) {
            videos[0].highlightTime = cachedHeatmap.peakSeconds;
            videos[0].highlightIntensity = cachedHeatmap.intensity;
          } else {
            void extractYouTubeHeatmap(topId).then((hm) => {
              if (hm && videos[0]) {
                videos[0].highlightTime = hm.peakSeconds;
                videos[0].highlightIntensity = hm.intensity;
              }
            });
          }
        }

        // An empty answer is usually a busy instance, not a missing song: ask again next time
        if (videos.length) setCachedSearch(cacheKey, videos);
        return videos;
      })().finally(() => {
        inFlightSearches.delete(cacheKey);
      });
      inFlightSearches.set(cacheKey, searchPromise);
    }

    const videos = await searchPromise;
    if (req.destroyed || req.socket?.destroyed) return;

    res.end(JSON.stringify({ results: [...local, ...videos.filter((v) => !local.some((l) => l.title === v.title))] }));
  } catch (err: unknown) {
    if (local.length) {
      // Offline (or YouTube failing/timing out): the local matches still answer instantly
      res.end(JSON.stringify({ results: local, offline: true }));
      return;
    }
    logError('search', err);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'Search failed', details: String(err) }));
  }
  return;
}

// 1b. Inspect disk audio cache status (cache/audio)
export async function handleCacheStatus(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  res.setHeader('Content-Type', 'application/json');
  try {
    await fs.promises.mkdir(AUDIO_CACHE_DIR, { recursive: true });
    const names = (await fs.promises.readdir(AUDIO_CACHE_DIR)).filter((n) => n.endsWith('.audio'));
    const files = await Promise.all(
      names.map(async (n) => {
        const s = await fs.promises.stat(path.join(AUDIO_CACHE_DIR, n));
        return { videoId: n.replace(/\.audio$/, ''), size: s.size, mtime: s.mtimeMs };
      })
    );
    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    res.end(
      JSON.stringify({
        cacheDir: 'cache/audio',
        count: files.length,
        totalBytes,
        totalMb: Math.round((totalBytes / (1024 * 1024)) * 10) / 10,
        maxMb: Math.round(AUDIO_CACHE_MAX_BYTES / (1024 * 1024)),
      })
    );
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'Failed to inspect cache', details: String(err) }));
  }
  return;
}

// 2. Stream Audio Bytes
export async function handleStream(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const requested = url.searchParams.get('url') || '';
  if (isLocalUrl(requested)) {
    const track = localById(requested.slice('local:'.length));
    if (track) return serveLocalFile(req, res, track);
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'This local song is no longer in the library' }));
    return;
  }
  const videoId = extractYouTubeVideoId(requested);
  if (!videoId) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'A valid YouTube url parameter is required' }));
    return;
  }

  try {
    // Already on disk: serve it (instant, works offline, seekable) and mark it recently used
    const cachedFile = cachedAudioPath(videoId);
    const cached = await fs.promises.stat(cachedFile).catch(() => null);
    if (cached?.isFile()) {
      const now = new Date();
      fs.promises.utimes(cachedFile, now, now).catch(() => {});
      return sendFile(req, res, cachedFile, sniffAudioType(cachedFile), { 'Cache-Control': 'no-cache', 'X-Audio-Cache': 'hit' });
    }
    // A most-played song saved for offline: play that copy (instant, no internet needed)
    const saved = savedCopyFor(requested);
    if (saved) return serveLocalFile(req, res, saved);

    // Not on this laptop: stream it from the third-party source while it downloads into the cache
    await fs.promises.mkdir(AUDIO_CACHE_DIR, { recursive: true });
    const dl = await getDownload(videoId, cachedFile, () => void pruneAudioCache());
    await sendFromDownload(req, res, dl, { 'Cache-Control': 'no-cache', 'X-Audio-Cache': 'stream' });
  } catch (err: unknown) {
    logError('stream', err);
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Could not get this song from the audio source', details: String(err) }));
    } else {
      res.destroy();
    }
  }
  return;
}

/** YouTube audio is MP4 (AAC) or WebM (Opus); the cache file doesn't say which, its first bytes do. */
function sniffAudioType(file: string): string {
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(8);
    fs.readSync(fd, head, 0, 8, 0);
    fs.closeSync(fd);
    if (head.readUInt32BE(0) === 0x1a45dfa3) return 'audio/webm';
  } catch {
    // unreadable: sendFile reports it
  }
  return 'audio/mp4';
}

// 4. Query YouTube Audience Replay Heatmap for any URL
export async function handleHeatmap(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const videoId = extractYouTubeVideoId(url.searchParams.get('url') || '');
  if (!videoId) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'A valid YouTube url parameter is required' }));
    return;
  }

  try {
    res.setHeader('Content-Type', 'application/json');
    const heatmap = await extractYouTubeHeatmap(videoId);
    res.end(JSON.stringify({ heatmap }));
  } catch (err) {
    logError('heatmap', err);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'Heatmap query failed', details: String(err) }));
  }
  return;
}
