/**
 * The Up Next queue's rules that don't depend on playback: when two songs count as the same,
 * how full the queue is, and which duplicates to drop. AudioEngine owns the queue itself and
 * what a change means for the decks; these are pure so they can be tested on their own.
 */
import type { QueuedTrack } from '../../types';
import { cleanCoreTitle, isSameSong, songKeys } from '../songMatch';

export type SongLike = { id?: string; title?: string; artist?: string; url?: string };

/** Up Next capacity (50 songs). */
export const MAX_QUEUE_TARGET = 50;

const lower = (s?: string) => (s || '').trim().toLowerCase();

/**
 * A test for "is this the same song as `song`": same id, same URL, same title, same core title
 * ("Lover" vs "Diljit Dosanjh - Lover (Official Video)"), or matching song keys. The keys of
 * `song` are worked out once, so the test is cheap to run over a whole list.
 */
export function sameSongAs(song: SongLike): (other?: SongLike | null) => boolean {
  const id = song.id;
  const url = lower(song.url);
  const title = lower(song.title);
  const core = cleanCoreTitle(song.title || '');
  const keys = song.title ? songKeys({ title: song.title, artist: song.artist, url: song.url }) : [];
  return (other) => {
    if (!other) return false;
    if (id && other.id && id === other.id) return true;
    if (url && other.url && url === lower(other.url)) return true;
    if (!other.title) return false;
    if (title && title === lower(other.title)) return true;
    if (core && core === cleanCoreTitle(other.title)) return true;
    return keys.length > 0 && isSameSong(keys, songKeys({ title: other.title, artist: other.artist, url: other.url }));
  };
}

/** Songs in the queue that can still play (failed ones are about to be dropped). */
export function activeCount(queue: QueuedTrack[]): number {
  return queue.filter((q) => q.status !== 'failed').length;
}

export const isQueueFull = (queue: QueuedTrack[]) => activeCount(queue) >= MAX_QUEUE_TARGET;

/**
 * The queue without duplicates (same video, same name or same core title; the first one
 * stays) and without the songs `drop` rules out.
 */
export function dedupeQueue(queue: QueuedTrack[], drop: (item: QueuedTrack) => boolean): QueuedTrack[] {
  const seenKeys: string[][] = [];
  const seenCoreTitles = new Set<string>();
  const seenUrls = new Set<string>();
  const unique: QueuedTrack[] = [];

  for (const item of queue) {
    if (!item.title || drop(item)) continue;
    const core = cleanCoreTitle(item.title);
    const url = lower(item.url);
    const keys = songKeys(item);

    // 1. Direct URL match
    if (url && seenUrls.has(url)) continue;
    // 2. Core title match (e.g. "Lover" vs "Diljit Dosanjh - Lover")
    if (core && seenCoreTitles.has(core)) continue;
    // 3. Multi-key fuzzy / videoId match
    if (seenKeys.some((prev) => isSameSong(prev, keys))) continue;

    if (url) seenUrls.add(url);
    if (core) seenCoreTitles.add(core);
    seenKeys.push(keys);
    unique.push(item);
  }
  return unique;
}

/** The first songs of Up Next are left alone by reshuffles, expiry and Refresh: they're loading or about to play. */
export const KEEP_AT_TOP = 3;
/** An automatically picked new song nobody has played after this long is replaced. */
export const STALE_AFTER_MS = 30 * 60_000;

/** A song the listener or a guest added on purpose: never moved, expired or refreshed away. */
export const isChosen = (q: QueuedTrack) => q.source === 'request';
/** A song the engine picked that the listener may not know (a recommendation, not their history). */
export const isNewPick = (q: QueuedTrack) => !isChosen(q) && !!q.isAiRecommended;

/**
 * Familiar songs and new picks taking turns, two familiar to one new, so a night is mostly songs
 * people know with a fresh one every third song. The first `keepTop` songs and the songs someone
 * chose stay where they are; the rest keep their order within each group.
 */
export function mixFamiliarAndNew(queue: QueuedTrack[], keepTop = KEEP_AT_TOP): QueuedTrack[] {
  const head = queue.slice(0, keepTop);
  const rest = queue.slice(keepTop);
  const familiar = rest.filter((q) => !isChosen(q) && !isNewPick(q));
  const fresh = rest.filter(isNewPick);
  let slot = 0;
  const mixed = rest.map((q) => {
    if (isChosen(q)) return q;
    const wantNew = slot++ % 3 === 2;
    return (wantNew ? (fresh.shift() ?? familiar.shift()) : (familiar.shift() ?? fresh.shift()))!;
  });
  return [...head, ...mixed];
}

/** New picks below the top of Up Next that have waited longer than STALE_AFTER_MS without being played. */
export function staleSongs(queue: QueuedTrack[], now: number, keepTop = KEEP_AT_TOP): QueuedTrack[] {
  return queue
    .slice(keepTop)
    .filter((q) => isNewPick(q) && (q.status === 'queued' || q.status === 'failed') && q.queuedAt !== undefined && now - q.queuedAt > STALE_AFTER_MS);
}
