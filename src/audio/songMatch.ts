/**
 * Decides whether two song references are the same song, even when written differently:
 * a YouTube link vs a search result, "Artist - Title" from my_songs.txt vs
 * "Artist - Title (Official Video)" from YouTube.
 */

export interface SongRef {
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

/** Extracts all distinct segments from a title string (e.g. artist and title parts). */
export function titleSegments(raw: string): string[] {
  if (!raw) return [];
  let s = raw.toLowerCase();
  s = s.replace(/\(.*?\)|\[.*?\]|\{.*?\}/g, ' ');
  s = s.replace(/\b(official|music|video|audio|lyrics?|lyrical|full song|hd|4k|visualizer|remix|club mix|extended)\b/g, ' ');
  const parts = s.split(/[-|:]/).map((p) => p.replace(/[^a-z0-9]/g, '').trim()).filter((p) => p.length >= 3);
  return parts;
}

/** Comparable forms of a song: its YouTube video id, and normalised "title" / "artist title". */
export function songKeys(song: SongRef): string[] {
  const keys: string[] = [];
  const videoId = song.url?.match(/(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{11})/)?.[1];
  if (videoId) keys.push(`yt:${videoId}`);
  const normTitle = normalize(song.title);
  if (normTitle) keys.push(normTitle);
  const coreTitle = cleanCoreTitle(song.title);
  if (coreTitle && coreTitle !== normTitle) keys.push(coreTitle);
  for (const seg of titleSegments(song.title)) {
    keys.push(seg);
  }
  if (song.artist && !/searching|^artist$/i.test(song.artist)) {
    keys.push(normalize(`${song.artist} ${song.title}`));
    for (const seg of titleSegments(song.artist)) {
      keys.push(seg);
    }
  }
  if (song.url && !videoId) {
    keys.push(normalize(song.url));
    for (const seg of titleSegments(song.url)) {
      keys.push(seg);
    }
  }
  return Array.from(new Set(keys.filter((k) => k.length >= 3)));
}

/** Same video id, same normalised name, or one name containing the other (6+ characters). */
export function isSameSong(a: string[], b: string[]): boolean {
  return a.some((x) =>
    b.some(
      (y) =>
        x === y ||
        (!x.startsWith('yt:') && !y.startsWith('yt:') && Math.min(x.length, y.length) >= 6 && (x.includes(y) || y.includes(x)))
    )
  );
}
