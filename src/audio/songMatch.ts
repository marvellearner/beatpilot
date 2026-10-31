/**
 * Decides whether two song references are the same song, even when written differently:
 * a YouTube link vs a search result, "Artist - Title" from my_songs.txt vs
 * "Artist - Title (Official Video)" from YouTube.
 */

import { songArtists } from '../../shared/taste';

export interface SongRef {
  id?: string;
  title: string;
  artist?: string;
  url?: string;
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]|\{.*?\}/g, ' ') // "(Official Video)", "[Lyrics]"
    .replace(/\b(official|music|video|audio|lyrics?|lyrical|full song|hd|4k|visualizer|remix|club mix|extended)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '');

/** Extracts the core title by removing parenthesized/bracketed metadata, "(Official Video)", artist prefixes, etc. */
export function cleanCoreTitle(raw: string): string {
  if (!raw) return '';
  let s = raw.toLowerCase();
  s = s.replace(/\(.*?\)|\[.*?\]|\{.*?\}/g, ' ');
  s = s.replace(/\b(official|music|video|audio|lyrics?|lyrical|full song|hd|4k|visualizer|remix|club mix|extended)\b/g, ' ');
  // Split on " - ", " | ", or ":"
  if (s.includes(' - ')) {
    const parts = s.split(' - ').map((p) => p.replace(/[^a-z0-9]/g, '').trim()).filter(Boolean);
    if (parts.length > 1) return parts[1];
  } else if (s.includes(' | ')) {
    const parts = s.split(' | ').map((p) => p.replace(/[^a-z0-9]/g, '').trim()).filter(Boolean);
    if (parts.length > 1) return parts[0];
  } else if (s.includes(':')) {
    const parts = s.split(':').map((p) => p.replace(/[^a-z0-9]/g, '').trim()).filter(Boolean);
    if (parts.length > 1) return parts[1];
  }
  return s.replace(/[^a-z0-9]/g, '').trim();
}

/**
 * The parts of a title ("Artist - Song", "Artist: Song") that can name the song, without
 * `exclude` (its artists: a piece like "diljitdosanjh" is shared by all of their songs) and
 * without what follows the first "|" (credits: director, label, "Latest Punjabi Songs 2024").
 */
export function titleSegments(raw: string, exclude: string[] = []): string[] {
  if (!raw) return [];
  let s = raw.toLowerCase().split('|')[0];
  s = s.replace(/\(.*?\)|\[.*?\]|\{.*?\}/g, ' ');
  s = s.replace(/\b(official|music|video|audio|lyrics?|lyrical|full song|hd|4k|visualizer|remix|club mix|extended)\b/g, ' ');
  const skip = new Set(exclude.map((e) => e.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean));
  return s
    .split(/[-:]/)
    .map((p) => p.replace(/[^a-z0-9]/g, '').trim())
    .filter((p) => p.length >= 3 && !skip.has(p));
}

/** A stable id for storing per-song data (hot cues, AI answers): the URL, else title + artist. */
export function songStorageKey(song: { url?: string; title: string; artist: string }): string {
  return song.url || `${song.title}|${song.artist}`;
}

/** Comparable forms of a song: its YouTube video id, and normalised "title" / "artist title". */
export function songKeys(song: SongRef): string[] {
  const keys: string[] = [];
  if (song.id) {
    keys.push(`id:${song.id.toLowerCase().trim()}`);
  }
  const videoId =
    song.url?.match(/(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{11})/)?.[1] ||
    song.id?.match(/(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{11})/)?.[1];
  if (videoId) keys.push(`yt:${videoId}`);
  const normTitle = normalize(song.title);
  if (normTitle) keys.push(normTitle);
  const coreTitle = cleanCoreTitle(song.title);
  if (coreTitle && coreTitle !== normTitle) keys.push(coreTitle);
  // Not the artist's name on its own: every song of theirs has that piece
  for (const seg of titleSegments(song.title, songArtists(song))) {
    keys.push(seg);
  }
  if (song.artist && !/searching|^artist$/i.test(song.artist)) {
    keys.push(normalize(`${song.artist} ${song.title}`));
    if (coreTitle) {
      keys.push(normalize(`${song.artist} ${coreTitle}`));
    }
  }
  if (song.url && !videoId) {
    keys.push(normalize(song.url));
  }
  return Array.from(new Set(keys.filter((k) => k.length >= 3)));
}

