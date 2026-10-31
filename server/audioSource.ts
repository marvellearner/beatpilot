/**
 * Where song audio comes from: third-party YouTube front-ends (Invidious, Piped) that fetch from
 * YouTube on their own servers and hand the audio out through their own proxy. This laptop never
 * contacts YouTube's media servers itself, so YouTube has no reason to block its IP.
 *
 * Instances are tried in order; one that fails is skipped for a while. Configure them in .env:
 *   AUDIO_SOURCES=invidious:https://yt.example.com,piped:https://pipedapi.example.com
 * Public instances come and go; a self-hosted one is the most reliable.
 */
import fs from 'fs';
import path from 'path';
import { ROOT_DIR } from './paths';

type Kind = 'invidious' | 'piped';
interface Instance {
  kind: Kind;
  base: string; // https://host, no trailing slash
}

export interface AudioInfo {
  url: string; // the audio, on the instance's proxy
  mime: string; // e.g. audio/mp4
  title: string;
  author: string;
  lengthSeconds: number;
  thumbnail: string;
  source: string; // which instance answered
}

// Checked on 2026-10-30: the only public instances that served proxied audio
const DEFAULT_SOURCES = 'invidious:https://yt.chocolatemoo53.com,piped:https://api.piped.private.coffee';
const FAILED_SKIP_MS = 5 * 60_000; // a failing instance is skipped for 5 minutes
const INFO_TTL_MS = 30 * 60_000; // audio links expire after a few hours; re-resolve well before
const REQUEST_TIMEOUT_MS = 12_000;
const RESOLVE_ROUNDS = 3;

/** YouTube's own hosts: an answer pointing there would mean downloading from YouTube directly. */
const isYouTubeHost = (host: string) => /(^|\.)(googlevideo\.com|youtube\.com|youtu\.be|ytimg\.com|google\.com)$/i.test(host);

