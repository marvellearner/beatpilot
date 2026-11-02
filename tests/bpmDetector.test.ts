import { describe, expect, it } from 'vitest';
import { detectBpmFromBuffer, voteTempo } from '../src/audio/BpmDetector';

const RATE = 22050;

// A 120 s mono "song": a hit per beat of the given kind, plus a little noise. A clap song also
// gets a steady low rumble, so the low band alone can't find the pulse.
function song(bpm: number, hit: 'kick' | 'clap', seconds = 120): AudioBuffer {
  const data = new Float32Array(RATE * seconds);
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.02;
  for (let i = 0; i < data.length; i++) data[i] = noise();
  if (hit === 'clap') {
    // A steady low rumble (low-passed noise): plenty of low end, but no beat in it
    let lp = 0;
    for (let i = 0; i < data.length; i++) {
      lp += 0.01 * (noise() * 100 - lp);
      data[i] += 0.6 * lp;
    }
  }
  const beat = (60 / bpm) * RATE;
  for (let b = 0; b * beat < data.length; b++) {
    const start = Math.round(b * beat);
    for (let i = 0; i < 0.06 * RATE && start + i < data.length; i++) {
      const t = i / RATE;
      const env = Math.exp(-t * (hit === 'kick' ? 40 : 90));
      // kick: a 55 Hz thump; clap: bright noise with no low end
      data[start + i] += hit === 'kick' ? 0.8 * env * Math.sin(2 * Math.PI * 55 * t) : 0.6 * env * (noise() * 50) * (i % 2 ? 1 : -1);
    }
  }
  return { sampleRate: RATE, duration: seconds, length: data.length, numberOfChannels: 1, getChannelData: () => data } as unknown as AudioBuffer;
}

describe('detectBpmFromBuffer', () => {
  it('finds a kick-driven tempo with confidence', () => {
    const r = detectBpmFromBuffer(song(120, 'kick'));
    expect(r.bpm).toBeCloseTo(120, 0);
    expect(r.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('finds a tempo carried only by claps and hats (no kick)', () => {
    const r = detectBpmFromBuffer(song(100, 'clap'));
    expect(r.bpm).toBeCloseTo(100, 0);
    expect(r.confidence).toBeGreaterThanOrEqual(0.6);
  });
});

describe('voteTempo (whole song + 40 s stretches)', () => {
  const e = (bpm: number, confidence: number, firstDownbeatTime = 0.1) => ({ bpm, confidence, isRegularBeat: confidence >= 0.65, firstDownbeatTime });

  it('a low band confident at the wrong tempo loses to what the stretches agree on', () => {
    // real song: low 141.66 (0.97), all bands 124.03 (0.99), stretches 124 three times
    const r = voteTempo([e(141.66, 0.97), e(124.03, 0.99)], [[e(165.59, 0.5), e(82.6, 0.75)], [e(155.69, 1), e(124.02, 1)], [e(123.92, 0.95), e(124, 1)], [e(155.7, 1), e(124.02, 1)]])!;
    expect(r.bpm).toBeCloseTo(124.02, 1);
    expect(r.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('certain stretches outweigh a weak whole-song pass', () => {
    const r = voteTempo([e(158.59, 0.26), e(81, 0.2)], [[e(121.18, 0.13), e(139.94, 0.13)], [e(81.02, 1), e(81.01, 1)], [e(81.01, 1), e(81, 1)], [e(81.02, 1), e(81.01, 1)]])!;
    expect(r.bpm).toBeCloseTo(81.01, 1);
    expect(r.confidence).toBe(1);
  });

  it('a tempo every stretch confirms is trusted even if no single reading is sure', () => {
    const r = voteTempo([e(118.02, 0.35), e(118.01, 0.5)], [[e(118.02, 0.45), e(118.01, 0.52)], [e(118, 0.22), e(118, 0.58)], [e(117.92, 0.27), e(117.99, 0.58)], [e(117.98, 0.24), e(117.98, 0.5)]])!;
    expect(r.bpm).toBeCloseTo(118, 1);
    expect(r.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('a tempo the stretches disagree on is not trusted', () => {
    const r = voteTempo([e(116.38, 0.49), e(116.38, 0.49)], [[e(157.42, 0.29), e(116.9, 0.48)], [e(119.03, 0.28), e(119.02, 0.7)], [e(79.32, 0.34), e(115.85, 0.52)], [e(79.32, 0.34), e(118.42, 0.54)]])!;
    expect(r.confidence).toBeLessThan(0.6);
  });

  it('averages only readings that agree closely (124.3 and 125.06 are two readings)', () => {
    const r = voteTempo([e(124.32, 0.78), e(125.06, 1)], [[e(124.39, 0.88), e(125.07, 1)], [e(124.17, 0.92), e(125.03, 1)], [e(124.28, 0.72), e(125.04, 1)], [e(124.07, 0.53), e(125.01, 1)]])!;
    expect(r.bpm).toBeCloseTo(125.04, 1);
  });
});
