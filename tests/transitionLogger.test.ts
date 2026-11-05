import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TransitionLogger, TRANSITION_STORAGE_KEY } from '../src/audio/engine/TransitionLogger';
import type { TransitionLogEntry } from '../src/types';

describe('TransitionLogger Unit Tests', () => {
  let logger: TransitionLogger;
  let mockStorage: Record<string, string>;

  beforeEach(() => {
    mockStorage = {};
    (globalThis as any).window = {
      localStorage: {
        getItem: vi.fn((k: string) => mockStorage[k] || null),
        setItem: vi.fn((k: string, v: string) => { mockStorage[k] = v; }),
        removeItem: vi.fn((k: string) => { delete mockStorage[k]; }),
        clear: vi.fn(() => { mockStorage = {}; }),
      },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, transitions: [] }),
    }));
    logger = new TransitionLogger();
  });

  const dummyEntry = (id: string, style: any = 'loop_roll_riser', extra: Partial<TransitionLogEntry> = {}): TransitionLogEntry => ({
    id,
    timestamp: Date.now(),
    isoDate: new Date().toISOString(),
    outgoing: { title: 'Tera Yaar Bolda', artist: 'Surjit Bindrakhia', bpm: 128, key: '8B' },
    incoming: { title: 'Sadi Gali', artist: 'T-Series', bpm: 128, key: '8B' },
    style,
    durationSeconds: 8,
    sourceDeck: 'A',
    targetDeck: 'B',
    harmonicCompatibility: 'Exact Match (8B -> 8B)',
    keyFit: 'good',
    tempoMatched: true,
    mood: 'party',
    reason: '🤖 AI DJ Beatmatched Drop Cut',
    ...extra,
  });

  it('logs a transition, saves to memory and localStorage, and calls server endpoint', async () => {
    const entry = dummyEntry('trn_1');
    await logger.logTransition(entry);

    expect(logger.history).toHaveLength(1);
    expect(logger.history[0].id).toBe('trn_1');
    expect(logger.history[0].style).toBe('loop_roll_riser');

    // Stored in localStorage
    expect(mockStorage[TRANSITION_STORAGE_KEY]).toBeDefined();
    const parsed = JSON.parse(mockStorage[TRANSITION_STORAGE_KEY]);
    expect(parsed[0].id).toBe('trn_1');

    // POST /api/transitions called
    expect(fetch).toHaveBeenCalledWith('/api/transitions', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }));
  });

  it('calculates comprehensive analytics over logged transitions', async () => {
    await logger.logTransition(dummyEntry('t1', 'loop_roll_riser', { durationSeconds: 6 }));
    await logger.logTransition(dummyEntry('t2', 'vinyl_brake_drop', { durationSeconds: 4 }));
    await logger.logTransition(dummyEntry('t3', 'loop_roll_riser', { durationSeconds: 8 }));
    await logger.logTransition(dummyEntry('t4', 'filter_bass_swap', { durationSeconds: 12, keyFit: 'clash', harmonicCompatibility: 'Harmonic Clash' }));

    const analytics = logger.getAnalytics();
    expect(analytics.totalTransitions).toBe(4);
    expect(analytics.topStyle).toBe('loop_roll_riser');
    expect(analytics.styleCounts['loop_roll_riser']).toBe(2);
    expect(analytics.styleCounts['vinyl_brake_drop']).toBe(1);
    expect(analytics.styleCounts['filter_bass_swap']).toBe(1);
    expect(analytics.averageDurationSeconds).toBe(7.5);
    expect(analytics.harmonicFitPercentage).toBe(75); // 3 of 4
    expect(analytics.recentTransitions).toHaveLength(4);
  });

  it('merges server transitions during fetchFromServer', async () => {
    const serverEntry = dummyEntry('server_1', 'showcase_3band_handoff');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ transitions: [serverEntry] }),
    }));

    await logger.fetchFromServer();
    expect(logger.history.some((e) => e.id === 'server_1')).toBe(true);
  });

  it('clears transitions locally and triggers DELETE on server', async () => {
    await logger.logTransition(dummyEntry('t1'));
    expect(logger.history).toHaveLength(1);

    await logger.clear();
    expect(logger.history).toHaveLength(0);
    expect(fetch).toHaveBeenCalledWith('/api/transitions', { method: 'DELETE' });
  });
});

