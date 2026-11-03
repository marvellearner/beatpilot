/**
 * TrackQueueManager: encapsulates the Up Next queue state, serialization,
 * localStorage persistence, reordering ('top', 'up', 'down'), and removal.
 */

import { cleanCoreTitle } from '../songMatch';
import type { QueuedTrack, TrackMetadata } from '../../types';

export const QUEUE_STORAGE_KEY = 'ai_dj_up_next_queue';

export class TrackQueueManager {
  private queue: QueuedTrack[] = [];
  private onQueueChanged?: () => void;

  constructor(onQueueChanged?: () => void) {
    this.onQueueChanged = onQueueChanged;
  }

  public get items(): QueuedTrack[] {
    return this.queue;
  }

  public set items(newItems: QueuedTrack[]) {
    this.queue = newItems;
  }

  public get length(): number {
    return this.queue.length;
  }

  /**
   * Reorder a track in the queue ('top' = move to #1 on deck, 'up' = nudge forward, 'down' = nudge backward).
   */
  public moveItem(itemId: string, direction: 'up' | 'down' | 'top'): boolean {
    const idx = this.queue.findIndex((q) => q.id === itemId);
    if (idx === -1) return false;

    const item = this.queue[idx];
    const newQueue = [...this.queue];
    newQueue.splice(idx, 1);

    if (direction === 'top') {
      newQueue.unshift(item);
    } else if (direction === 'up') {
      newQueue.splice(Math.max(0, idx - 1), 0, item);
    } else if (direction === 'down') {
      newQueue.splice(Math.min(newQueue.length, idx + 1), 0, item);
    }

    this.queue = newQueue;
    this.saveToStorage();
    this.onQueueChanged?.();
    return true;
  }

  /**
   * Removes an item by ID from the queue.
   */
  public removeItem(itemId: string): QueuedTrack | undefined {
    const idx = this.queue.findIndex((q) => q.id === itemId);
    if (idx === -1) return undefined;

    const [removed] = this.queue.splice(idx, 1);
    this.saveToStorage();
    this.onQueueChanged?.();
    return removed;
  }

  /**
   * Saves the current serializable queue snapshot to localStorage.
   */
  public saveToStorage(): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      const serializable = this.queue.map((q) => ({
        id: q.id,
        title: q.title,
        artist: q.artist,
        duration: q.duration,
        url: q.url,
        thumbnail: q.thumbnail,
        highlightTime: q.highlightTime,
        cueInTime: q.cueInTime,
        musicStartTime: q.musicStartTime,
        introSkipReason: q.introSkipReason,
        musicEndTime: q.musicEndTime,
        hooks: q.hooks,
        peakTime: q.peakTime,
        outroReason: q.outroReason,
        status: (q.status === 'ready' || q.status === 'queued') ? 'queued' : q.status,
        isAiRecommended: q.isAiRecommended,
        source: q.source,
        lastPlayedAt: q.lastPlayedAt,
        queuedAt: q.queuedAt,
        unheard: q.unheard,
        pickReason: q.pickReason,
        moodPick: q.moodPick,
      }));
      window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(serializable));
    } catch {
      // ignore in restricted or sandboxed environments
    }
  }

  /**
   * Restores previously saved queue from localStorage.
   */
  public restoreFromStorage(onAirTrack?: TrackMetadata | null): QueuedTrack[] | null {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return null;
      const saved = window.localStorage.getItem(QUEUE_STORAGE_KEY);
      if (!saved) return null;

      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed) || parsed.length === 0) return null;

      let restored: QueuedTrack[] = parsed.map((item: QueuedTrack) => ({
        ...item,
        status: 'queued',
        audioBuffer: undefined,
      }));

      if (onAirTrack) {
        restored = restored.filter(
          (q) =>
            q.id !== onAirTrack.id &&
            q.url !== onAirTrack.url &&
            q.title.toLowerCase() !== onAirTrack.title.toLowerCase() &&
            cleanCoreTitle(q.title) !== cleanCoreTitle(onAirTrack.title)
        );
      }

      this.queue = restored;
      return restored;
    } catch {
      return null;
    }
  }

  public clear(): void {
    this.queue = [];
    this.saveToStorage();
    this.onQueueChanged?.();
  }
}

