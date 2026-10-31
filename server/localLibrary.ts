/**
 * The offline music library: songs on this laptop, playable with no internet.
 *
 * - Your own files: anything in music/ (drag-and-drop and the folder picker copy files there,
 *   into music/Uploads) plus folders you add by path (scanned where they are, nothing copied).
 *   MP3, WAV, FLAC, M4A, AAC, OGG, Opus and WebM. Title/artist come from the tags, else the
 *   file name ("Artist - Title").
 * - Most played: once a YouTube song has been played SAVE_AFTER_PLAYS times, its cached audio is
 *   converted to MP3 (192 kbps, tagged) into music/Most Played/ "Artist - Title [videoId].mp3",
 *   so it survives the download cache being trimmed. Without ffmpeg the original audio is copied.
 * - Offline sync: in the background, liked songs and most played songs that aren't saved yet are
 *   downloaded (one at a time, from the third-party audio source, never YouTube itself) and saved
 *   the same way. See runOfflineSync.
 *
 * Local songs have URLs "local:<id>", so the app's normal search -> stream -> decode path plays
 * them; a YouTube URL with a saved copy plays that copy (instant, and works offline).
 */
import fs from 'fs';
import path from 'path';
import dns from 'dns';
import crypto from 'crypto';
import { spawn, spawnSync } from 'child_process';
import { IncomingMessage, ServerResponse } from 'http';
import { parseFile } from 'music-metadata';
import { ROOT_DIR, DATA_DIR } from './paths';
import { parseJsonBody } from './http';
import { writeJsonAtomic } from './jsonFile';
import { sendFile } from './sendFile';
import { audioInstances, searchVideos } from './audioSource';
import { downloadToCache } from './audioDownload';
import { PLAY_HISTORY_FILE, BANNED_SONGS_FILE, FAVORITES_FILE } from './library';
import { cachedAudioPath, extractYouTubeVideoId, formatDuration, pruneAudioCache, type SearchResult } from './youtube';
import { EMPTY_TASTE, rankHits } from '../shared/taste';
import { logError } from './logger';
import { guessLanguage } from '../shared/songLanguage';

export const MUSIC_DIR = path.join(ROOT_DIR, 'music');
const UPLOADS_DIR = path.join(MUSIC_DIR, 'Uploads');
const SAVED_DIR = path.join(MUSIC_DIR, 'Most Played');
const INDEX_FILE = path.join(DATA_DIR, 'local_library.json');
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.webm']);
const SAVE_AFTER_PLAYS = 2; // a song played this often is kept as an MP3 (liked songs always are)
const SYNC_EVERY_MS = 30 * 60_000; // look for liked / most played songs to save every 30 minutes
const SYNC_START_DELAY_MS = 20_000; // ...first 20 s after startup, once the library is scanned
const SYNC_GAP_MS = 15_000; // pause between two downloads, to go easy on the public instance
const SYNC_RETRY_MS = 6 * 60 * 60_000; // a song that failed is tried again after 6 hours
const MAX_FILES = 20_000;
const MAX_UPLOAD_BYTES = 300 * 1024 ** 2;
const STALE_MS = 60 * 60 * 1000; // a .part or .lock file this old was left by a crash

interface LocalTrack {
  id: string;
  file: string; // absolute path
  title: string;
  artist: string;
  duration: number; // seconds (0 if unknown)
  size: number;
  mtimeMs: number;
  videoId?: string; // a saved YouTube song
  saved: boolean; // in music/Most Played
}

interface LibraryIndex {
  folders: string[]; // extra folders scanned in place
  tracks: LocalTrack[];
}

let index: LibraryIndex = loadIndex();
let scanning: Promise<void> | null = null;

function loadIndex(): LibraryIndex {
  try {
    const parsed = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
    return { folders: Array.isArray(parsed.folders) ? parsed.folders : [], tracks: Array.isArray(parsed.tracks) ? parsed.tracks : [] };
  } catch {
    return { folders: [], tracks: [] };
  }
}

function saveIndex() {
  try {
    writeJsonAtomic(INDEX_FILE, index, false);
  } catch (err) {
    console.warn('Could not save the local library index:', err);
  }
}

const trackId = (file: string) => crypto.createHash('sha1').update(path.resolve(file).toLowerCase()).digest('hex').slice(0, 16);

