import { describe, expect, it, beforeEach } from 'vitest';
import { TrackQueueManager, QUEUE_STORAGE_KEY } from '../src/audio/engine/TrackQueueManager';
import type { QueuedTrack } from '../src/types';

// Simple in-memory localStorage polyfill for Node.js test environment
const storage = new Map<string, string>();
if (typeof window === 'undefined') {
  (globalThis as any).window = {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, val: string) => storage.set(key, String(val)),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    },
  };
}

const createTrack = (id: string, title: string): QueuedTrack =>
  ({
    id,
    title,
    artist: 'Test Artist',
    duration: 210,
    url: `https://youtube.com/watch?v=${id}`,
    status: 'queued',
  }) as QueuedTrack;

describe('TrackQueueManager', () => {
  let qm: TrackQueueManager;

  beforeEach(() => {
    qm = new TrackQueueManager();
    window.localStorage.clear();
  });

  it('initializes with an empty queue', () => {
    expect(qm.items).toEqual([]);
    expect(qm.length).toBe(0);
  });

  it('allows moving an item to the top (#1 on deck)', () => {
    qm.items = [createTrack('1', 'Song 1'), createTrack('2', 'Song 2'), createTrack('3', 'Song 3')];
    const moved = qm.moveItem('3', 'top');
    expect(moved).toBe(true);
    expect(qm.items.map((i) => i.id)).toEqual(['3', '1', '2']);
  });

  it('allows nudging an item up and down', () => {
    qm.items = [createTrack('1', 'Song 1'), createTrack('2', 'Song 2'), createTrack('3', 'Song 3')];

    // Nudge 3 up
    qm.moveItem('3', 'up');
    expect(qm.items.map((i) => i.id)).toEqual(['1', '3', '2']);

    // Nudge 1 down
    qm.moveItem('1', 'down');
    expect(qm.items.map((i) => i.id)).toEqual(['3', '1', '2']);
  });

  it('removes an item by id and triggers save', () => {
    qm.items = [createTrack('1', 'Song 1'), createTrack('2', 'Song 2')];
    const removed = qm.removeItem('1');
    expect(removed?.id).toBe('1');
    expect(qm.items.map((i) => i.id)).toEqual(['2']);

    // Check localStorage
    const saved = JSON.parse(window.localStorage.getItem(QUEUE_STORAGE_KEY) || '[]');
    expect(saved.length).toBe(1);
    expect(saved[0].id).toBe('2');
  });

  it('restores queue from localStorage and excludes currently playing track', () => {
    const list = [createTrack('1', 'Song 1'), createTrack('2', 'Song 2')];
    window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(list));

    const restored = qm.restoreFromStorage({
      id: '1',
      title: 'Song 1',
      artist: 'Test Artist',
      duration: 210,
      bpm: 120,
      sourceType: 'download',
    });

    expect(restored).not.toBeNull();
    // Track '1' was playing, so only Track '2' should be restored
    expect(qm.items.map((i) => i.id)).toEqual(['2']);
  });
});
