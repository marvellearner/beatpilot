/** The personal song library on disk: play history, favourites, banned songs and my_songs.txt. */
import fs from 'fs';
import path from 'path';
import { IncomingMessage, ServerResponse } from 'http';
import { DATA_DIR, ROOT_DIR } from './paths';
import { parseJsonBody } from './http';
import { readJsonArray, writeJsonAtomic } from './jsonFile';
import { maybeSaveMostPlayed } from './localLibrary';
import { logError } from './logger';

export const MY_SONGS_FILE = path.join(ROOT_DIR, 'my_songs.txt');
export const PLAY_HISTORY_FILE = path.join(DATA_DIR, 'play_history.json');
export const FAVORITES_FILE = path.join(DATA_DIR, 'favorites.json');
export const BANNED_SONGS_FILE = path.join(DATA_DIR, 'banned_songs.json');

/** A song as the app sends it in a request body. */
interface SongInput {
  id?: string;
  title?: string;
  artist?: string;
  url?: string;
  thumbnail?: string;
  duration?: number;
  bpm?: number;
  highlightTime?: number;
}

export interface HistoryEntry {
  id: string;
  title?: string;
  artist: string;
  playCount: number;
  lastPlayed: number;
  url?: string;
  thumbnail?: string;
  duration?: number;
  highlightTime?: number;
}

interface FavoriteEntry {
  id: string;
  title: string;
  artist: string;
  url?: string;
  thumbnail?: string;
  duration?: number;
  bpm?: number;
  highlightTime?: number;
  addedAt: number;
}

interface BannedEntry {
  id: string;
  title: string;
  artist: string;
  url?: string;
  thumbnail?: string;
  duration?: number;
  bannedAt: number;
}

const norm = (s?: string) => (s || '').trim().toLowerCase();
const knownArtist = (s?: string) => {
  const a = norm(s);
  return a && a !== 'unknown artist' ? a : '';
};

/**
 * Where `song` already is in a list: same id, same URL, or the same title by the same artist
 * (a re-upload of a song). A title alone isn't enough: different songs share titles.
 */
export function findSong(list: Array<{ id?: string; url?: string; title?: string; artist?: string }>, song: SongInput): number {
  const title = norm(song.title);
  const artist = knownArtist(song.artist);
  return list.findIndex((e) => {
    if (song.id && e.id === song.id) return true;
    if (song.url && e.url && e.url === song.url) return true;
    if (!title || norm(e.title) !== title) return false;
    const other = knownArtist(e.artist);
    // Same title with an unknown artist on either side: only a match when neither has a URL to tell them apart
    return artist && other ? artist === other : !(song.url && e.url);
  });
}

const newId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
const byPlays = (a: HistoryEntry, b: HistoryEntry) => (b.playCount || 0) - (a.playCount || 0) || (b.lastPlayed || 0) - (a.lastPlayed || 0);

// 5. Most Played Song History (GET /api/history & POST /api/history)
export async function handleHistory(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET') {
    try {
      const history = readJsonArray<HistoryEntry>(PLAY_HISTORY_FILE).sort(byPlays);
      res.end(JSON.stringify({ history }));
    } catch (err) {
      console.error('Error reading play history:', err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Failed to read history', history: [] }));
    }
    return true;
  }

  if (req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const song: SongInput | undefined = body?.song;
      if (!song || (!song.id && !song.title)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Invalid song object' }));
        return true;
      }

      const history = readJsonArray<HistoryEntry>(PLAY_HISTORY_FILE);
      const existingIdx = findSong(history, song);
      const now = Date.now();
      let entry: HistoryEntry;
      if (existingIdx !== -1) {
        entry = history[existingIdx];
        entry.playCount = (entry.playCount || 0) + 1;
        entry.lastPlayed = now;
        if (song.highlightTime !== undefined) entry.highlightTime = song.highlightTime;
        if (song.thumbnail) entry.thumbnail = song.thumbnail;
        if (song.url && !entry.url) entry.url = song.url;
      } else {
        entry = {
          id: song.id || newId('hist'),
          title: song.title,
          artist: song.artist || 'Unknown Artist',
          playCount: 1,
          lastPlayed: now,
          url: song.url,
          thumbnail: song.thumbnail,
          duration: song.duration,
          highlightTime: song.highlightTime,
        };
        history.push(entry);
      }
      history.sort(byPlays);

      // Persist locally to play_history.json
      writeJsonAtomic(PLAY_HISTORY_FILE, history);
      // Played often enough: keep an MP3 for offline (in the background)
      maybeSaveMostPlayed(entry, entry.playCount || 0);
      res.end(JSON.stringify({ success: true, history }));
    } catch (err) {
      logError('history_save', err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Failed to update history' }));
    }
    return true;
  }
  return false;
}

