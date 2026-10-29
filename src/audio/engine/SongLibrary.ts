/**
 * The personal song library: favourites, "Don't Play Again Ever" (banned) songs, the server's
 * play history (Most Played) and this browser's play log (Previously Played).
 *
 * It owns those lists, their localStorage copies and the sync with the server's /api/favorites,
 * /api/banned and /api/history. What a change means for playback (dropping a banned song from
 * the queue, skipping it on air, removing a played song's other copies from Up Next) stays in
 * AudioEngine.
 */
import type { BannedSong, FavoriteSong, PlayLogEntry, SongHistoryItem, TrackMetadata } from '../../types';
import { areSongsConsecutivelySame, cleanCoreTitle, isSameSong, songKeys } from '../songMatch';

const PLAY_LOG_KEY = 'ai_dj_play_log';
const FAVORITES_KEY = 'ai_dj_favorites';
const DONT_PLAY_AGAIN_KEY = 'ai_dj_dont_play_again';
export const PLAY_LOG_MAX = 100;

type SongInfo = {
  id?: string;
  title?: string;
  artist?: string;
  url?: string;
  thumbnail?: string;
  duration?: number;
  bpm?: number;
  highlightTime?: number;
};

const saveLocal = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable
  }
};

export class SongLibrary {
  public favorites: FavoriteSong[] = [];
  public bannedSongs: BannedSong[] = [];
  public history: SongHistoryItem[] = []; // the server's play counts (Most Played)
  public playLog: PlayLogEntry[] = []; // newest first

  constructor(private onChange: () => void) {}

  // --- Play log (Previously Played) ---

  /** RULE: in Previously Played no two consecutive songs can be the same. */
  public dedupeConsecutivePlayLog(entries: PlayLogEntry[]): PlayLogEntry[] {
    const deduped: PlayLogEntry[] = [];
    for (const entry of entries) {
      if (!entry) continue;
      const last = deduped[deduped.length - 1];
      if (!last || (!areSongsConsecutivelySame(entry, last) && !isSameSong(songKeys(entry), songKeys(last)))) {
        deduped.push(entry);
      }
    }
    return deduped;
  }

