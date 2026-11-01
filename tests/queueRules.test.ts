import { describe, expect, it } from 'vitest';
import type { QueuedTrack } from '../src/types';
import { MAX_QUEUE_TARGET, activeCount, dedupeQueue, isQueueFull, mixFamiliarAndNew, sameSongAs, spreadArtists, staleSongs } from '../src/audio/engine/queueRules';

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

describe('spreadArtists', () => {
  const by = (id: string, artist: string, extra: Partial<QueuedTrack> = {}) => track(id, `Song ${id}`, { artist, ...extra });

  it('never plays one artist twice in a row and at most twice in ten songs', () => {
    const q = [
      by('a1', 'Karan Aujla'), by('a2', 'Karan Aujla'), by('a3', 'Karan Aujla'),
      by('b1', 'Diljit Dosanjh'), by('c1', 'Shubh'), by('d1', 'Badshah'), by('e1', 'AP Dhillon'),
      by('f1', 'Guru Randhawa'), by('g1', 'Arijit Singh'), by('h1', 'Mika Singh'), by('i1', 'Yo Yo Honey Singh'),
    ];
    const out = spreadArtists(q, 0).map((t) => t.artist);
    for (let i = 1; i < out.length; i++) expect(out[i]).not.toBe(out[i - 1]);
    for (let i = 0; i + 10 <= out.length; i++) expect(out.slice(i, i + 10).filter((a) => a === 'Karan Aujla').length).toBeLessThanOrEqual(2);
    expect(out).toHaveLength(q.length);
  });

  it('keeps the top songs, chosen songs and the familiar / new turns in place', () => {
    const q = [
      by('top', 'Karan Aujla'),
      by('f1', 'Karan Aujla'), by('f2', 'Shubh'),
      by('n1', 'Badshah', { isAiRecommended: true }),
      by('req', 'Karan Aujla', { source: 'request' }),
      by('n2', 'AP Dhillon', { isAiRecommended: true }),
    ];
    const out = spreadArtists(q, 1).map((t) => t.id);
    expect(out[0]).toBe('top');
    expect(out[1]).toBe('f2'); // Karan Aujla can't follow Karan Aujla
    expect(out[3]).toBe('n1'); // a new pick's slot still holds a new pick
    expect(out[4]).toBe('req');
    expect(new Set(out).size).toBe(q.length);
  });
});

describe('mood picks stay together at the top', () => {
  it('a reshuffle (familiar / new turns, artist spreading) leaves them where they are', () => {
    const q = [
      track('top', 'Now loading'),
      track('m1', 'Laila Main Laila', { artist: 'Pawni Pandey', isAiRecommended: true, moodPick: true }),
      track('m2', 'Chikni Chameli', { artist: 'Shreya Ghoshal', isAiRecommended: true, moodPick: true }),
      track('m3', 'Ram Chahe Leela', { artist: 'Bhoomi Trivedi', isAiRecommended: true, moodPick: true }),
      track('f1', 'Familiar one', { artist: 'Karan Aujla' }),
      track('n1', 'New one', { artist: 'Badshah', isAiRecommended: true }),
      track('f2', 'Familiar two', { artist: 'Shubh' }),
    ];
    for (const out of [mixFamiliarAndNew(q, 1), spreadArtists(q, 1)]) {
      expect(out.slice(0, 4).map((t) => t.id)).toEqual(['top', 'm1', 'm2', 'm3']);
      expect(out).toHaveLength(q.length);
    }
  });
});
