import { describe, expect, it } from 'vitest';
import { findGaps, lastLoudTime, lowParts, planMix, vocalClash, type MixSongInfo } from '../src/audio/MixPointPlanner';

const RATE = 10;

// A 200 s song at 120 BPM (2 s bars), level 1 throughout, with `shape` applied on top
function song(shape: (t: number) => number | undefined = () => undefined, extra: Partial<MixSongInfo> = {}): MixSongInfo {
  const n = 200 * RATE;
  const full = new Float32Array(n);
  const mid = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    full[i] = shape(i / RATE) ?? 1;
    mid[i] = full[i] * 0.3;
  }
  return { profile: { rate: RATE, full, mid }, bpm: 120, downbeat: 0, duration: 200, ...extra };
}

// A high point (140–150 s, louder than average) that stops dead for a second, then comes back
const stopAfterHighPoint = (t: number) => (t >= 150 && t < 151 ? 0 : t >= 140 && t < 150 ? 1.6 : undefined);

const plan = (out: MixSongInfo) =>
  planMix({ out, inc: song(), outPosition: 130, blendBeats: 32, lookAheadSeconds: 45, minLeadSeconds: 1.5, preferIncomingHook: false });

describe('findGaps', () => {
  it('finds a silence right after a high point', () => {
    const gaps = findGaps(song(stopAfterHighPoint), 100, 190);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].start).toBeCloseTo(150, 1);
    expect(gaps[0].end).toBeCloseTo(151, 1);
  });

  it('ignores a quiet spot that does not follow a high point', () => {
    const quietBefore = (t: number) => (t >= 150 && t < 151 ? 0 : t >= 140 && t < 150 ? 0.4 : undefined);
    expect(findGaps(song(quietBefore), 100, 190)).toHaveLength(0);
  });

  it('ignores silence that is too long (the song is over, not stopping)', () => {
    const longStop = (t: number) => (t >= 150 && t < 160 ? 0 : t >= 140 && t < 150 ? 1.6 : undefined);
    expect(findGaps(song(longStop), 100, 190)).toHaveLength(0);
  });
});

describe('planMix gap exits', () => {
  it('cuts into the silence after a high point, on the beat where the song comes back', () => {
    const result = plan(song(stopAfterHighPoint))!;
    expect(result.style).toBe('gap');
    expect(result.exitTime).toBeCloseTo(151, 1);
  });

  it('blends as usual when there is no gap', () => {
    expect(plan(song())!.style).toBe('blend');
  });

  it("doesn't use a stop that is the build-up to a chorus", () => {
    const result = plan(song(stopAfterHighPoint, { hookTimes: [151] }))!;
    expect(result.exitTime).not.toBeCloseTo(151, 1);
  });
});

describe('vocalClash', () => {
  const plan = (outVocals: number, incVocals: number, gap = false) => ({
    exitTime: 10,
    entryTime: 2,
    exitOptions: [{ time: 10, why: '', score: 1, vocals: outVocals, gap }],
    entryOptions: [{ time: 2, why: '', score: 1, vocals: incVocals }],
  });

  it('flags a blend where both songs sing', () => expect(vocalClash(plan(0.9, 0.8))).toBe(true));
  it('lets a blend go ahead when one side is instrumental', () => expect(vocalClash(plan(1, 0.2))).toBe(false));
  it('never flags a cut into the silence', () => expect(vocalClash(plan(1, 1, true))).toBe(false));
});

describe('fade-outs', () => {
  // The music ends at 180 s; the file runs on, fading, to 200 s
  const fading = (t: number) => (t >= 180 ? 0.15 * Math.max(0, (200 - t) / 20) : undefined);

  it('finds where the music ends', () => {
    expect(lastLoudTime(song(fading), 2)).toBeCloseTo(181, 0); // the last bar still mostly before the fade
  });

  it("doesn't wait into the old song's fade-out", () => {
    const result = planMix({ out: song(fading), inc: song(), outPosition: 160, blendBeats: 4, lookAheadSeconds: 45, minLeadSeconds: 1.5, preferIncomingHook: false })!;
    expect(result.exitTime).toBeLessThanOrEqual(182);
  });
});

describe('high parts', () => {
  // Low parts at 0.5, choruses at 1.2
  const twoChoruses = (t: number) => (t >= 100 && t < 120) || (t >= 140 && t < 170) ? 1.2 : 0.5;
  const mixAt = (out: MixSongInfo, outPosition: number, blendBeats = 32) =>
    planMix({ out, inc: song(), outPosition, blendBeats, lookAheadSeconds: 45, minLeadSeconds: 1.5, preferIncomingHook: false })!;

  it("doesn't leave in a chorus or just before one: it waits for the chorus to end", () => {
    const result = mixAt(song(twoChoruses), 135);
    expect(result.exitTime).toBeCloseTo(170, 0);
    expect(result.reason).toContain('high part just ended');
    expect(lowParts(result).exit).toBe(true);
  });

  it('looks past the 45 s window when the high part lasts longer', () => {
    // The chorus runs past the 45 s window (to 177 s) and ends at 180 s
    const longChorus = (t: number) => (t >= 130 && t < 180 ? 1.2 : 0.5);
    expect(mixAt(song(longChorus), 132).exitTime).toBeCloseTo(180, 0);
  });

  it('leaves in a low part right away when one is playing', () => {
    const result = mixAt(song(twoChoruses), 121, 8);
    expect(result.exitTime).toBeLessThan(140);
    expect(lowParts(result).exit).toBe(true);
  });
});

describe('Best Parts play limit', () => {
  const longChorus = (t: number) => (t >= 130 && t < 180 ? 1.2 : 0.5);
  const limited = (latestExit: number, outPosition = 132) =>
    planMix({ out: song(longChorus), inc: song(), outPosition, blendBeats: 32, lookAheadSeconds: 45, minLeadSeconds: 1.5, preferIncomingHook: false, latestExit })!;

  it("doesn't wait past the limit for a high part to end", () => {
    // Without the limit it waits for the chorus to end at 180 s (see "high parts")
    const result = limited(160);
    expect(result.exitTime).toBeLessThanOrEqual(160 - 16 / 2); // half the 16 s blend before the limit
  });

  it('still leaves at the next bar when the limit has already passed', () => {
    const result = limited(100);
    expect(result).not.toBeNull();
    expect(result.exitTime).toBeLessThanOrEqual(132 + 1.5 + 2 + 0.01);
  });
});
