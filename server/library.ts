/** The personal song library on disk: play history, favourites, banned songs and my_songs.txt. */
import fs from 'fs';
import path from 'path';
import { IncomingMessage, ServerResponse } from 'http';
import { DATA_DIR, ROOT_DIR } from './paths';
import { parseJsonBody } from './http';
import { maybeSaveMostPlayed } from './localLibrary';

export const MY_SONGS_FILE = path.join(ROOT_DIR, 'my_songs.txt');
export const PLAY_HISTORY_FILE = path.join(DATA_DIR, 'play_history.json');
export const FAVORITES_FILE = path.join(DATA_DIR, 'favorites.json');
export const BANNED_SONGS_FILE = path.join(DATA_DIR, 'banned_songs.json');

// 5. Most Played Song History (GET /api/history & POST /api/history)
export async function handleHistory(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET') {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (!fs.existsSync(PLAY_HISTORY_FILE)) {
        fs.writeFileSync(PLAY_HISTORY_FILE, JSON.stringify([], null, 2), 'utf-8');
      }
      const rawData = fs.readFileSync(PLAY_HISTORY_FILE, 'utf-8');
      const history = JSON.parse(rawData || '[]');
      // Sort descending by playCount, then by lastPlayed
      history.sort((a: any, b: any) => (b.playCount || 0) - (a.playCount || 0) || (b.lastPlayed || 0) - (a.lastPlayed || 0));
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
      const song = body?.song;
      if (!song || (!song.id && !song.title)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Invalid song object' }));
        return true;
      }

      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      let history: any[] = [];
      if (fs.existsSync(PLAY_HISTORY_FILE)) {
        try {
          const rawData = fs.readFileSync(PLAY_HISTORY_FILE, 'utf-8');
          history = JSON.parse(rawData || '[]');
        } catch {
          history = [];
        }
      }

      // Find existing match by ID, URL, or normalized Title
      const normTitle = (song.title || '').trim().toLowerCase();
      const existingIdx = history.findIndex(
        (h: any) =>
          (song.id && h.id === song.id) ||
          (song.url && h.url && h.url === song.url) ||
          (normTitle && h.title && h.title.trim().toLowerCase() === normTitle)
      );

      const now = Date.now();
      if (existingIdx !== -1) {
        history[existingIdx].playCount = (history[existingIdx].playCount || 0) + 1;
        history[existingIdx].lastPlayed = now;
        if (song.highlightTime !== undefined) history[existingIdx].highlightTime = song.highlightTime;
        if (song.thumbnail) history[existingIdx].thumbnail = song.thumbnail;
        if (song.url && !history[existingIdx].url) history[existingIdx].url = song.url;
      } else {
        history.push({
          id: song.id || `hist_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          title: song.title,
          artist: song.artist || 'Unknown Artist',
          playCount: 1,
          lastPlayed: now,
          url: song.url,
          thumbnail: song.thumbnail,
          duration: song.duration,
          highlightTime: song.highlightTime,
        });
      }

      // Sort descending by playCount
      history.sort((a: any, b: any) => (b.playCount || 0) - (a.playCount || 0) || (b.lastPlayed || 0) - (a.lastPlayed || 0));

      // Persist locally to play_history.json
      fs.writeFileSync(PLAY_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
      // Played often enough: keep an MP3 for offline (in the background)
      const entry = history.find((h: any) => (song.url && h.url === song.url) || h.id === song.id);
      if (entry) maybeSaveMostPlayed(entry, entry.playCount || 0);
      res.end(JSON.stringify({ success: true, history }));
    } catch (err) {
      console.error('Error saving play history:', err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Failed to update history' }));
    }
    return true;
  }
  return false;
}

// 6. User Favorites (GET /api/favorites & POST /api/favorites/toggle)
export async function handleFavorites(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  res.setHeader('Content-Type', 'application/json');

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(FAVORITES_FILE)) {
    fs.writeFileSync(FAVORITES_FILE, JSON.stringify([], null, 2), 'utf-8');
  }

  if (req.method === 'GET') {
    try {
      const rawData = fs.readFileSync(FAVORITES_FILE, 'utf-8');
      const favorites = JSON.parse(rawData || '[]');
      if (Array.isArray(favorites)) {
        favorites.sort((a: any, b: any) => (b.addedAt || 0) - (a.addedAt || 0));
      }
      res.end(JSON.stringify({ favorites: Array.isArray(favorites) ? favorites : [] }));
    } catch (err) {
      console.error('Error reading favorites:', err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Failed to read favorites', favorites: [] }));
    }
    return true;
  }

  if (req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const song = body?.song;
      if (!song || (!song.id && !song.title && !song.url)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Invalid song object' }));
        return true;
      }

      let favorites: any[] = [];
      try {
        const rawData = fs.readFileSync(FAVORITES_FILE, 'utf-8');
        favorites = JSON.parse(rawData || '[]');
        if (!Array.isArray(favorites)) favorites = [];
      } catch {
        favorites = [];
      }

      const normTitle = (song.title || '').trim().toLowerCase();
      const existingIdx = favorites.findIndex(
        (f: any) =>
          (song.id && f.id === song.id) ||
          (song.url && f.url && f.url === song.url) ||
          (normTitle && f.title && f.title.trim().toLowerCase() === normTitle)
      );

      let isFavorite = false;
      if (existingIdx !== -1) {
        // If it already exists, toggle off (remove)
        favorites.splice(existingIdx, 1);
        isFavorite = false;
      } else {
        // Add to favorites (newest first)
        const newFavorite = {
          id: song.id || `fav_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          title: (song.title || 'Unknown Track').trim(),
          artist: (song.artist || 'Unknown Artist').trim(),
          url: song.url,
          thumbnail: song.thumbnail,
          duration: song.duration ? Math.round(song.duration) : undefined,
          bpm: song.bpm ? Math.round(song.bpm) : undefined,
          highlightTime: song.highlightTime,
          addedAt: Date.now(),
        };
        favorites.unshift(newFavorite);
        isFavorite = true;
      }

      // Persist locally to data/favorites.json
      fs.writeFileSync(FAVORITES_FILE, JSON.stringify(favorites, null, 2), 'utf-8');
      res.end(JSON.stringify({ success: true, isFavorite, favorites }));
    } catch (err) {
      console.error('Error updating favorites:', err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Failed to update favorites' }));
    }
    return true;
  }
  return false;
}