// 6. User Favorites (GET /api/favorites & POST /api/favorites/toggle)
export async function handleFavorites(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  return handleToggleList<FavoriteEntry>(req, res, {
    file: FAVORITES_FILE,
    listKey: 'favorites',
    flagKey: 'isFavorite',
    label: 'favorites',
    sortKey: 'addedAt',
    create: (song) => ({
      id: song.id || newId('fav'),
      title: (song.title || 'Unknown Track').trim(),
      artist: (song.artist || 'Unknown Artist').trim(),
      url: song.url,
      thumbnail: song.thumbnail,
      duration: song.duration ? Math.round(song.duration) : undefined,
      bpm: song.bpm ? Math.round(song.bpm) : undefined,
      highlightTime: song.highlightTime,
      addedAt: Date.now(),
    }),
  });
}

// 6b. Banned Songs / "Don't Play Again Ever" (GET /api/banned & POST /api/banned/toggle)
export async function handleBanned(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  return handleToggleList<BannedEntry>(req, res, {
    file: BANNED_SONGS_FILE,
    listKey: 'banned',
    flagKey: 'isBanned',
    label: 'banned songs',
    sortKey: 'bannedAt',
    create: (song) => ({
      id: song.id || newId('banned'),
      title: (song.title || 'Unknown Track').trim(),
      artist: (song.artist || 'Unknown Artist').trim(),
      url: song.url,
      thumbnail: song.thumbnail,
      duration: song.duration ? Math.round(song.duration) : undefined,
      bannedAt: Date.now(),
    }),
  });
}

/** Favourites and banned songs: a list read with GET and toggled (added or removed) with POST, newest first. */
async function handleToggleList<T extends { id: string; title: string; artist: string; url?: string }>(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { file: string; listKey: string; flagKey: string; label: string; sortKey: keyof T; create: (song: SongInput) => T }
): Promise<boolean> {
  res.setHeader('Content-Type', 'application/json');
  const newestFirst = (a: T, b: T) => (Number(b[opts.sortKey]) || 0) - (Number(a[opts.sortKey]) || 0);

  if (req.method === 'GET') {
    try {
      res.end(JSON.stringify({ [opts.listKey]: readJsonArray<T>(opts.file).sort(newestFirst) }));
    } catch (err) {
      console.error(`Error reading ${opts.label}:`, err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: `Failed to read ${opts.label}`, [opts.listKey]: [] }));
    }
    return true;
  }

  if (req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const song: SongInput | undefined = body?.song;
      if (!song || (!song.id && !song.title && !song.url)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Invalid song object' }));
        return true;
      }

      const list = readJsonArray<T>(opts.file);
      const existingIdx = findSong(list, song);
      const added = existingIdx === -1;
      // Already there: toggle off (remove). Otherwise add it, newest first
      if (added) list.unshift(opts.create(song));
      else list.splice(existingIdx, 1);

      writeJsonAtomic(opts.file, list);
      res.end(JSON.stringify({ success: true, [opts.flagKey]: added, [opts.listKey]: list }));
    } catch (err) {
      console.error(`Error updating ${opts.label}:`, err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: `Failed to update ${opts.label}` }));
    }
    return true;
  }
  return false;
}

// 6. User Custom Song List (GET /api/my-songs & POST /api/my-songs)
export async function handleMySongs(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET') {
    try {
      if (!fs.existsSync(MY_SONGS_FILE)) {
        const starterContent = `# ==============================================================================
# AI DJ — MY CUSTOM SONG LIST & PARTY PLAYLIST
# ==============================================================================
# Add any song you want the AI DJ to know about and play!
#
# FORMAT:
# - Write one song per line.
# - You can write Song Names (e.g., "Sidhu Moose Wala - 295")
# - Or paste YouTube / YouTube Music links (e.g., "https://www.youtube.com/watch?v=kJQP7kiw5Fk")
# - Lines starting with '#' are comments and ignored.
# ==============================================================================

Sidhu Moose Wala - 295
Diljit Dosanjh - Lover
AP Dhillon - Brown Munde
Karan Aujla - Softly
Badshah - Kar Gayi Chull
`;
        fs.writeFileSync(MY_SONGS_FILE, starterContent, 'utf-8');
      }

      const raw = fs.readFileSync(MY_SONGS_FILE, 'utf-8');
      const songs = parseSongLines(raw);
      res.end(JSON.stringify({ songs, raw, total: songs.length }));
    } catch (err) {
      console.error('Error reading my_songs.txt:', err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Failed to read my_songs.txt', songs: [] }));
    }
    return true;
  }

  if (req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      if (typeof body?.content === 'string') {
        // Overwrite full file (atomically: a cut-off write must not lose the list)
        const tmp = `${MY_SONGS_FILE}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, body.content, 'utf-8');
        fs.renameSync(tmp, MY_SONGS_FILE);
      } else if (body?.song) {
        // Append single song line
        const songLine = `\n${String(body.song).trim()}\n`;
        fs.appendFileSync(MY_SONGS_FILE, songLine, 'utf-8');
      }

      const songs = parseSongLines(fs.readFileSync(MY_SONGS_FILE, 'utf-8'));
      res.end(JSON.stringify({ success: true, songs, total: songs.length }));
    } catch (err) {
      logError('my_songs_modify', err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Failed to update my_songs.txt' }));
    }
    return true;
  }
  return false;
}

/** One song per line; blank lines and '#' or '//' comments ignored. */
function parseSongLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('//'));
}