function readSourcesSetting(): string {
  let value = (process.env.AUDIO_SOURCES || '').trim();
  try {
    const env = fs.readFileSync(path.join(ROOT_DIR, '.env'), 'utf-8');
    const m = env.match(/^\s*AUDIO_SOURCES\s*=\s*([^\r\n#]+)/m);
    if (m) value = m[1].trim().replace(/^['"]|['"]$/g, '');
  } catch {
    // no .env
  }
  return value || DEFAULT_SOURCES;
}

export function audioInstances(): Instance[] {
  return readSourcesSetting()
    .split(',')
    .map((s) => s.trim())
    .map((s) => s.match(/^(invidious|piped):(https?:\/\/.+?)\/?$/i))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ kind: m[1].toLowerCase() as Kind, base: m[2] }));
}

const failedAt = new Map<string, number>();
const infoCache = new Map<string, { info: AudioInfo; at: number }>();
const inFlight = new Map<string, Promise<AudioInfo>>();

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** The audio format to use: AAC in MP4 first (every browser decodes it), then the highest bitrate. */
function pickAudio<T>(formats: T[], mime: (f: T) => string, bitrate: (f: T) => number): T | undefined {
  return [...formats].sort((a, b) => {
    const mp4 = Number(mime(b).includes('mp4')) - Number(mime(a).includes('mp4'));
    return mp4 || bitrate(b) - bitrate(a);
  })[0];
}

async function fromInvidious(inst: Instance, videoId: string): Promise<AudioInfo> {
  const j = await getJson(`${inst.base}/api/v1/videos/${videoId}?local=true&fields=title,author,lengthSeconds,videoThumbnails,adaptiveFormats`);
  const audio = (j.adaptiveFormats || []).filter((f: { type?: string }) => f.type?.startsWith('audio/'));
  const best = pickAudio<{ type: string; bitrate: string | number; url: string }>(audio, (f) => f.type, (f) => Number(f.bitrate) || 0);
  if (!best) throw new Error('no audio formats');
  const thumbs: Array<{ url: string; quality?: string }> = j.videoThumbnails || [];
  const thumb = thumbs.find((t) => t.quality === 'medium') ?? thumbs[0];
  return {
    url: new URL(best.url, inst.base).href, // local=true links can be relative to the instance
    mime: best.type.split(';')[0],
    title: j.title,
    author: j.author,
    lengthSeconds: Number(j.lengthSeconds) || 0,
    thumbnail: thumb ? new URL(thumb.url, inst.base).href : '',
    source: inst.base,
  };
}

async function fromPiped(inst: Instance, videoId: string): Promise<AudioInfo> {
  const j = await getJson(`${inst.base}/streams/${videoId}`);
  const best = pickAudio<{ mimeType: string; bitrate: number; url: string }>(j.audioStreams || [], (f) => f.mimeType, (f) => f.bitrate || 0);
  if (!best) throw new Error('no audio streams');
  return {
    url: best.url,
    mime: best.mimeType.split(';')[0],
    title: j.title,
    author: j.uploader,
    lengthSeconds: Number(j.duration) || 0,
    thumbnail: j.thumbnailUrl || '',
    source: inst.base,
  };
}

/**
 * The song's audio link and details from the first third-party instance that answers.
 * Throws when none does: the caller then has no audio (it never falls back to YouTube).
 */
export function resolveAudio(videoId: string): Promise<AudioInfo> {
  const cached = infoCache.get(videoId);
  if (cached && Date.now() - cached.at < INFO_TTL_MS) return Promise.resolve(cached.info);
  const pending = inFlight.get(videoId);
  if (pending) return pending;

  const job = (async () => {
    const instances = audioInstances();
    if (!instances.length) throw new Error('No audio sources set up (AUDIO_SOURCES in .env)');
    // Healthy instances first; recently failed ones only as a last resort
    const now = Date.now();
    const ordered = [
      ...instances.filter((i) => now - (failedAt.get(i.base) ?? 0) > FAILED_SKIP_MS),
      ...instances.filter((i) => now - (failedAt.get(i.base) ?? 0) <= FAILED_SKIP_MS),
    ];
    const errors: string[] = [];
    // Public instances often fail for a moment (HTTP 500 under load): go round them a few times
    for (let round = 0; round < RESOLVE_ROUNDS; round++) {
      if (round) await new Promise((r) => setTimeout(r, 1000 * round));
      for (const inst of ordered) {
        try {
          const info = inst.kind === 'invidious' ? await fromInvidious(inst, videoId) : await fromPiped(inst, videoId);
          if (isYouTubeHost(new URL(info.url).host)) throw new Error('answered with a direct YouTube link');
          failedAt.delete(inst.base);
          infoCache.set(videoId, { info, at: Date.now() });
          if (infoCache.size > 500) infoCache.delete(infoCache.keys().next().value!);
          return info;
        } catch (err) {
          failedAt.set(inst.base, Date.now());
          errors.push(`${new URL(inst.base).host}: ${(err as Error).message}`);
        }
      }
    }
    throw new Error(`No audio source could provide this song (${[...new Set(errors)].join('; ')})`);
  })().finally(() => inFlight.delete(videoId));
  inFlight.set(videoId, job);
  return job;
}

export interface VideoHit {
  videoId: string;
  title: string;
  author: string;
  lengthSeconds: number;
  thumbnail: string;
  viewCount?: number;
  publishedAt?: number; // ms timestamp of the upload
}

async function searchInvidious(inst: Instance, query: string): Promise<VideoHit[]> {
  const j = await getJson(`${inst.base}/api/v1/search?q=${encodeURIComponent(query)}&type=video&fields=title,videoId,author,lengthSeconds,videoThumbnails,viewCount,published`);
  if (!Array.isArray(j)) throw new Error('unexpected search answer');
  type Hit = { videoId: string; title: string; author: string; lengthSeconds: number; viewCount?: number; published?: number; videoThumbnails?: Array<{ url: string; quality?: string }> };
  return j.map((v: Hit) => {
    const thumb = v.videoThumbnails?.find((t) => t.quality === 'medium') ?? v.videoThumbnails?.[0];
    return {
      videoId: v.videoId,
      title: v.title,
      author: v.author,
      lengthSeconds: Number(v.lengthSeconds) || 0,
      thumbnail: thumb ? new URL(thumb.url, inst.base).href : '',
      viewCount: Number(v.viewCount) || undefined,
      publishedAt: v.published ? v.published * 1000 : undefined, // Invidious gives seconds
    };
  });
}

async function searchPiped(inst: Instance, query: string): Promise<VideoHit[]> {
  const j = await getJson(`${inst.base}/search?q=${encodeURIComponent(query)}&filter=videos`);
  return (j.items || [])
    .filter((v: { url?: string }) => v.url?.startsWith('/watch?v='))
    .map((v: { url: string; title: string; uploaderName: string; duration: number; thumbnail: string; views?: number; uploaded?: number }) => ({
      videoId: v.url.slice('/watch?v='.length, '/watch?v='.length + 11),
      title: v.title,
      author: v.uploaderName,
      lengthSeconds: Number(v.duration) || 0,
      thumbnail: v.thumbnail || '',
      viewCount: Number(v.views) > 0 ? Number(v.views) : undefined,
      publishedAt: Number(v.uploaded) > 0 ? Number(v.uploaded) : undefined, // Piped gives ms
    }));
}

/** Video search through the third-party instances (the laptop never loads YouTube's search pages). */
export async function searchVideos(query: string): Promise<VideoHit[]> {
  const now = Date.now();
  const instances = audioInstances();
  const ordered = [
    ...instances.filter((i) => now - (failedAt.get(i.base) ?? 0) > FAILED_SKIP_MS),
    ...instances.filter((i) => now - (failedAt.get(i.base) ?? 0) <= FAILED_SKIP_MS),
  ];
  const errors: string[] = [];
  for (const inst of ordered) {
    try {
      const hits = inst.kind === 'invidious' ? await searchInvidious(inst, query) : await searchPiped(inst, query);
      // Live streams and premieres have no length and can't be mixed
      return hits.filter((h) => /^[A-Za-z0-9_-]{11}$/.test(h.videoId) && h.lengthSeconds > 0);
    } catch (err) {
      failedAt.set(inst.base, Date.now());
      errors.push(`${new URL(inst.base).host}: ${(err as Error).message}`);
    }
  }
  throw new Error(`Search is unavailable (${errors.join('; ') || 'no sources set up'})`);
}

/** "45M views", "1.2B views", "123,456 views" -> a number. */
function parseViews(text?: string): number | undefined {
  const m = text?.replace(/,/g, '').match(/([\d.]+)\s*([KMB])?/i);
  if (!m) return undefined;
  const scale = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase() as 'K' | 'M' | 'B'] ?? 1;
  return Math.round(Number(m[1]) * scale) || undefined;
}

async function relatedInvidious(inst: Instance, videoId: string): Promise<VideoHit[]> {
  const j = await getJson(`${inst.base}/api/v1/videos/${videoId}?fields=recommendedVideos`);
  type Rec = { videoId: string; title: string; author: string; lengthSeconds: number; viewCountText?: string; published?: number; videoThumbnails?: Array<{ url: string; quality?: string }> };
  return (j.recommendedVideos || []).map((v: Rec) => {
    const thumb = v.videoThumbnails?.find((t) => t.quality === 'medium') ?? v.videoThumbnails?.[0];
    return {
      videoId: v.videoId,
      title: v.title,
      author: v.author,
      lengthSeconds: Number(v.lengthSeconds) || 0,
      thumbnail: thumb ? new URL(thumb.url, inst.base).href : '',
      viewCount: parseViews(v.viewCountText),
      publishedAt: v.published ? v.published * 1000 : undefined,
    };
  });
}

async function relatedPiped(inst: Instance, videoId: string): Promise<VideoHit[]> {
  const j = await getJson(`${inst.base}/streams/${videoId}`);
  type Rel = { url?: string; title: string; uploaderName: string; duration: number; thumbnail: string; views?: number; uploaded?: number };
  return (j.relatedStreams || [])
    .filter((v: Rel) => v.url?.startsWith('/watch?v='))
    .map((v: Rel) => ({
      videoId: v.url!.slice('/watch?v='.length, '/watch?v='.length + 11),
      title: v.title,
      author: v.uploaderName,
      lengthSeconds: Number(v.duration) || 0,
      thumbnail: v.thumbnail || '',
      viewCount: Number(v.views) > 0 ? Number(v.views) : undefined,
      publishedAt: Number(v.uploaded) > 0 ? Number(v.uploaded) : undefined,
    }));
}

/**
 * The songs YouTube lists next to this one ("people who played this also played"), through the
 * third-party instances. It's built from what listeners actually play together, which makes it
 * the best signal for "what people with this taste like".
 */
export async function relatedVideos(videoId: string): Promise<VideoHit[]> {
  const now = Date.now();
  const instances = audioInstances();
  const ordered = [
    ...instances.filter((i) => now - (failedAt.get(i.base) ?? 0) > FAILED_SKIP_MS),
    ...instances.filter((i) => now - (failedAt.get(i.base) ?? 0) <= FAILED_SKIP_MS),
  ];
  const errors: string[] = [];
  for (const inst of ordered) {
    try {
      const hits = inst.kind === 'invidious' ? await relatedInvidious(inst, videoId) : await relatedPiped(inst, videoId);
      return hits.filter((h) => /^[A-Za-z0-9_-]{11}$/.test(h.videoId) && h.lengthSeconds > 0);
    } catch (err) {
      errors.push(`${new URL(inst.base).host}: ${(err as Error).message}`);
    }
  }
  throw new Error(`Related songs unavailable (${errors.join('; ') || 'no sources set up'})`);
}

/** Forget a resolved link (e.g. it expired or the instance stopped serving it), so the next try re-resolves. */
export function forgetAudio(videoId: string, source?: string) {
  infoCache.delete(videoId);
  if (source) failedAt.set(source, Date.now());
}
