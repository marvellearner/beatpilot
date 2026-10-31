import { describe, expect, it } from 'vitest';
import { chooseNext, tempoStep, type FlowCandidate, type FlowContext } from '../src/audio/engine/setFlow';

const song = (title: string, artist: string, extra: Partial<FlowCandidate> = {}): FlowCandidate => ({
  title, artist, bpm: 120, loudnessDb: -9, language: 'punjabi', requested: false, keyFit: 'unknown', ...extra,
});
const ctx = (extra: Partial<FlowContext> = {}): FlowContext => ({
  current: { title: 'Lover', artist: 'Diljit Dosanjh', bpm: 120, loudnessDb: -9, language: 'punjabi' },
  recentArtists: [],
  languageRun: 1,
  danceFloor: true,
  ...extra,
});

describe('set flow', () => {
  it('keeps the queue order when the next song flows fine', () => {
    const ready = [song('Softly', 'Karan Aujla'), song('Baller', 'Shubh')];
    expect(chooseNext(ready, ctx()).pick.title).toBe('Softly');
  });

  it('skips the same artist twice in a row', () => {
    const ready = [song('G.O.A.T.', 'Diljit Dosanjh'), song('Softly', 'Karan Aujla')];
    const r = chooseNext(ready, ctx());
    expect(r.pick.title).toBe('Softly');
    expect(r.reason).toContain('same artist');
  });

  it('prefers a fitting key and a small tempo step over a clash and a jump', () => {
    const ready = [song('A', 'X', { keyFit: 'clash', bpm: 150 }), song('B', 'Y', { keyFit: 'good', bpm: 122 })];
    expect(chooseNext(ready, ctx()).pick.title).toBe('B');
  });

  it("doesn't deflate a dance floor with a much quieter song", () => {
    const ready = [song('Quiet', 'X', { loudnessDb: -15 }), song('Loud', 'Y')];
    expect(chooseNext(ready, ctx()).pick.title).toBe('Loud');
    expect(chooseNext(ready, ctx({ danceFloor: false })).pick.title).toBe('Quiet');
  });

  it('keeps a language run going before switching', () => {
    const ready = [song('Shape of You', 'Ed Sheeran', { language: 'english' }), song('Baller', 'Shubh')];
    expect(chooseNext(ready, ctx({ languageRun: 1 })).pick.title).toBe('Baller');
    expect(chooseNext(ready, ctx({ languageRun: 3 })).pick.title).toBe('Shape of You');
  });

  it('never skips a guest request', () => {
    const ready = [song('Request', 'Diljit Dosanjh', { requested: true, keyFit: 'clash' }), song('B', 'Y', { keyFit: 'good' })];
    expect(chooseNext(ready, ctx()).pick.title).toBe('Request');
  });

  it('measures tempo steps with half / double time', () => {
    expect(tempoStep(120, 60)).toBe(0);
    expect(tempoStep(120, 126)).toBeCloseTo(0.05);
  });
});