/** Same video id, same normalised name, or one name containing the other (6+ characters). */
export function isSameSong(a: string[], b: string[]): boolean {
  return a.some((x) =>
    b.some(
      (y) =>
        x === y ||
        (!x.startsWith('yt:') && !x.startsWith('id:') && !y.startsWith('yt:') && !y.startsWith('id:') && Math.min(x.length, y.length) >= 6 && (x.includes(y) || y.includes(x)))
    )
  );
}

/**
 * Checks whether two song references are the same song.
 * Used strictly to enforce that in "Previously Played", no 2 consecutive songs can ever be the same.
 */
export function areSongsConsecutivelySame(a?: SongRef | null, b?: SongRef | null): boolean {
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) return true;
  if (a.url && b.url && a.url === b.url) return true;

  const aTitle = (a.title || '').trim().toLowerCase();
  const bTitle = (b.title || '').trim().toLowerCase();
  if (aTitle && bTitle && aTitle === bTitle) return true;

  const aNorm = normalize(a.title || '');
  const bNorm = normalize(b.title || '');
  if (aNorm && bNorm && aNorm === bNorm) return true;

  const aCore = cleanCoreTitle(a.title || '');
  const bCore = cleanCoreTitle(b.title || '');
  if (aCore && bCore && aCore === bCore && aCore.length >= 3) return true;

  return isSameSong(songKeys(a), songKeys(b));
}

/**
 * Exception songs that must ALWAYS strictly be played from the very beginning (0:00).
 * Specifically: "Ping Pong Tremor" mashup and festival anthems "Ping Pong" (Armin van Buuren) /
 * "Tremor" (Martin Garrix & Dimitri Vegas, Like Mike) where the iconic intro (such as the bouncing
 * ping pong ball clicks) build the entire track energy and must strictly never be skipped or cued mid-song.
 */
export function isStrictStartSong(song?: { title?: string; artist?: string; url?: string } | null): boolean {
  if (!song) return false;
  const text = `${song.title || ''} ${song.artist || ''} ${song.url || ''}`.toLowerCase();
  if (!text.trim()) return false;

  // "ping pong" variations (e.g. "ping pong", "ping-pong", "ping_pong")
  const hasPingPong = /ping\s*[-_ ]*\s*pong/i.test(text);
  // "tremor" variations
  const hasTremor = /\btremor\b/i.test(text);

  return (hasPingPong && hasTremor) || hasPingPong || hasTremor;
}

/**
 * Detects 8D audio / panning songs (e.g. "8D AUDIO", "8D Version", "8D Remix", "Use Headphones (8D)").
 * These are strictly excluded from automated queueing and recommendations because artificial
 * phase shifts and stereo panning hollow out audio on party / club speakers.
 */
export function is8dSong(song?: { title?: string; artist?: string; url?: string } | null): boolean {
  if (!song) return false;
  const text = `${song.title || ''} ${song.artist || ''} ${song.url || ''}`.toLowerCase();
  if (!text.trim()) return false;
  // Matches "8D", "8-D", "8 D", "(8D)", "[8D AUDIO]", "8D Audio", "16D", etc.
  return /\b(8|16|24)[-_ ]*d\b/i.test(text);
}

/**
 * Detects mashup songs (e.g. "Mashup", "Mash-up", "Mash Up").
 * Mashup tracks are strictly excluded from automated queueing and recommendations on the engine's own accord.
 */
export function isMashupSong(song?: { title?: string; artist?: string; url?: string } | null): boolean {
  if (!song) return false;
  const text = `${song.title || ''} ${song.artist || ''} ${song.url || ''}`.toLowerCase();
  if (!text.trim()) return false;
  return /\bmash[-_ ]*up\b/i.test(text);
}

/**
 * Checks whether a track is an 8D or mashup song.
 * Neither should ever be suggested or added to the Up Next queue automatically.
 */
export function is8dOrMashupSong(song?: { title?: string; artist?: string; url?: string } | null): boolean {
  return is8dSong(song) || isMashupSong(song);
}


