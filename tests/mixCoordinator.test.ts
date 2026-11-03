import { describe, expect, it } from 'vitest';
import { smoothStep, interpolateCrossfader } from '../src/audio/engine/MixCoordinator';

describe('smoothStep', () => {
  it('returns 0.0 at progress 0', () => {
    expect(smoothStep(0)).toBe(0);
  });

  it('returns 1.0 at progress 1', () => {
    expect(smoothStep(1)).toBe(1);
  });

  it('returns exactly 0.5 at the midpoint (0.5)', () => {
    expect(smoothStep(0.5)).toBe(0.5);
  });

  it('clamps values below 0 and above 1', () => {
    expect(smoothStep(-0.5)).toBe(0);
    expect(smoothStep(1.5)).toBe(1);
  });

  it('has zero derivative / soft ease at start and end', () => {
    expect(smoothStep(0.1)).toBeLessThan(0.1);
    expect(smoothStep(0.9)).toBeGreaterThan(0.9);
  });
});

describe('interpolateCrossfader', () => {
  it('interpolates smoothly from Deck A (-1) to Deck B (+1)', () => {
    expect(interpolateCrossfader(-1, 1, 0)).toBe(-1);
    expect(interpolateCrossfader(-1, 1, 0.5)).toBe(0);
    expect(interpolateCrossfader(-1, 1, 1)).toBe(1);
  });

  it('interpolates smoothly in reverse from Deck B (+1) to Deck A (-1)', () => {
    expect(interpolateCrossfader(1, -1, 0)).toBe(1);
    expect(interpolateCrossfader(1, -1, 0.5)).toBe(0);
    expect(interpolateCrossfader(1, -1, 1)).toBe(-1);
  });
});


// --- Mix lifecycle (fake audio clock, graph and decks) ---
import { beforeEach, afterEach, vi } from 'vitest';
import { MixCoordinator } from '../src/audio/engine/MixCoordinator';
import type { AudioGraph } from '../src/audio/engine/AudioGraph';
import type { VirtualDeck } from '../src/audio/VirtualDeck';
import type { TrackMetadata } from '../src/types';

function fakeSetup(startPos = -1) {
  const clock = { currentTime: 0 };
  const graph = {
    ctx: clock,
    crossfaderPosition: startPos,
    applyCrossfader: vi.fn((p: number) => { graph.crossfaderPosition = p; }),
    scheduleCrossfadeCurve: vi.fn(),
    scheduleLinearCrossfade: vi.fn(),
  };
  const makeDeck = () => ({ pause: vi.fn(), setEQ: vi.fn(), resetFilterSweep: vi.fn() });
  const decks = { A: makeDeck(), B: makeDeck() };
  const mc = new MixCoordinator(graph as unknown as AudioGraph, (id) => decks[id] as unknown as VirtualDeck);
  return { clock, graph, decks, mc };
}
const track = { id: 't1', title: 'Song' } as TrackMetadata;
const advance = (clock: { currentTime: number }, sec: number) => {
  clock.currentTime += sec;
  vi.advanceTimersByTime(sec * 1000);
};

describe('MixCoordinator lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as { window?: unknown }).window = globalThis;
  });
  afterEach(() => vi.useRealTimers());

  it('owns the fader position during a mix and lands the target deck alone at the end', () => {
    const { clock, graph, decks, mc } = fakeSetup(-1);
    const onTick = vi.fn();
    const onComplete = vi.fn();
    mc.begin({ sourceDeckId: 'A', targetDeckId: 'B', targetTrack: track, startTime: 0, durationSeconds: 10 }, { onTick, onComplete });
    expect(mc.isTransitioning).toBe(true);
    expect(graph.scheduleCrossfadeCurve).toHaveBeenCalledTimes(1);

    advance(clock, 5);
    expect(graph.crossfaderPosition).toBeCloseTo(0, 1);
    expect(graph.applyCrossfader).not.toHaveBeenCalled(); // never overrides the scheduled fade mid-mix

    advance(clock, 6);
    expect(mc.isTransitioning).toBe(false);
    expect(graph.crossfaderPosition).toBe(1);
    expect(decks.A.pause).toHaveBeenCalled();
    expect(decks.B.pause).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith(track, 'B');
  });

  it('cancel freezes the fader where it is and drops mix timers', () => {
    const { clock, graph, decks, mc } = fakeSetup(1);
    const fired = vi.fn();
    mc.begin({ sourceDeckId: 'B', targetDeckId: 'A', targetTrack: track, startTime: 0, durationSeconds: 10 }, { onTick: vi.fn(), onComplete: vi.fn() });
    mc.addMixTimer(8000, fired);
    advance(clock, 3);
    const frozen = graph.crossfaderPosition;
    expect(frozen).toBeGreaterThan(-1);
    expect(frozen).toBeLessThan(1);

    mc.cancel();
    expect(mc.isTransitioning).toBe(false);
    expect(graph.applyCrossfader).toHaveBeenLastCalledWith(frozen);
    expect(decks.A.setEQ).toHaveBeenCalledWith(0, 0, 0);
    advance(clock, 10);
    expect(fired).not.toHaveBeenCalled();
    expect(graph.crossfaderPosition).toBe(frozen);
  });

  it('a linear fade goes from the source deck, in either direction', () => {
    const { graph, mc } = fakeSetup(1);
    mc.begin(
      { sourceDeckId: 'B', targetDeckId: 'A', targetTrack: track, startTime: 0, durationSeconds: 10, linearFadeSeconds: 4 },
      { onTick: vi.fn(), onComplete: vi.fn() }
    );
    expect(graph.scheduleLinearCrossfade).toHaveBeenCalledWith('B', 0, 4);
    expect(graph.scheduleCrossfadeCurve).not.toHaveBeenCalled();
  });
});