/** "Artist - Title [videoId]" or "01 Title" file names when a file has no tags. */
function fromFileName(file: string): { title: string; artist: string; videoId?: string } {
  let base = path.basename(file, path.extname(file));
  const videoId = base.match(/\[([A-Za-z0-9_-]{11})\]\s*$/)?.[1];
  base = base.replace(/\s*\[[A-Za-z0-9_-]{11}\]\s*$/, '').replace(/^\d{1,3}[\s._-]+/, '').trim();
  const dash = base.split(/\s+[-–]\s+/);
  return dash.length >= 2 ? { artist: dash[0].trim(), title: dash.slice(1).join(' - ').trim(), videoId } : { artist: 'Unknown Artist', title: base, videoId };
}

async function walk(dir: string, out: string[]) {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return; // unreadable or gone
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!e.name.startsWith('.')) await walk(full, out);
    } else if (e.isFile() && AUDIO_EXTS.has(path.extname(e.name).toLowerCase())) {
      out.push(full);
    }
  }
}

/** Finds new and changed files; unchanged ones keep their tags from the index (fast rescans). */
export function scanLibrary(): Promise<void> {
  if (scanning) return scanning;
  scanning = (async () => {
    await fs.promises.mkdir(MUSIC_DIR, { recursive: true });
    await cleanStaleFiles();
    const files: string[] = [];
    for (const dir of [MUSIC_DIR, ...index.folders]) await walk(dir, files);
    const known = new Map(index.tracks.map((t) => [t.file, t]));
    const tracks: LocalTrack[] = [];
    for (const file of [...new Set(files)]) {
      const stat = await fs.promises.stat(file).catch(() => null);
      if (!stat) continue;
      const old = known.get(file);
      if (old && old.mtimeMs === stat.mtimeMs && old.size === stat.size) {
        tracks.push(old);
        continue;
      }
      const named = fromFileName(file);
      let title = named.title;
      let artist = named.artist;
      let duration = 0;
      try {
        const meta = await parseFile(file, { duration: true, skipCovers: true });
        title = meta.common.title?.trim() || title;
        artist = meta.common.artist?.trim() || meta.common.albumartist?.trim() || artist;
        duration = meta.format.duration ?? 0;
      } catch {
        // unreadable tags: the file name stands
      }
      tracks.push({
        id: trackId(file),
        file,
        title,
        artist,
        duration: Math.round(duration),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        videoId: named.videoId,
        saved: path.resolve(file).startsWith(path.resolve(SAVED_DIR) + path.sep),
      });
    }
    index = { ...index, tracks };
    saveIndex();
  })().finally(() => {
    scanning = null;
  });
  return scanning;
}

// --- Lookups ---

export const isLocalUrl = (url: string) => url.startsWith('local:');
export const localById = (id: string) => index.tracks.find((t) => t.id === id) ?? null;
const localByVideoId = (videoId: string) => index.tracks.find((t) => t.videoId === videoId && fs.existsSync(t.file)) ?? null;

