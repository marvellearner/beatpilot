import { describe, expect, it } from 'vitest';
import { OutroDetector } from '../src/audio/OutroDetector';

const RATE = 8000;

/** A mono "AudioBuffer" of `beatSeconds` of kick drums at 120 BPM, then `tailSeconds` of `tail`. */
function song(beatSeconds: number, tailSeconds: number, tail: 'talk' | 'silence' | 'beat'): AudioBuffer {
  const total = beatSeconds + tailSeconds;
  const data = new Float32Array(Math.round(total * RATE));
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < data.length; i++) {
    const t = i / RATE;
    const inBeat = t < beatSeconds || tail === 'beat';
    if (inBeat) {
      const sinceKick = t % 0.5; // a kick every beat
      const kick = sinceKick < 0.12 ? Math.sin(2 * Math.PI * 55 * t) * Math.exp(-sinceKick * 30) : 0;
      data[i] = 0.6 * kick + 0.05 * Math.sin(2 * Math.PI * 440 * t);
    } else if (tail === 'talk') {
      // Syllables: bursts of voice-band sound with pauses, no low-end pulse
      const syllable = (t * 4) % 1 < 0.55 && Math.floor(t * 4) % 5 !== 0;
      data[i] = syllable ? 0.2 * Math.sin(2 * Math.PI * 900 * t) * (0.6 + 0.4 * noise()) : 0.002 * noise();
    }
  }
  return { duration: total, sampleRate: RATE, numberOfChannels: 1, length: data.length, getChannelData: () => data } as unknown as AudioBuffer;
}

describe('OutroDetector', () => {
  it('ends the song where the beat stops when talking follows', () => {
    const r = OutroDetector.detectMusicEnd(song(150, 40, 'talk'), 120, 0);
    expect(r.cut).toBe(true);
    expect(r.musicEnd).toBeGreaterThan(146);
    expect(r.musicEnd).toBeLessThan(156);
  });

  it('ends it before trailing silence', () => {
    const r = OutroDetector.detectMusicEnd(song(150, 30, 'silence'), 120, 0);
    expect(r.cut).toBe(true);
    expect(r.musicEnd).toBeLessThan(156);
  });

  it('leaves a song whose beat runs to the end alone', () => {
    const r = OutroDetector.detectMusicEnd(song(150, 30, 'beat'), 120, 0);
    expect(r.cut).toBe(false);
    expect(r.musicEnd).toBe(180);
  });
});
