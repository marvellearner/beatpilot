/**
 * Transitions Logger & Analyzer
 * Persists and analyzes all DJ transitions (outgoing & incoming songs, transition styles,
 * durations, harmonic compatibility, exit FX, BPM ratios and AI reasons) to allow post-set
 * analysis and review.
 */
import type { TransitionLogEntry } from '../../types';

export const TRANSITION_STORAGE_KEY = 'ai_dj_transition_history';
export const MAX_LOCAL_TRANSITIONS = 500;

export interface TransitionAnalytics {
  totalTransitions: number;
  styleCounts: Record<string, number>;
  topStyle: string;
  harmonicFitPercentage: number;
  averageDurationSeconds: number;
  beatmatchedPercentage: number;
  recentTransitions: TransitionLogEntry[];
}

export class TransitionLogger {
  private entries: TransitionLogEntry[] = [];
  private onUpdate: () => void;

  constructor(onUpdate: () => void = () => {}) {
    this.onUpdate = onUpdate;
    this.loadFromStorage();
    void this.fetchFromServer();
  }

  public get history(): TransitionLogEntry[] {
    return this.entries;
  }

  /** Logs an executed transition, stores it locally, and posts to the server. */
  public async logTransition(entry: TransitionLogEntry): Promise<void> {
    // Add to the front (newest first)
    this.entries.unshift(entry);
    if (this.entries.length > MAX_LOCAL_TRANSITIONS) {
      this.entries = this.entries.slice(0, MAX_LOCAL_TRANSITIONS);
    }

    this.saveToStorage();
    this.onUpdate();

    // Console output for live review
    console.log(
      `%c[Transition Logger] 🎛️ ${entry.style.toUpperCase()}%c: "${entry.outgoing.title}" ➔ "${entry.incoming.title}" (${entry.durationSeconds}s) [${entry.harmonicCompatibility || 'Harmonics N/A'}]`,
      'color: #22d3ee; font-weight: bold;',
      'color: inherit;'
    );

    // Sync to disk on local server
    try {
      await fetch('/api/transitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      });
    } catch (err) {
      // Offline or server unavailable: stored in localStorage anyway
      console.warn('[TransitionLogger] Failed to post transition to server:', err);
    }
  }

  /** Fetches full transition logs from the server */
  public async fetchFromServer(): Promise<TransitionLogEntry[]> {
    try {
      const res = await fetch('/api/transitions');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.transitions)) {
          // Merge server logs with local logs deduplicated by id
          const existingIds = new Set(this.entries.map((e) => e.id));
          const newEntries: TransitionLogEntry[] = [];
          for (const item of data.transitions) {
            if (!existingIds.has(item.id)) {
              newEntries.push(item);
              existingIds.add(item.id);
            }
          }
          if (newEntries.length > 0) {
            this.entries = [...this.entries, ...newEntries].sort((a, b) => b.timestamp - a.timestamp);
            this.saveToStorage();
            this.onUpdate();
          }
        }
      }
    } catch {
      // ignore in tests or offline
    }
    return this.entries;
  }

  /** Clears all transition logs locally and on server */
  public async clear(): Promise<void> {
    this.entries = [];
    this.saveToStorage();
    this.onUpdate();
    try {
      await fetch('/api/transitions', { method: 'DELETE' });
    } catch {
      // ignore
    }
  }

  /** Computes high-level analytics over logged transitions */
  public getAnalytics(): TransitionAnalytics {
    const total = this.entries.length;
    if (total === 0) {
      return {
        totalTransitions: 0,
        styleCounts: {},
        topStyle: 'none',
        harmonicFitPercentage: 0,
        averageDurationSeconds: 0,
        beatmatchedPercentage: 0,
        recentTransitions: [],
      };
    }

    const styleCounts: Record<string, number> = {};
    let harmonicFits = 0;
    let totalDuration = 0;
    let beatmatched = 0;

    for (const e of this.entries) {
      styleCounts[e.style] = (styleCounts[e.style] || 0) + 1;
      if (e.keyFit === 'good' || e.keyFit === 'ok' || (e.harmonicCompatibility && !e.harmonicCompatibility.includes('Clash'))) {
        harmonicFits++;
      }
      if (e.tempoMatched) {
        beatmatched++;
      }
      totalDuration += e.durationSeconds || 0;
    }

    let topStyle = 'none';
    let maxCount = 0;
    for (const [st, cnt] of Object.entries(styleCounts)) {
      if (cnt > maxCount) {
        maxCount = cnt;
        topStyle = st;
      }
    }

    return {
      totalTransitions: total,
      styleCounts,
      topStyle,
      harmonicFitPercentage: Math.round((harmonicFits / total) * 100),
      averageDurationSeconds: Math.round((totalDuration / total) * 10) / 10,
      beatmatchedPercentage: Math.round((beatmatched / total) * 100),
      recentTransitions: this.entries.slice(0, 20),
    };
  }

  private loadFromStorage() {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      const raw = window.localStorage.getItem(TRANSITION_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.entries = parsed;
        }
      }
    } catch {
      this.entries = [];
    }
  }

  private saveToStorage() {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      window.localStorage.setItem(TRANSITION_STORAGE_KEY, JSON.stringify(this.entries.slice(0, MAX_LOCAL_TRANSITIONS)));
    } catch {
      // storage quota or unavailable
    }
  }
}