// 6b. Banned Songs / "Don't Play Again Ever" (GET /api/banned & POST /api/banned/toggle)
export async function handleBanned(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  res.setHeader('Content-Type', 'application/json');

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(BANNED_SONGS_FILE)) {
    fs.writeFileSync(BANNED_SONGS_FILE, JSON.stringify([], null, 2), 'utf-8');
  }

  if (req.method === 'GET') {
    try {
      const rawData = fs.readFileSync(BANNED_SONGS_FILE, 'utf-8');
      const banned = JSON.parse(rawData || '[]');
      if (Array.isArray(banned)) {
        banned.sort((a: any, b: any) => (b.bannedAt || 0) - (a.bannedAt || 0));
      }
      res.end(JSON.stringify({ banned: Array.isArray(banned) ? banned : [] }));
    } catch (err) {
      console.error('Error reading banned songs:', err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Failed to read banned songs', banned: [] }));
    }
    return true;
  }

  if (req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const song = body?.song;
      if (!song || (!song.id && !song.title && !song.url)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Invalid song object' }));
        return true;
      }

      let banned: any[] = [];
      try {
        const rawData = fs.readFileSync(BANNED_SONGS_FILE, 'utf-8');
        banned = JSON.parse(rawData || '[]');
        if (!Array.isArray(banned)) banned = [];
      } catch {
        banned = [];
      }

      const normTitle = (song.title || '').trim().toLowerCase();
      const existingIdx = banned.findIndex(
        (b: any) =>
          (song.id && b.id === song.id) ||
          (song.url && b.url && b.url === song.url) ||
          (normTitle && b.title && b.title.trim().toLowerCase() === normTitle)
      );

      let isBanned = false;
      if (existingIdx !== -1) {
        // If already banned, toggle off (unban)
        banned.splice(existingIdx, 1);
        isBanned = false;
      } else {
        // Add to banned songs (newest first)
        const newBanned = {
          id: song.id || `banned_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          title: (song.title || 'Unknown Track').trim(),
          artist: (song.artist || 'Unknown Artist').trim(),
          url: song.url,
          thumbnail: song.thumbnail,
          duration: song.duration ? Math.round(song.duration) : undefined,
          bannedAt: Date.now(),
        };
        banned.unshift(newBanned);
        isBanned = true;
      }

      fs.writeFileSync(BANNED_SONGS_FILE, JSON.stringify(banned, null, 2), 'utf-8');
      res.end(JSON.stringify({ success: true, isBanned, banned }));
    } catch (err) {
      console.error('Error updating banned songs:', err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Failed to update banned songs' }));
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
      const lines = raw.split(/\r?\n/);
      const songs: string[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//')) {
          songs.push(trimmed);
        }
      }

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
      if (body?.content !== undefined) {
        // Overwrite full file
        fs.writeFileSync(MY_SONGS_FILE, body.content, 'utf-8');
      } else if (body?.song) {
        // Append single song line
        const songLine = `\n${String(body.song).trim()}\n`;
        fs.appendFileSync(MY_SONGS_FILE, songLine, 'utf-8');
      }

      const raw = fs.readFileSync(MY_SONGS_FILE, 'utf-8');
      const songs = raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#') && !l.startsWith('//'));

      res.end(JSON.stringify({ success: true, songs, total: songs.length }));
    } catch (err) {
      console.error('Error modifying my_songs.txt:', err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Failed to update my_songs.txt' }));
    }
    return true;
  }
  return false;
}
