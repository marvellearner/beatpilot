import { describe, expect, it } from 'vitest';
import { gapCutFits, pickBlendFx, pickSignatureFx } from '../src/audio/engine/signatureFx';
import type { ExitFx } from '../src/types';

/** The moves of a run of mixes, each one knowing the ones before it. */
function run(mood: string, inLowPart: boolean, mixes: number): ExitFx[] {
  const recent: ExitFx[] = [];
  const played: ExitFx[] = [];
  for (let i = 0; i < mixes; i++) {
    const fx = pickSignatureFx({ mood, inLowPart, recent });
    played.push(fx);
    recent.unshift(fx);
    recent.splice(4);
  }
  return played;
}

describe('gapCutFits', () => {
  const good = { outBpm: 120, incBpm: 124, keyClash: false, entryBar: 16 };

  it('allows a bare cut when tempo, key and phrase all fit', () => {
    expect(gapCutFits(good)).toBe(true);
  });

  it('refuses the 95 to 164 BPM cut, a key clash, and an entry inside a phrase', () => {
    expect(gapCutFits({ ...good, outBpm: 95, incBpm: 164 })).toBe(false);
    expect(gapCutFits({ ...good, keyClash: true })).toBe(false);
    expect(gapCutFits({ ...good, entryBar: 17 })).toBe(false);
    expect(gapCutFits({ ...good, entryBar: 16.5 })).toBe(false);
  });
});

describe('pickSignatureFx', () => {
  it('uses all five moves on a dance floor, the filter sweep included', () => {
    expect(new Set(run('party', false, 10))).toEqual(new Set(['echo', 'filter', 'roll', 'reverb', 'brake']));
  });

  it('never plays the same move twice in a row', () => {
    const moves = run('party', false, 20);
    moves.slice(1).forEach((fx, i) => expect(fx).not.toBe(moves[i]));
  });

  it('keeps a soft move between the hard landings', () => {
    const moves = run('bhangra', false, 20);
    const hard = (fx: ExitFx) => fx === 'roll' || fx === 'brake';
    moves.forEach((fx, i) => {
      if (i >= 2 && hard(fx)) expect(hard(moves[i - 1]) || hard(moves[i - 2])).toBe(false);
    });
  });

  it('stays soft in calm moods and over quiet parts', () => {
    for (const moves of [run('chill', false, 9), run('romantic', false, 9), run('party', true, 9)]) {
      expect(moves.every((fx) => fx === 'reverb' || fx === 'echo' || fx === 'filter')).toBe(true);
      expect(new Set(moves).size).toBe(3);
    }
  });
});

describe('pickBlendFx', () => {
  function blends(mood: string, mixes: number): ExitFx[] {
    const recent: ExitFx[] = [];
    const played: ExitFx[] = [];
    for (let i = 0; i < mixes; i++) {
      const fx = pickBlendFx({ mood, recent });
      played.push(fx);
      recent.unshift(fx);
      recent.splice(4);
    }
    return played;
  }

  it('opens beatmatched mixes with a filter sweep and rotates roll and echo on a dance floor', () => {
    const moves = blends('party', 9);
    expect(moves[0]).toBe('filter');
    expect(new Set(moves)).toEqual(new Set(['filter', 'roll', 'echo']));
    moves.slice(1).forEach((fx, i) => expect(fx).not.toBe(moves[i]));
  });

  it('never rolls in a calm mood', () => {
    expect(new Set(blends('chill', 6))).toEqual(new Set(['filter', 'echo']));
  });
});
