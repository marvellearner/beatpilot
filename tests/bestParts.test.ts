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

  it('allows playing beyond 1:30 (90s) when Best Parts limit is waived after cancelling next songs', () => {
    // When cancelled, latestExit is no longer clamped to 90s (1:30).
    // The song is allowed to play into later bars (e.g. 140s+) towards full duration.
    const plan = planMix({ ...base, out: song(), inc: song(), outPosition: 140, lookAheadSeconds: 30 })!;
    expect(plan.exitTime).toBeGreaterThan(140);
  });

  it('restricts exit to 90s when Best Parts limit is active and not waived', () => {
    // With latestExit clamped at 90s, the exit must not exceed 90s
    const plan = planMix({ ...base, out: song(), inc: song(), outPosition: 70, lookAheadSeconds: 30, latestExit: 90 })!;
    expect(plan.exitTime).toBeLessThanOrEqual(90);
  });

  it('does not exit prematurely before earliestExit when song is still before the 30s threshold', () => {
    // Song is at 10s, earliestExit is at 40s (30s minimum from start pos 10s)
    // lookAheadSeconds is 20s (reaches 30s, does not reach earliestExit at 40s)
    const plan = planMix({ ...base, out: song(), inc: song(), outPosition: 10, lookAheadSeconds: 20, earliestExit: 40 });
    // Must return null instead of exiting immediately at 12s
    expect(plan).toBeNull();
  });
});
