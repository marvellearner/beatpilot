import { describe, expect, it } from 'vitest';
import { IntroSkitDetector } from '../src/audio/IntroSkitDetector';

const RATE = 8000;

/** A mono "AudioBuffer" built from parts: kick drums at 120 BPM, talking (no bass), or silence. */
function song(parts: Array<['beat' | 'talk', number]>): AudioBuffer {
  const total = parts.reduce((s, [, sec]) => s + sec, 0);
  const data = new Float32Array(Math.round(total * RATE));
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  let start = 0;
  for (const [kind, sec] of parts) {
    for (let i = Math.round(start * RATE); i < Math.round((start + sec) * RATE); i++) {
      const t = i / RATE;
      if (kind === 'beat') {
        const sinceKick = t % 0.5;
        const kick = sinceKick < 0.12 ? Math.sin(2 * Math.PI * 55 * t) * Math.exp(-sinceKick * 30) : 0;
        data[i] = 0.6 * kick + 0.05 * Math.sin(2 * Math.PI * 440 * t);
      } else {
        // Syllables: bursts of voice-band sound with pauses, no low-end pulse
        const syllable = (t * 4) % 1 < 0.55 && Math.floor(t * 4) % 5 !== 0;
        data[i] = syllable ? 0.2 * Math.sin(2 * Math.PI * 900 * t) * (0.6 + 0.4 * noise()) : 0.002 * noise();
      }
    }
    start += sec;
  }
  return { duration: total, sampleRate: RATE, numberOfChannels: 1, length: data.length, getChannelData: () => data } as unknown as AudioBuffer;
}

describe('IntroSkitDetector', () => {
  it('skips talking before the music', () => {
    const r = IntroSkitDetector.detectMusicStart(song([['talk', 30], ['beat', 150]]), 120, 0);
    expect(r.hasConversationPreamble).toBe(true);
    // (the first-hit refinement can land a few seconds early on synthetic talk; real songs are checked by hand)
    expect(r.suggestedMusicStart).toBeGreaterThan(20);
    expect(r.suggestedMusicStart).toBeLessThan(33);
  });

  it('skips the talk after a short musical sting too (like "5-7")', () => {
    const r = IntroSkitDetector.detectMusicStart(song([['beat', 8], ['talk', 30], ['beat', 150]]), 120, 0);
    expect(r.hasConversationPreamble).toBe(true);
    expect(r.suggestedMusicStart).toBeGreaterThan(35);
    expect(r.suggestedMusicStart).toBeLessThan(42);
  });

  it('plays a song whose beat starts at once from the start', () => {
    const r = IntroSkitDetector.detectMusicStart(song([['beat', 180]]), 120, 0);
    expect(r.suggestedMusicStart).toBe(0);
  });
});