export function toSearchResult(t: LocalTrack): SearchResult {
  const duration = t.duration || 180;
  return { title: t.title, url: `local:${t.id}`, author: t.artist, duration, thumbnail: '', timestamp: formatDuration(duration) };
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The first artist named ("A, B & C" -> "a"), normalised. */
const leadArtist = (artist: string) => norm(artist.split(/[,&]/)[0] || '');

/** Whether a title already starts with its (first) artist, e.g. "Diljit Dosanjh - Lover". */
const startsWithArtist = (title: string, artist: string) => {
  const lead = leadArtist(artist);
  return lead.length > 0 && norm(title).startsWith(lead);
};

/** The song itself, without a leading artist or "(Official Video)"-style extras: for spotting the same song twice. */
const songTitleKey = (title: string, artist: string) => {
  let t = norm(title.replace(/\s*[([].*?[)\]]/g, ''));
  const lead = leadArtist(artist);
  if (lead && t.startsWith(lead)) t = t.slice(lead.length).trim();
  return t;
};

/** Local songs whose title + artist contain every word of the query. */
export function searchLocal(query: string, limit: number): SearchResult[] {
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  return index.tracks
    .filter((t) => {
      const hay = norm(`${t.title} ${t.artist}`);
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => Number(b.saved) - Number(a.saved))
    .slice(0, limit)
    .map(toSearchResult);
}

/** The saved copy of a YouTube song, if any (served instead of downloading). */
export const savedCopyFor = (youtubeUrl: string) => {
  const id = extractYouTubeVideoId(youtubeUrl);
  return id ? localByVideoId(id) : null;
};

// --- Online check (for offline auto-curation) ---

let onlineCheck: { at: number; online: boolean } | null = null;
export async function isOnline(): Promise<boolean> {
  if (onlineCheck && Date.now() - onlineCheck.at < 30_000) return onlineCheck.online;
  const online = await Promise.race([
    // Online = the audio source's host resolves (songs come from there, not from YouTube)
    dns.promises.lookup(new URL(audioInstances()[0]?.base ?? 'https://example.com').hostname).then(() => true, () => false),
    new Promise<boolean>((r) => setTimeout(() => r(false), 2000)),
  ]);
  onlineCheck = { at: Date.now(), online };
  return online;
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

/**
 * Offline Up Next: songs in the same language as the one on air first, then the most played,
 * mixed so it isn't always the same order; banned songs and the song itself left out.
 */
export function localRecommendations(title: string, artist: string, limit: number): SearchResult[] {
  const banned = readJson<Array<{ url?: string; title?: string }>>(BANNED_SONGS_FILE, []);
  const bannedTitles = new Set(banned.map((b) => norm(b.title || '')).filter(Boolean));
  const plays = new Map<string, number>();
  for (const h of readJson<Array<{ url?: string; title?: string; playCount?: number }>>(PLAY_HISTORY_FILE, [])) {
    const id = h.url ? extractYouTubeVideoId(h.url) : null;
    if (id) plays.set(id, h.playCount || 0);
    if (h.title) plays.set(norm(h.title), h.playCount || 0);
  }
  const language = guessLanguage(title, artist).language;
  const current = norm(title);
  const scored = index.tracks
    .filter((t) => norm(t.title) !== current && !bannedTitles.has(norm(t.title)) && (!t.duration || t.duration <= 300))
    .map((t) => {
      const count = (t.videoId ? plays.get(t.videoId) : undefined) ?? plays.get(norm(t.title)) ?? 0;
      const sameLanguage = guessLanguage(t.title, t.artist).language === language;
      return { t, score: (sameLanguage ? 2 : 0) + Math.min(2, count / 5) + Math.random() * 1.5 };
    })
    .sort((a, b) => b.score - a.score);
  // One pick per song: the history can hold the same song under two YouTube videos
  const seen = new Set<string>();
  return scored
    .filter((s) => {
      const key = songTitleKey(s.t.title, s.t.artist);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map((s) => toSearchResult(s.t));
}

// --- Most played -> MP3 ---

const ffmpegAvailable = (() => {
  try {
    return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
})();
const saveQueue: Array<{ videoId: string; title: string; artist: string }> = [];
let saving = false;

const safeName = (s: string) => s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Unknown';

/** Queues a song for saving if it has been played often enough and isn't saved yet. */
export function maybeSaveMostPlayed(song: { url?: string; title?: string; artist?: string }, playCount: number) {
  const videoId = song.url ? extractYouTubeVideoId(song.url) : null;
  if (!videoId || playCount < SAVE_AFTER_PLAYS || localByVideoId(videoId) || saveQueue.some((s) => s.videoId === videoId)) return;
  if (!fs.existsSync(cachedAudioPath(videoId))) {
    wakeOfflineSync(); // not downloaded (or trimmed from the cache): the sync fetches it
    return;
  }
  saveQueue.push({ videoId, title: song.title || 'Unknown Track', artist: song.artist || 'Unknown Artist' });
  void processSaveQueue();
}

async function processSaveQueue() {
  if (saving) return;
  saving = true;
  try {
    while (saveQueue.length) {
      const { videoId, title, artist } = saveQueue.shift()!;
      const source = cachedAudioPath(videoId);
      if (!fs.existsSync(source) || localByVideoId(videoId)) continue; // not downloaded yet: saved after a later play
      await fs.promises.mkdir(SAVED_DIR, { recursive: true });
      if ((await fs.promises.readdir(SAVED_DIR)).some((n) => n.includes(`[${videoId}]`))) continue; // saved by another server
      const lock = path.join(SAVED_DIR, `.${videoId}.lock`);
      let lockFd: number;
      try {
        lockFd = fs.openSync(lock, 'wx'); // fails if another server is saving this song right now
      } catch {
        continue;
      }
      // YouTube titles often name the artist already ("Diljit Dosanjh - Lover"): don't repeat it
      const name = startsWithArtist(title, artist) || title.includes(' - ') ? safeName(title) : `${safeName(artist)} - ${safeName(title)}`;
      const base = path.join(SAVED_DIR, `${name} [${videoId}]`);
      let target = `${base}.mp3`;
      const ok = ffmpegAvailable ? await toMp3(source, target, title, artist) : false;
      if (!ok) {
        // No ffmpeg (or it failed): keep the original audio, which the browser plays just as well
        target = `${base}${sniffExtension(source)}`;
        await fs.promises.copyFile(source, target).catch(() => {});
      }
      fs.closeSync(lockFd);
      await fs.promises.unlink(lock).catch(() => {});
      if (fs.existsSync(target)) {
        console.log(`[library] Saved for offline: ${path.basename(target)}`);
        await scanLibrary();
      }
    }
  } finally {
    saving = false;
  }
}

function toMp3(source: string, target: string, title: string, artist: string): Promise<boolean> {
  // No audio extension, so a crash can't leave a half MP3 that the scanner picks up
  const part = `${target}.part`;
  return new Promise((resolve) => {
    const proc = spawn(
      'ffmpeg',
      ['-v', 'error', '-y', '-i', source, '-vn', '-codec:a', 'libmp3lame', '-b:a', '192k', '-id3v2_version', '3', '-metadata', `title=${title}`, '-metadata', `artist=${artist}`, '-f', 'mp3', part],
      { stdio: 'ignore' }
    );
    proc.on('error', () => resolve(false));
    proc.on('close', async (code) => {
      if (code === 0) {
        await fs.promises.rename(part, target).catch(() => {});
        resolve(fs.existsSync(target));
      } else {
        await fs.promises.unlink(part).catch(() => {});
        resolve(false);
      }
    });
  });
}

/** YouTube audio arrives as MP4/M4A or WebM; name the copy so other players recognise it. */
function sniffExtension(file: string): string {
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(12);
    fs.readSync(fd, head, 0, 12, 0);
    fs.closeSync(fd);
    if (head.toString('latin1', 4, 8) === 'ftyp') return '.m4a';
    if (head.readUInt32BE(0) === 0x1a45dfa3) return '.webm';
  } catch {}
  return '.m4a';
}

/** On startup: save songs already played often enough (from the history), then keep up. */
export function backfillMostPlayed() {
  for (const h of readJson<Array<{ url?: string; title?: string; artist?: string; playCount?: number }>>(PLAY_HISTORY_FILE, [])) {
    maybeSaveMostPlayed(h, h.playCount || 0);
  }
  setTimeout(() => void runOfflineSync(), SYNC_START_DELAY_MS).unref?.();
  setInterval(() => void runOfflineSync(), SYNC_EVERY_MS).unref?.();
}

// --- Offline sync: liked and most played songs saved in the background ---

type SyncSong = { url?: string; title?: string; artist?: string; playCount?: number };
const syncFailedAt = new Map<string, number>(); // song key -> when it last failed
const syncVideoIds = new Map<string, string>(); // song key -> video id found by search (liked songs saved without a link)
let syncing = false;
let syncAgain = false;
const syncState = { current: '', lastRunAt: 0 };

/** Runs the sync soon (after a like, or a song reaching SAVE_AFTER_PLAYS without a cached copy). */
export function wakeOfflineSync() {
  if (syncing) syncAgain = true;
  else setTimeout(() => void runOfflineSync(), 2_000).unref?.();
}

const songKey = (s: SyncSong) => (s.url && extractYouTubeVideoId(s.url)) || `${s.artist ?? ''} - ${s.title ?? ''}`.toLowerCase();

/** Liked songs first, then most played (by plays), without banned songs or duplicates. */
function songsToKeep(): SyncSong[] {
  const banned = readJson<SyncSong[]>(BANNED_SONGS_FILE, []);
  const bannedKeys = new Set(banned.map(songKey));
  const liked = readJson<SyncSong[]>(FAVORITES_FILE, []);
  const played = readJson<SyncSong[]>(PLAY_HISTORY_FILE, [])
    .filter((h) => (h.playCount || 0) >= SAVE_AFTER_PLAYS)
    .sort((a, b) => (b.playCount || 0) - (a.playCount || 0));
  const seen = new Set<string>();
  return [...liked, ...played].filter((s) => {
    if (!s.title || /^https?:\/\//i.test(s.title)) return false; // a failed lookup saved its link as the title
    const key = songKey(s);
    if (seen.has(key) || bannedKeys.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The song's video id: from its link, or (a liked song saved without one) the best search hit. */
async function videoIdFor(song: SyncSong): Promise<string | null> {
  const fromUrl = song.url ? extractYouTubeVideoId(song.url) : null;
  if (fromUrl) return fromUrl;
  const known = syncVideoIds.get(songKey(song));
  if (known) return known;
  const query = `${song.artist && !/^unknown/i.test(song.artist) ? song.artist + ' ' : ''}${song.title}`;
  const best = rankHits((await searchVideos(query)).filter((h) => h.lengthSeconds <= 600), EMPTY_TASTE, query, 1)[0];
  if (best) syncVideoIds.set(songKey(song), best.videoId);
  return best?.videoId ?? null;
}

/** How far the sync has got, for the Local Music panel. */
function syncSummary() {
  const songs = songsToKeep();
  const saved = songs.filter((s) => {
    const id = (s.url && extractYouTubeVideoId(s.url)) || syncVideoIds.get(songKey(s));
    return id && localByVideoId(id);
  }).length;
  const failed = [...syncFailedAt.values()].filter((t) => t > Date.now() - SYNC_RETRY_MS).length;
  return { wanted: songs.length, saved, failed, current: syncState.current, running: syncing };
}

/**
 * Goes through the liked and most played songs and saves each one that isn't in the offline
 * library yet: from the download cache if it's there, otherwise downloaded first through the
 * third-party audio source. One song at a time, SYNC_GAP_MS apart; stops while offline.
 */
export async function runOfflineSync(): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    do {
      syncAgain = false;
      const songs = songsToKeep();
      syncState.lastRunAt = Date.now();
      for (const song of songs) {
        const key = songKey(song);
        if ((syncFailedAt.get(key) ?? 0) > Date.now() - SYNC_RETRY_MS) continue;
        if (!(await isOnline())) break;
        let videoId: string | null = null;
        try {
          videoId = await videoIdFor(song);
          if (!videoId) throw new Error('not found by search');
          if (localByVideoId(videoId)) continue;
          if (saveQueue.some((s) => s.videoId === videoId)) continue;
          const cacheFile = cachedAudioPath(videoId);
          if (!fs.existsSync(cacheFile)) {
            syncState.current = song.title || videoId;
            await downloadToCache(videoId, cacheFile, () => void pruneAudioCache());
            await new Promise((r) => setTimeout(r, SYNC_GAP_MS));
          }
          saveQueue.push({ videoId, title: song.title || 'Unknown Track', artist: song.artist || 'Unknown Artist' });
          await processSaveQueue();
        } catch (err) {
          syncFailedAt.set(key, Date.now());
          logError('offline-sync', `${song.artist ?? ''} - ${song.title ?? ''} (${videoId ?? 'no id'}): ${(err as Error)?.message ?? err}`);
        } finally {
          syncState.current = '';
        }
      }
    } while (syncAgain);
  } finally {
    syncing = false;
  }
}

// --- Serving and routes ---

const CONTENT_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.webm': 'audio/webm',
};

/** Sends a local file (the browser decodes it like any downloaded song). */
export function serveLocalFile(req: IncomingMessage, res: ServerResponse, track: LocalTrack) {
  const type = CONTENT_TYPES[path.extname(track.file).toLowerCase()] ?? 'application/octet-stream';
  return sendFile(req, res, track.file, type, { 'X-Audio-Cache': 'local' });
}

/** Removes .part and .lock files a crash left behind in the folders this app writes to. */
async function cleanStaleFiles() {
  for (const dir of [UPLOADS_DIR, SAVED_DIR]) {
    const names = await fs.promises.readdir(dir).catch(() => [] as string[]);
    for (const n of names.filter((n) => n.endsWith('.part') || n.endsWith('.lock'))) {
      const full = path.join(dir, n);
      const s = await fs.promises.stat(full).catch(() => null);
      if (s && Date.now() - s.mtimeMs > STALE_MS) await fs.promises.unlink(full).catch(() => {});
    }
  }
}

/** A file name not taken yet: "Song.mp3", else "Song (2).mp3", "Song (3).mp3", ... */
async function freeName(dir: string, base: string, ext: string): Promise<string> {
  for (let i = 1; ; i++) {
    const candidate = path.join(dir, i === 1 ? `${base}${ext}` : `${base} (${i})${ext}`);
    if (!(await fs.promises.stat(candidate).catch(() => null))) return candidate;
  }
}

/** GET /api/local/library, POST /api/local/rescan, POST|DELETE /api/local/folders, POST /api/local/upload */
export async function handleLocalLibrary(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  res.setHeader('Content-Type', 'application/json');
  const summary = async () => ({
    count: index.tracks.length,
    savedCount: index.tracks.filter((t) => t.saved).length,
    folders: [MUSIC_DIR, ...index.folders],
    musicDir: MUSIC_DIR,
    scanning: scanning !== null,
    savingCount: saveQueue.length + (saving ? 1 : 0),
    ffmpeg: ffmpegAvailable,
    online: await isOnline(),
    saveAfterPlays: SAVE_AFTER_PLAYS,
    sync: syncSummary(),
  });

  if (url.pathname === '/api/local/library' && req.method === 'GET') {
    res.end(JSON.stringify(await summary()));
    return true;
  }
  if (url.pathname === '/api/local/rescan' && req.method === 'POST') {
    await scanLibrary();
    res.end(JSON.stringify(await summary()));
    return true;
  }
  if (url.pathname === '/api/local/folders' && (req.method === 'POST' || req.method === 'DELETE')) {
    const body = await parseJsonBody(req);
    const given = typeof body?.path === 'string' ? body.path.trim().replace(/^"|"$/g, '') : '';
    // An empty path would resolve to the app's own folder: never scan that by accident
    const folder = given ? path.resolve(given) : '';
    if (req.method === 'POST') {
      const stat = folder ? await fs.promises.stat(folder).catch(() => null) : null;
      if (!stat?.isDirectory()) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: `Not a folder on this laptop: ${body?.path ?? ''}` }));
        return true;
      }
      if (!index.folders.includes(folder) && path.resolve(folder) !== path.resolve(MUSIC_DIR)) index.folders.push(folder);
    } else {
      index.folders = index.folders.filter((f) => f !== folder);
    }
    saveIndex();
    await scanLibrary();
    res.end(JSON.stringify(await summary()));
    return true;
  }
  if (url.pathname === '/api/local/upload' && req.method === 'POST') {
    // One file per request, raw bytes in the body; the name comes from ?name= (kept, made safe)
    const name = path.basename(url.searchParams.get('name') || '');
    const ext = path.extname(name).toLowerCase();
    if (!name || !AUDIO_EXTS.has(ext)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: `Not an audio file this app can play: ${name}` }));
      return true;
    }
    await fs.promises.mkdir(UPLOADS_DIR, { recursive: true });
    // Unique per upload, so two uploads at once never share a temp file
    const part = path.join(UPLOADS_DIR, `.upload-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.part`);
    let bytes = 0;
    const ok = await new Promise<boolean>((resolve) => {
      const out = fs.createWriteStream(part);
      req.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_UPLOAD_BYTES) {
          req.destroy();
          out.destroy();
          resolve(false);
        }
      });
      req.pipe(out);
      out.on('finish', () => resolve(true));
      out.on('error', () => resolve(false));
    });
    if (!ok) {
      await fs.promises.unlink(part).catch(() => {});
      res.statusCode = 400;
      res.end(JSON.stringify({ error: `Upload failed or too large (max ${MAX_UPLOAD_BYTES / 1024 ** 2} MB): ${name}` }));
      return true;
    }
    // Named after the upload finishes, so a song already there with that name is never overwritten
    const target = await freeName(UPLOADS_DIR, safeName(path.basename(name, ext)), ext);
    await fs.promises.rename(part, target);
    await scanLibrary();
    res.end(JSON.stringify({ added: path.basename(target), ...(await summary()) }));
    return true;
  }
  return false;
}