  public loadPlayLog() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(PLAY_LOG_KEY) || '[]');
      if (Array.isArray(saved)) {
        this.playLog = this.dedupeConsecutivePlayLog(saved.filter((e) => e && typeof e.playedAt === 'number'));
        this.savePlayLog();
      }
    } catch {
      // Ignore corrupt or unavailable storage
    }
  }

  private savePlayLog() {
    try {
      this.playLog = this.dedupeConsecutivePlayLog(this.playLog);
      window.localStorage.setItem(PLAY_LOG_KEY, JSON.stringify(this.playLog.slice(0, PLAY_LOG_MAX)));
    } catch {
      // Storage unavailable: the log just won't survive a reload
    }
  }

  /** Adds a play to the log; the same song again right after itself just refreshes that entry. */
  public logPlay(track: TrackMetadata) {
    const first = this.playLog[0];
    if (first && (areSongsConsecutivelySame(track, first) || isSameSong(songKeys(track), songKeys(first)))) {
      first.playedAt = Date.now();
      if (!first.thumbnail && track.thumbnail) first.thumbnail = track.thumbnail;
      if (!first.url && track.url) first.url = track.url;
    } else {
      this.playLog = this.dedupeConsecutivePlayLog([
        { id: track.id, title: track.title, artist: track.artist, url: track.url, thumbnail: track.thumbnail, playedAt: Date.now() },
        ...this.playLog,
      ]).slice(0, PLAY_LOG_MAX);
    }
    this.savePlayLog();
  }

  // --- Play history (server, Most Played) ---

  public async fetchHistory(): Promise<SongHistoryItem[]> {
    try {
      const res = await fetch('/api/history');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.history)) {
          this.history = data.history;
          this.onChange();
        }
      }
    } catch (err) {
      console.error('Failed to fetch play history:', err);
    }
    return this.history;
  }

  /** Counts a play on the server and takes its updated history. */
  public async postPlay(track: TrackMetadata) {
    try {
      const res = await fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          song: {
            id: track.id,
            title: track.title,
            artist: track.artist,
            duration: Math.round(track.duration),
            url: track.url,
            thumbnail: track.thumbnail,
            highlightTime: track.highlightTime,
          },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.history)) {
          this.history = data.history;
          this.onChange();
        }
      }
    } catch (err) {
      console.error('Failed to record song play history:', err);
    }
  }

  // --- Favourites ---

  public isFavorite(song?: { id?: string; title?: string; url?: string } | null): boolean {
    if (!song) return false;
    const title = (song.title || '').trim().toLowerCase();
    return this.favorites.some(
      (f) => (song.id && f.id === song.id) || (song.url && f.url && f.url === song.url) || (title && f.title && f.title.trim().toLowerCase() === title)
    );
  }

  public async loadFavorites(): Promise<FavoriteSong[]> {
    try {
      const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) || 'null');
      if (Array.isArray(parsed)) {
        this.favorites = parsed;
        this.onChange();
      }
    } catch {
      // ignore localStorage errors
    }
    return this.fetchFavorites();
  }

  public async fetchFavorites(): Promise<FavoriteSong[]> {
    try {
      const res = await fetch('/api/favorites');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.favorites)) {
          this.favorites = data.favorites;
          saveLocal(FAVORITES_KEY, this.favorites);
          this.onChange();
        }
      }
    } catch (err) {
      console.warn('Failed to fetch favorites from server:', err);
    }
    return this.favorites;
  }

  /** Adds or removes a favourite at once (optimistic), then syncs with the server. */
  public async toggleFavorite(song?: SongInfo | null): Promise<boolean> {
    if (!song || (!song.id && !song.title && !song.url)) return false;
    const already = this.isFavorite(song);
    const title = (song.title || '').trim().toLowerCase();
    if (already) {
      this.favorites = this.favorites.filter(
        (f) => !((song.id && f.id === song.id) || (song.url && f.url && f.url === song.url) || (title && f.title && f.title.trim().toLowerCase() === title))
      );
    } else {
      this.favorites = [
        {
          id: song.id || `fav_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          title: (song.title || 'Unknown Track').trim(),
          artist: (song.artist || 'Unknown Artist').trim(),
          url: song.url,
          thumbnail: song.thumbnail,
          duration: song.duration ? Math.round(song.duration) : undefined,
          bpm: song.bpm ? Math.round(song.bpm) : undefined,
          highlightTime: song.highlightTime,
          addedAt: Date.now(),
        },
        ...this.favorites,
      ];
    }
    saveLocal(FAVORITES_KEY, this.favorites);
    this.onChange();

    try {
      const res = await fetch('/api/favorites/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ song: pick(song, ['id', 'title', 'artist', 'url', 'thumbnail', 'duration', 'bpm', 'highlightTime']) }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.favorites)) {
          this.favorites = data.favorites;
          saveLocal(FAVORITES_KEY, this.favorites);
          this.onChange();
          return Boolean(data.isFavorite);
        }
      }
    } catch (err) {
      console.warn('Failed to sync favorite toggle with backend:', err);
    }
    return !already;
  }

  // --- Don't Play Again Ever (banned) ---

  public isBanned(song?: { id?: string; title?: string; artist?: string; url?: string } | null): boolean {
    if (!song) return false;
    const url = song.url ? song.url.trim().toLowerCase() : '';
    const title = (song.title || '').trim().toLowerCase();
    const core = cleanCoreTitle(song.title || '');
    const keys = song.title ? songKeys({ title: song.title, artist: song.artist, url: song.url }) : [];
    return this.bannedSongs.some(
      (b) =>
        (song.id && b.id === song.id) ||
        (url && b.url && b.url.trim().toLowerCase() === url) ||
        (title && b.title && b.title.trim().toLowerCase() === title) ||
        (core && b.title && cleanCoreTitle(b.title) === core) ||
        (keys.length > 0 && b.title && isSameSong(keys, songKeys({ title: b.title, artist: b.artist, url: b.url })))
    );
  }

  public async loadBanned(): Promise<BannedSong[]> {
    try {
      const parsed = JSON.parse(localStorage.getItem(DONT_PLAY_AGAIN_KEY) || 'null');
      if (Array.isArray(parsed)) {
        this.bannedSongs = parsed;
        this.onChange();
      }
    } catch {
      // ignore localStorage errors
    }
    return this.fetchBanned();
  }

  public async fetchBanned(): Promise<BannedSong[]> {
    try {
      const res = await fetch('/api/banned');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.banned)) {
          this.bannedSongs = data.banned;
          saveLocal(DONT_PLAY_AGAIN_KEY, this.bannedSongs);
          this.onChange();
        }
      }
    } catch (err) {
      console.warn('Failed to fetch banned songs from server:', err);
    }
    return this.bannedSongs;
  }

  /**
   * Bans or unbans at once (optimistic). Returns the new state and the server sync, which
   * resolves to the server's answer (or the local one if it can't be reached).
   */
  public toggleBanned(song: SongInfo): { banned: boolean; title: string; synced: Promise<boolean> } {
    const already = this.isBanned(song);
    const title = (song.title || '').trim().toLowerCase();
    const core = cleanCoreTitle(song.title || '');
    let shownTitle = song.title || '';
    if (already) {
      this.bannedSongs = this.bannedSongs.filter(
        (b) =>
          !(
            (song.id && b.id === song.id) ||
            (song.url && b.url && b.url === song.url) ||
            (title && b.title && b.title.trim().toLowerCase() === title) ||
            (core && b.title && cleanCoreTitle(b.title) === core)
          )
      );
    } else {
      const entry: BannedSong = {
        id: song.id || `banned_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        title: (song.title || 'Unknown Track').trim(),
        artist: (song.artist || 'Unknown Artist').trim(),
        url: song.url,
        thumbnail: song.thumbnail,
        duration: song.duration ? Math.round(song.duration) : undefined,
        bannedAt: Date.now(),
      };
      shownTitle = entry.title;
      this.bannedSongs = [entry, ...this.bannedSongs];
    }
    saveLocal(DONT_PLAY_AGAIN_KEY, this.bannedSongs);
    this.onChange();
    return { banned: !already, title: shownTitle, synced: this.syncBanned(song, !already) };
  }

  private async syncBanned(song: SongInfo, banned: boolean): Promise<boolean> {
    try {
      const res = await fetch('/api/banned/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ song: pick(song, ['id', 'title', 'artist', 'url', 'thumbnail', 'duration']) }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.banned)) {
          this.bannedSongs = data.banned;
          saveLocal(DONT_PLAY_AGAIN_KEY, this.bannedSongs);
          this.onChange();
          return Boolean(data.isBanned);
        }
      }
    } catch (err) {
      console.warn('Failed to sync banned song toggle with backend:', err);
    }
    return banned;
  }
}

function pick<T extends object>(obj: T, keys: Array<keyof T>): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) out[k] = obj[k];
  return out;
}
