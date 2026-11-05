import { describe, expect, it } from 'vitest';
import { vocalFocusGains } from '../src/audio/engine/VocalFocus';

describe('vocalFocusGains (the "Music" fader)', () => {
  it('plays the song untouched at 100 % and only the vocal path at 0 %', () => {
    expect(vocalFocusGains(1)).toEqual({ dry: 1, vocal: 0 });
    const vocalsOnly = vocalFocusGains(0);
    expect(vocalsOnly.dry).toBe(0);
    expect(vocalsOnly.vocal).toBeGreaterThan(0);
  });

  it('turns the music down and the vocal path up as the fader goes down', () => {
    let prev = vocalFocusGains(1);
    for (const level of [0.75, 0.5, 0.25, 0]) {
      const g = vocalFocusGains(level);
      expect(g.dry).toBeLessThan(prev.dry);
      expect(g.vocal).toBeGreaterThan(prev.vocal);
      prev = g;
    }
  });

  it('clamps values outside 0…1', () => {
    expect(vocalFocusGains(2)).toEqual(vocalFocusGains(1));
    expect(vocalFocusGains(-1)).toEqual(vocalFocusGains(0));
  });
});
