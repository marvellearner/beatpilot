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
    .replace(/\(.*?\)|\[.*?\]/g, ' ') // "(Official Video)", "[Lyrics]"
    .replace(/\b(official|music|video|audio|lyrics?|lyrical|full song|hd|4k)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '');

/** Comparable forms of a song: its YouTube video id, and normalised "title" / "artist title". */
export function songKeys(song: SongRef): string[] {
  const keys: string[] = [];
  const videoId = song.url?.match(/(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{11})/)?.[1];
  if (videoId) keys.push(`yt:${videoId}`);
  keys.push(normalize(song.title));
  if (song.artist && !/searching|^artist$/i.test(song.artist)) keys.push(normalize(`${song.artist} ${song.title}`));
  if (song.url && !videoId) keys.push(normalize(song.url)); // e.g. "Artist - Title" lines from my_songs.txt
  return keys.filter((k) => k.length >= 3);
}

/** Same video id, same normalised name, or one name containing the other (8+ characters). */
export function isSameSong(a: string[], b: string[]): boolean {
  return a.some((x) =>
    b.some(
      (y) =>
        x === y ||
        (!x.startsWith('yt:') && !y.startsWith('yt:') && Math.min(x.length, y.length) >= 8 && (x.includes(y) || y.includes(x)))
    )
  );
}
