import { describe, expect, it } from 'vitest';
import { planMix, type MixSongInfo } from '../src/audio/MixPointPlanner';

const BPM = 120; // a bar is 2 s
const BAR = 2;

/** A 200 s song with a flat level and a louder chorus from 80 s (its hook) to 112 s. */
function song(): MixSongInfo {
  const rate = 10;
  const full = new Float32Array(200 * rate).fill(0.3);
  const mid = new Float32Array(200 * rate).fill(0.1);
  for (let i = 80 * rate; i < 112 * rate; i++) full[i] = 0.6;
  return { profile: { rate, full, mid }, bpm: BPM, downbeat: 0, duration: 200, hookTime: 80, musicStartTime: 0 };
}

const base = { blendBeats: 16, minLeadSeconds: 1.5, preferIncomingHook: false } as const; // a 4-bar (8 s) blend

describe('planMix in Best Parts mode', () => {
  it('enters in the build-up before the hook, with the blend over before the hook hits', () => {
    const plan = planMix({ ...base, out: song(), inc: song(), outPosition: 100, lookAheadSeconds: 40, entryRange: { from: 80 - 16 * BAR, to: 80 - 4 * BAR } })!;
    expect(plan.entryTime).toBeGreaterThanOrEqual(48);
    expect(plan.entryTime).toBeLessThanOrEqual(72);
    expect(plan.entryTime + 8).toBeLessThanOrEqual(80);
    expect(plan.reason).toContain('before its hook (best part)');
  });

  it('enters at the intro without a range', () => {
    const plan = planMix({ ...base, out: song(), inc: song(), outPosition: 100, lookAheadSeconds: 40 })!;
    expect(plan.entryTime).toBeLessThanOrEqual(16);
  });

  it('never leaves before the earliest exit', () => {
    const plan = planMix({ ...base, out: song(), inc: song(), outPosition: 100, lookAheadSeconds: 44, earliestExit: 112 })!;
    expect(plan.exitTime).toBeGreaterThanOrEqual(112);
    expect(plan.exitOptions.every((o) => o.time >= 112)).toBe(true);
  });

  it('mixes at the next good bar once the exit window has passed', () => {
    const plan = planMix({ ...base, out: song(), inc: song(), outPosition: 150, lookAheadSeconds: 30, earliestExit: 112 })!;
    expect(plan.exitTime).toBeGreaterThan(150);
    expect(plan.exitTime).toBeLessThanOrEqual(180);
  });
});
