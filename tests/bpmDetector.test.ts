import { describe, expect, it } from 'vitest';
import { detectBpmFromBuffer } from '../src/audio/BpmDetector';

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
