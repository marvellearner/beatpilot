/** YouTube search, audio streaming with an on-disk cache, and replay heatmaps. */
import fs from 'fs';
import path from 'path';
import { Ytdl } from '@distube/ytdl-core';
// @ts-expect-error yt-search has untyped default export
import ytSearch from 'yt-search';
import { IncomingMessage, ServerResponse } from 'http';
import { ROOT_DIR } from './paths';
import { isLocalUrl, localById, savedCopyFor, searchLocal, serveLocalFile, toSearchResult } from './localLibrary';

const ytdl = new Ytdl();
// Downloaded song audio (compressed, as YouTube sends it; ~4 MB per song), one file per video id
export const AUDIO_CACHE_DIR = path.join(ROOT_DIR, 'cache', 'audio');
export const AUDIO_CACHE_MAX_BYTES = 2 * 1024 ** 3; // ~500 songs; least recently played go first

export function cachedAudioPath(videoId: string): string {
  return path.join(AUDIO_CACHE_DIR, `${videoId}.audio`);
}

export let pruning = false;
/** Keeps the audio cache under its size limit by deleting the least recently played songs. */
export async function pruneAudioCache() {
  if (pruning) return;
  pruning = true;
  try {
    const names = (await fs.promises.readdir(AUDIO_CACHE_DIR)).filter((n) => n.endsWith('.audio'));
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

/**
 * Scrapes YouTube audience replay heatmap to extract the world's most liked / replayed moment.
 * Only ever fetches youtube.com, built from a validated video ID.
 */
export async function extractYouTubeHeatmap(videoId: string): Promise<{ peakSeconds: number; intensity: number } | null> {
  try {
    const res = await fetch(canonicalYouTubeUrl(videoId), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(5000),
    });
    const html = await res.text();
    const regex = /\{"startMillis":"(\d+)","durationMillis":"(\d+)","intensityScoreNormalized":([\d\.]+)\}/g;
    let match;
    let maxOverall = -1;
    let peakOverallStart = 0;
    let maxMusical = -1;
    let peakMusicalStart = 0;
    let count = 0;

    while ((match = regex.exec(html)) !== null) {
      count++;
      const startMs = parseInt(match[1], 10);
      const intensity = parseFloat(match[3]);

      if (intensity > maxOverall) {
        maxOverall = intensity;
        peakOverallStart = startMs;
      }

      // Ignore first 15 seconds to avoid video-start skew
      if (startMs >= 15000 && intensity > maxMusical) {
        maxMusical = intensity;
        peakMusicalStart = startMs;
      }
    }

    if (count > 0) {
      const selectedStart = (peakMusicalStart > 0 && maxMusical > 0.35)
        ? peakMusicalStart
        : peakOverallStart;
      const intensity = (peakMusicalStart > 0 && maxMusical > 0.35)
        ? maxMusical
        : maxOverall;

      return {
        peakSeconds: Math.round((selectedStart / 1000) * 10) / 10,
        intensity: Math.min(1.0, Math.round(intensity * 100) / 100),
      };
    }
  } catch (err) {
    console.error('Heatmap scrape error:', err);
  }
  return null;
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
      const cleanUrl = canonicalYouTubeUrl(videoId);
      const [info, heatmap] = await Promise.all([
        ytdl.getInfo(cleanUrl),
        extractYouTubeHeatmap(videoId),
      ]);

      const result: SearchResult = {
        title: info.videoDetails.title,
        url: cleanUrl,
        author: info.videoDetails.author.name,
        duration: Number(info.videoDetails.lengthSeconds) || 180,
        thumbnail: info.videoDetails.thumbnails[0]?.url || '',
        timestamp: formatDuration(Number(info.videoDetails.lengthSeconds) || 180),
        highlightTime: heatmap?.peakSeconds,
        highlightIntensity: heatmap?.intensity,
      };
      res.end(JSON.stringify({ results: [result] }));
      return;
    }

    // Otherwise, perform title search using yt-search
    const limit = Math.min(10, Math.max(1, Number(url.searchParams.get('limit')) || 6));
    const searchResults = await ytSearch(query);
    const videos: SearchResult[] = (searchResults.videos || []).slice(0, limit).map((v: { title: string; url: string; author: { name: string }; seconds: number; thumbnail: string; timestamp: string }) => ({
      title: v.title,
      url: v.url,
      author: v.author?.name || 'Unknown Artist',
      duration: v.seconds || 180,
      thumbnail: v.thumbnail || '',
      timestamp: v.timestamp || '',
    }));

    // The client plays the top result, so give it the "most replayed" hook too
    const topId = videos[0] ? extractYouTubeVideoId(videos[0].url) : null;
    if (topId) {
      const heatmap = await extractYouTubeHeatmap(topId);
      videos[0].highlightTime = heatmap?.peakSeconds;
      videos[0].highlightIntensity = heatmap?.intensity;
    }

    res.end(JSON.stringify({ results: [...local, ...videos.filter((v) => !local.some((l) => l.title === v.title))] }));
  } catch (err: unknown) {
    if (local.length) {
      // Offline (or YouTube failing): the local matches still answer
      res.end(JSON.stringify({ results: local, offline: true }));
      return;
    }
    console.error('Search error:', err);
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
    if (track) return serveLocalFile(res, track);
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
    res.setHeader('Content-Type', 'audio/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-cache');

    // Already on disk: serve it (instant, works offline) and mark it recently used
    const cachedFile = cachedAudioPath(videoId);
    const cached = await fs.promises.stat(cachedFile).catch(() => null);
    if (cached?.isFile()) {
      const now = new Date();
      fs.promises.utimes(cachedFile, now, now).catch(() => {});
      res.setHeader('Content-Length', String(cached.size));
      res.setHeader('X-Audio-Cache', 'hit');
      fs.createReadStream(cachedFile).pipe(res);
      return;
    }
    // A most-played song saved for offline: play that copy (instant, no internet needed)
    const saved = savedCopyFor(requested);
    if (saved) return serveLocalFile(res, saved);
    res.setHeader('X-Audio-Cache', 'miss');

    // Download audio stream using ytdl
    const stream = ytdl.download(canonicalYouTubeUrl(videoId), {
      filter: { hasAudio: true, hasVideo: false },
      quality: 'highestaudio',
    });

    // Save a copy while streaming. It is written under a temporary name and only
    // renamed into the cache once complete, so a broken download is never kept.
    await fs.promises.mkdir(AUDIO_CACHE_DIR, { recursive: true });
    const partFile = `${cachedFile}.${process.pid}-${Date.now()}.part`;
    const file = fs.createWriteStream(partFile);
    let downloaded = false;
    let failed = false;
    const discardPart = () => {
      file.destroy();
      fs.promises.unlink(partFile).catch(() => {});
    };
    stream.on('end', () => {
      downloaded = !failed;
    });
    file.on('finish', () => {
      if (!downloaded) return discardPart();
      fs.promises
        .rename(partFile, cachedFile)
        .then(() => pruneAudioCache())
        .catch(() => discardPart());
    });
    file.on('error', (err) => {
      console.warn('Could not save audio to the cache:', err);
      failed = true;
      discardPart();
    });

    // Stop downloading if the browser goes away (tab closed, page reloaded)
    res.on('close', () => {
      if (!downloaded) {
        failed = true;
        stream.destroy();
        discardPart();
      }
    });

    stream.on('error', (streamErr) => {
      console.error('Audio stream error:', streamErr);
      failed = true;
      discardPart();
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'Stream error', details: String(streamErr) }));
      }
    });

    stream.pipe(res);
    stream.pipe(file);
  } catch (err: unknown) {
    console.error('Stream setup error:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Stream setup failed', details: String(err) }));
    }
  }
  return;
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
    console.error('Heatmap query error:', err);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'Heatmap query failed', details: String(err) }));
  }
  return;
}
