/**
 * The Up Next queue's rules that don't depend on playback: when two songs count as the same,
 * how full the queue is, and which duplicates to drop. AudioEngine owns the queue itself and
 * what a change means for the decks; these are pure so they can be tested on their own.
 */
import type { QueuedTrack } from '../../types';
import { cleanCoreTitle, isSameSong, songKeys } from '../songMatch';
import { artistKey, songArtists } from '../../../shared/taste';

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
/**
 * Stays where it is when Up Next is reshuffled: songs someone chose, and the songs picked to
 * follow the type of songs they just chose (`moodPick`, kept together at the top).
 */
export const isPinned = (q: QueuedTrack) => isChosen(q) || !!q.moodPick;
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
  const familiar = rest.filter((q) => !isPinned(q) && !isNewPick(q));
  const fresh = rest.filter((q) => !isPinned(q) && isNewPick(q));
  let slot = 0;
  const mixed = rest.map((q) => {
    if (isPinned(q)) return q;
    const wantNew = slot++ % 3 === 2;
    return (wantNew ? (fresh.shift() ?? familiar.shift()) : (familiar.shift() ?? fresh.shift()))!;
  });
  return [...head, ...mixed];
}

/**
 * While Hindi / Punjabi songs play back to back: English songs go to the end of Up Next, so they
 * aren't next in line. Songs someone chose and `keep` (the song being mixed in) stay where they
 * are; the rest keep their order. Returns the same array when nothing moves.
 */
export function moveWesternDown(queue: QueuedTrack[], isWestern: (q: QueuedTrack) => boolean, keep: (q: QueuedTrack) => boolean = () => false): QueuedTrack[] {
  const moved = new Set(queue.filter((q) => !isChosen(q) && !keep(q) && isWestern(q)));
  if (!moved.size) return queue;
  return [...queue.filter((q) => !moved.has(q)), ...moved];
}

/** Unheard songs (by the listener's artists, never played here) in Up Next at once: about 1 in 4 new picks. */
export const UNHEARD_MAX = 4;
/** One artist at most ARTIST_MAX_IN_WINDOW times in any SPREAD_WINDOW songs of Up Next, never twice in a row. */
export const ARTIST_MAX_IN_WINDOW = 2;
export const SPREAD_WINDOW = 10;

/** The song's main artist as a comparable key ('' when unknown). */
export function mainArtistKey(q: { title?: string; artist?: string }): string {
  const name = songArtists({ title: q.title || '', artist: q.artist })[0];
  return name ? artistKey(name) : '';
}

/**
 * Up Next with the same artist spread out: never two songs in a row by one artist and at most
 * ARTIST_MAX_IN_WINDOW in any SPREAD_WINDOW, so one artist doesn't flood the night. Each slot
 * takes the first song of the same kind (familiar or new pick) that fits, so the familiar / new
 * turns stay; when none fits, the order is kept. The first `keepTop` and chosen songs don't move.
 */
export function spreadArtists(queue: QueuedTrack[], keepTop = KEEP_AT_TOP): QueuedTrack[] {
  const keys = new Map<QueuedTrack, string>();
  const keyOf = (q: QueuedTrack) => {
    if (!keys.has(q)) keys.set(q, mainArtistKey(q));
    return keys.get(q)!;
  };
  const out = queue.slice(0, keepTop);
  const rest = queue.slice(keepTop);
  const remaining = rest.filter((q) => !isPinned(q));
  const fits = (q: QueuedTrack) => {
    const a = keyOf(q);
    if (!a) return true;
    const recent = out.slice(-(SPREAD_WINDOW - 1)).map(keyOf);
    return recent[recent.length - 1] !== a && recent.filter((x) => x === a).length < ARTIST_MAX_IN_WINDOW;
  };
  for (const slot of rest) {
    if (isPinned(slot)) {
      out.push(slot);
      continue;
    }
    const kind = isNewPick(slot);
    const pick = remaining.find((q) => isNewPick(q) === kind && fits(q)) ?? remaining.find((q) => isNewPick(q) === kind) ?? remaining[0];
    remaining.splice(remaining.indexOf(pick), 1);
    out.push(pick);
  }
  return out;
}

/** New picks below the top of Up Next that have waited longer than STALE_AFTER_MS without being played. */
export function staleSongs(queue: QueuedTrack[], now: number, keepTop = KEEP_AT_TOP): QueuedTrack[] {
  return queue
    .slice(keepTop)
    .filter((q) => isNewPick(q) && (q.status === 'queued' || q.status === 'failed') && q.queuedAt !== undefined && now - q.queuedAt > STALE_AFTER_MS);
}
