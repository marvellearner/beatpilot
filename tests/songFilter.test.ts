import { describe, expect, it } from 'vitest';
import { describeFilter, fitsFilter } from '../shared/songFilter';

describe('fitsFilter', () => {
  const dance = { artists: [], only: true, vibe: 'dance' as const };
  it('dance: no slow versions, nothing with a steady slow beat', () => {
    expect(fitsFilter(dance, { title: 'Diljit Dosanjh - G.O.A.T.', artist: 'Diljit Dosanjh' })).toBe(true);
    expect(fitsFilter(dance, { title: 'Tum Hi Ho (Unplugged)', artist: 'Arijit Singh' })).toBe(false);
    expect(fitsFilter(dance, { title: 'Lover (Slowed + Reverb)', artist: 'x' })).toBe(false);
    expect(fitsFilter(dance, { title: 'Some Ballad', artist: 'x', bpm: 72, bpmConfidence: 0.8 })).toBe(false);
    expect(fitsFilter(dance, { title: 'Some Ballad', artist: 'x', bpm: 72, bpmConfidence: 0.3 })).toBe(true);
  });
  it('language: Punjabi needs a sure sign, English only not another language', () => {
    const punjabi = { artists: [], only: true, language: 'punjabi' as const };
    expect(fitsFilter(punjabi, { title: 'Softly', artist: 'Karan Aujla' })).toBe(true);
    expect(fitsFilter(punjabi, { title: 'Shape of You', artist: 'Ed Sheeran' })).toBe(false);
    const english = { artists: [], only: true, language: 'english' as const };
    expect(fitsFilter(english, { title: 'Shape of You', artist: 'Ed Sheeran' })).toBe(true);
    expect(fitsFilter(english, { title: 'Softly', artist: 'Karan Aujla' })).toBe(false);
  });
  it('romantic: no party versions', () => {
    const romantic = { artists: [], only: true, vibe: 'romantic' as const };
    expect(fitsFilter(romantic, { title: 'Tum Hi Ho', artist: 'Arijit Singh' })).toBe(true);
    expect(fitsFilter(romantic, { title: 'Tum Hi Ho (DJ Remix)', artist: 'x' })).toBe(false);
  });
  it('describes itself', () => {
    expect(describeFilter(dance)).toBe('Only dance songs');
    expect(describeFilter({ artists: ['Diljit Dosanjh'], only: true, vibe: 'dance', language: 'punjabi' })).toBe('Only Punjabi dance songs by Diljit Dosanjh');
    expect(describeFilter({ artists: [], only: false, language: 'hindi', era: 'old' })).toBe('More old Bollywood songs');
  });
});
