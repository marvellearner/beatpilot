import { describe, expect, it } from 'vitest';
import { beatOffset } from '../src/audio/analysis/beatPhase';

// 10 s of a song as a 5 ms loudness envelope: a kick every beat (shifted by `shift` s),
// optional hats between, a little noise
const HOP = 0.005;
const BEAT = 0.5;
function song(shift: number, seed: number, hats = false, t0 = 0): Float64Array {
  let r = seed;
  const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
  const n = Math.round(10 / HOP);
  const e = new Float64Array(n);
  for (let f = 0; f < n; f++) {
    const t = t0 + f * HOP - shift;
    const ph = ((t % BEAT) + BEAT) % BEAT;
    e[f] = 0.05 + 0.03 * rnd() + (ph < 0.03 ? 1 - ph / 0.03 : 0) + (hats && Math.abs(ph - BEAT / 2) < 0.01 ? 0.4 : 0);
  }
  return e;
}

describe('beatOffset', () => {
  it.each([0, 0.02, 0.04, -0.06, 0.11, -0.2])('measures a %s s offset between two songs', (shift) => {
    const r = beatOffset(song(0, 7), song(shift, 99, true), 0, HOP, BEAT);
    expect(r.offsetSec).toBeCloseTo(shift, 2);
    expect(r.clarity).toBeGreaterThan(2);
  });

  it('works on the audio clock (frames starting at any time)', () => {
    const r = beatOffset(song(0, 7, false, 123.4567), song(0.05, 99, true, 123.4567), 123.4567, HOP, BEAT);
    expect(r.offsetSec).toBeCloseTo(0.05, 2);
  });
});
