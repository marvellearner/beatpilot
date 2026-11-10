import { describe, expect, it } from 'vitest';
import { pickSignatureFx } from '../src/audio/engine/signatureFx';
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

describe('pickSignatureFx', () => {
  it('uses all four moves on a dance floor', () => {
    expect(new Set(run('party', false, 8))).toEqual(new Set(['echo', 'roll', 'reverb', 'brake']));
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
    for (const moves of [run('chill', false, 8), run('romantic', false, 8), run('party', true, 8)]) {
      expect(moves.every((fx) => fx === 'reverb' || fx === 'echo')).toBe(true);
      expect(new Set(moves).size).toBe(2);
    }
  });
});
