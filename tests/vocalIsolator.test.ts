import { describe, expect, it } from 'vitest';
import { createVocalIsolator, VOCAL_ISOLATOR_LATENCY } from '../src/audio/engine/vocalIsolator';

const SR = 44100;
const SECONDS = 3;
const LEN = SR * SECONDS;

/** The isolator's output for a stereo signal, skipping the first second (its memory filling up). */
function run(left: Float32Array, right: Float32Array = left): Float32Array {
  const isolator = createVocalIsolator(SR);
  const out = new Float32Array(LEN);
  const block = new Float32Array(128);
  for (let p = 0; p + 128 <= LEN; p += 128) {
    isolator.process(left.subarray(p, p + 128), right.subarray(p, p + 128), block);
    out.set(block, p);
  }
  return out;
}

const db = (out: Float32Array, ref: Float32Array) => {
  const energy = (a: Float32Array) => a.subarray(SR).reduce((s, v) => s + v * v, 0) + 1e-12;
  return 10 * Math.log10(energy(out) / energy(ref));
};

function fill(sample: (i: number) => number): Float32Array {
  return Float32Array.from({ length: LEN }, (_, i) => sample(i));
}

/** A voice-like tone: harmonics of a pitch that keeps moving (vibrato and glides). */
const voice = fill((i) => {
  const t = i / SR;
  const phase = 2 * Math.PI * (220 * t + 40 * t * Math.sin(1.1 * t) + 2.2 * Math.sin(2 * Math.PI * 5.5 * t));
  return 0.1 * (Math.sin(phase) + 0.7 * Math.sin(2 * phase) + 0.5 * Math.sin(3 * phase) + 0.3 * Math.sin(4 * phase));
});
const held = fill((i) => {
  const phase = (2 * Math.PI * 220 * i) / SR;
  return 0.1 * (Math.sin(phase) + 0.7 * Math.sin(2 * phase) + 0.5 * Math.sin(3 * phase) + 0.3 * Math.sin(4 * phase));
});
let seed = 1;
const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const hits = fill((i) => {
  const sinceHit = i % Math.round(SR / 4);
  return sinceHit < 2000 ? noise() * 0.4 * Math.exp(-sinceHit / 400) : 0;
});
const bass = fill((i) => 0.4 * Math.sin((2 * Math.PI * 60 * i) / SR));
const silence = new Float32Array(LEN);

describe('createVocalIsolator', () => {
  it('keeps a centred, moving voice at about its own level', () => {
    expect(db(run(voice), voice)).toBeGreaterThan(-8);
  });

  it('takes out what a voice is not, far more than the voice', () => {
    const kept = db(run(voice), voice);
    expect(db(run(held), held)).toBeLessThan(kept - 6); // a held harmonium note
    expect(db(run(hits), hits)).toBeLessThan(kept - 6); // dhol and snare hits
    expect(db(run(voice, silence), voice)).toBeLessThan(kept - 12); // panned hard to one side
    expect(db(run(bass), bass)).toBeLessThan(-40); // bass, outside the voice range
  });

  it('delays the voice by exactly the declared latency', () => {
    const out = run(voice);
    let best = -Infinity;
    let lag = 0;
    for (let d = 800; d < 1300; d++) {
      let c = 0;
      for (let i = SR; i < SR * 2; i += 2) c += voice[i] * out[i + d];
      if (c > best) {
        best = c;
        lag = d;
      }
    }
    expect(lag).toBe(VOCAL_ISOLATOR_LATENCY);
  });

  it('can be sent to the audio thread: its source stands alone', () => {
    const rebuilt = new Function(`return (${createVocalIsolator.toString()})`)() as typeof createVocalIsolator;
    const a = new Float32Array(128).fill(0.1);
    expect(() => rebuilt(SR).process(a, a, new Float32Array(128))).not.toThrow();
  });
});
