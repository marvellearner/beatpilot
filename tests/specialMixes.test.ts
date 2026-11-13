import { describe, expect, it } from 'vitest';
import { dropPoint, overlayCue, overlayFaderAt, OVERLAY_BARS, pickSpecialMix, SPECIAL_MIX_EVERY } from '../src/audio/engine/specialMixes';

const bar = 240 / 120; // 2 s at 120 BPM
const song = (extra: object = {}) => ({ bpm: 120, duration: 240, musicStartTime: 4, highlightTime: 60, ...extra });

describe('dropPoint', () => {
  it('prefers the detected drop, then the first chorus, then the hook', () => {
    expect(dropPoint(song({ hooks: [{ time: 50, kind: 'chorus' }, { time: 90, kind: 'drop' }] }))).toBe(90);
    expect(dropPoint(song({ hooks: [{ time: 50, kind: 'chorus' }, { time: 110, kind: 'chorus' }] }))).toBe(50);
    expect(dropPoint(song())).toBe(60);
  });

  it('refuses a drop in the intro or too near the end', () => {
    expect(dropPoint(song({ highlightTime: 8, hooks: [] }))).toBeUndefined();
    expect(dropPoint(song({ highlightTime: 200, hooks: [] }))).toBeUndefined();
    expect(dropPoint({ duration: 240, highlightTime: 60 })).toBeUndefined(); // no tempo, no bars
  });
});

describe('overlayCue', () => {
  it('starts the vocals OVERLAY_BARS before the first chorus', () => {
    expect(overlayCue(song({ hooks: [{ time: 60, kind: 'chorus' }] }))).toEqual({ cue: 60 - OVERLAY_BARS * bar, chorus: 60 });
  });

  it('never starts in the intro (Naina: chorus at 0:30, the vocals would start at 0:12)', () => {
    expect(overlayCue({ bpm: 104.8, duration: 160, musicStartTime: 0, hooks: [{ time: 30, kind: 'chorus' }] })).toBeUndefined();
  });

  it('needs room before the chorus', () => {
    expect(overlayCue(song({ hooks: [{ time: 12, kind: 'chorus' }] }))).toBeUndefined();
  });
});

describe('pickSpecialMix', () => {
  const base = { mood: 'party', matched: true, keyFit: 'good' as const, hasDrop: true, hasOverlay: true, mixesSince: SPECIAL_MIX_EVERY, last: null };

  it('waits SPECIAL_MIX_EVERY mixes between special mixes', () => {
    expect(pickSpecialMix({ ...base, mixesSince: SPECIAL_MIX_EVERY - 2 })).toBeNull();
    expect(pickSpecialMix({ ...base, mixesSince: SPECIAL_MIX_EVERY - 1 })).not.toBeNull();
  });

  it('takes turns between the drop mix and the vocal overlay', () => {
    expect(pickSpecialMix({ ...base, last: null })).toBe('drop');
    expect(pickSpecialMix({ ...base, last: 'drop' })).toBe('overlay');
    expect(pickSpecialMix({ ...base, last: 'overlay' })).toBe('drop');
  });

  it('drops whatever the tempos, overlays only beatmatched songs whose keys do not clash', () => {
    expect(pickSpecialMix({ ...base, matched: false, last: 'drop' })).toBe('drop');
    expect(pickSpecialMix({ ...base, hasDrop: false, keyFit: 'clash' })).toBeNull();
    expect(pickSpecialMix({ ...base, hasDrop: false, matched: false })).toBeNull();
    expect(pickSpecialMix({ ...base, hasDrop: false, keyFit: 'ok' })).toBe('overlay');
    // An unknown key let Naina (7A) sing over Never Fold (1B): no overlay without keys known to fit
    expect(pickSpecialMix({ ...base, hasDrop: false, keyFit: 'unknown' })).toBeNull();
  });

  it('never drops in a calm mood, but can overlay', () => {
    expect(pickSpecialMix({ ...base, mood: 'romantic' })).toBe('overlay');
  });
});

describe('overlayFaderAt', () => {
  it('moves to the middle, holds both songs there, then goes over at the reveal', () => {
    const at = overlayFaderAt(-1, 1, 0.9);
    expect(at(0)).toBe(-1);
    expect(at(0.3)).toBe(0);
    expect(at(0.89)).toBe(0);
    expect(at(0.9)).toBe(1);
  });
});
