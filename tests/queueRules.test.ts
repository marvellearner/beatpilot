import { describe, expect, it } from 'vitest';
import type { QueuedTrack } from '../src/types';
import { MAX_QUEUE_TARGET, activeCount, dedupeQueue, isQueueFull, mixFamiliarAndNew, sameSongAs, staleSongs } from '../src/audio/engine/queueRules';

const track = (id: string, title: string, extra: Partial<QueuedTrack> = {}): QueuedTrack =>
  ({ id, title, artist: 'Artist', duration: 200, url: `search:${id}`, status: 'queued', ...extra }) as QueuedTrack;

describe('sameSongAs', () => {
  it('matches by id, url (any case), title or core title', () => {
    const isLover = sameSongAs({ id: 'x', title: 'Diljit Dosanjh - Lover (Official Video)', url: 'https://youtu.be/AAAAAAAAAAA' });
    expect(isLover({ id: 'x', title: 'Something else' })).toBe(true);
    expect(isLover({ title: 'other', url: 'HTTPS://YOUTU.BE/AAAAAAAAAAA' })).toBe(true);
    expect(isLover({ title: 'Lover' })).toBe(true);
    expect(isLover({ title: 'Softly' })).toBe(false);
    expect(isLover(null)).toBe(false);
  });
});

describe('queue capacity', () => {
  it('does not count failed songs', () => {
    const q = Array.from({ length: MAX_QUEUE_TARGET }, (_, i) => track(`t${i}`, `Song ${i}`));
    expect(isQueueFull(q)).toBe(true);
    q[0].status = 'failed';
    expect(activeCount(q)).toBe(MAX_QUEUE_TARGET - 1);
    expect(isQueueFull(q)).toBe(false);
  });
});

describe('dedupeQueue', () => {
  it('keeps the first copy of each song and drops what the rule rules out', () => {
    const q = [
      track('a', 'Lover'),
      track('b', 'Diljit Dosanjh - Lover (Official Video)'),
      track('c', 'Softly'),
      track('d', 'Too Long Mix', { duration: 600 }),
      track('e', 'Brown Munde'),
      track('f', 'Brown Munde', { url: 'search:a' }),
    ];
    const kept = dedupeQueue(q, (item) => item.duration > 300);
    expect(kept.map((t) => t.id)).toEqual(['a', 'c', 'e']);
  });
});

describe('mixFamiliarAndNew', () => {
  const fam = (id: string) => track(id, `Fam ${id}`, { source: 'playlist', isAiRecommended: false });
  const pick = (id: string) => track(id, `New ${id}`, { source: 'ai', isAiRecommended: true });
  const req = (id: string) => track(id, `Req ${id}`, { source: 'request' });

  it('keeps the top songs, takes two familiar to one new, and leaves chosen songs in place', () => {
    const queue = [pick('t1'), pick('t2'), fam('t3'), pick('n1'), pick('n2'), fam('f1'), req('r1'), fam('f2'), fam('f3'), fam('f4')];
    expect(mixFamiliarAndNew(queue, 3).map((q) => q.id)).toEqual(['t1', 't2', 't3', 'f1', 'f2', 'n1', 'r1', 'f3', 'f4', 'n2']);
  });
});

describe('staleSongs', () => {
  const now = 10_000_000;
  const old = now - 31 * 60_000;
  it('only new picks below the top that waited over 30 minutes', () => {
    const queue = [
      track('top', 'Top', { isAiRecommended: true, queuedAt: old }),
      track('a', 'A', { isAiRecommended: true, queuedAt: old }),
      track('b', 'B', { isAiRecommended: true, queuedAt: now - 5 * 60_000 }),
      track('c', 'C', { isAiRecommended: false, source: 'playlist', queuedAt: old }),
      track('d', 'D', { source: 'request', queuedAt: old }),
      track('e', 'E', { isAiRecommended: true, queuedAt: old, status: 'downloading' }),
    ];
    expect(staleSongs(queue, now, 1).map((q) => q.id)).toEqual(['a']);
  });
});
