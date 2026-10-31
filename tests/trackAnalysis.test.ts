import { describe, expect, it } from 'vitest';
import { analysisComplete, runAnalysis, AnalysisFields } from '../src/audio/analysis/trackAnalysis';
import { analysisKey } from '../src/audio/analysis/analysisCache';

// 60 s at 120 BPM: a kick on every beat over a tone
function song(seconds = 60, sr = 22050): AudioBuffer {
  const data = new Float32Array(seconds * sr);
  for (let i = 0; i < data.length; i++) {
    const t = i / sr;
    data[i] = 0.2 * Math.sin(2 * Math.PI * 220 * t) + (t % 0.5 < 0.04 ? Math.sin(2 * Math.PI * 60 * t) : 0);
  }
  return { sampleRate: sr, length: data.length, duration: seconds, numberOfChannels: 1, getChannelData: () => data } as unknown as AudioBuffer;
}

describe('runAnalysis', () => {
  it('fills in every field', () => {
    const f: AnalysisFields = {};
    runAnalysis(song(), f, false);
    expect(analysisComplete(f)).toBe(true);
    expect(f.bpm).toBeGreaterThan(0);
  });

  it('keeps what is already known and does nothing more when complete', () => {
    const buffer = song();
    const f: AnalysisFields = {};
    runAnalysis(buffer, f, false);
    const before = { ...f };
    const { intro } = runAnalysis(buffer, f, false);
    expect(intro).toBeUndefined();
    expect(f).toEqual(before);
  });

  it('a strict song starts at 0:00', () => {
    const f: AnalysisFields = {};
    runAnalysis(song(), f, true);
    expect(f.musicStartTime).toBe(0);
    expect(f.cueInTime).toBe(0);
  });
});

describe('analysisKey', () => {
  it('is the same song for the same source and length, different otherwise', () => {
    const a = analysisKey({ url: 'https://x/watch?v=AbC', title: 'Song' }, 200.2);
    expect(analysisKey({ url: 'https://x/watch?v=AbC', title: 'Other' }, 199.8)).toBe(a);
    expect(analysisKey({ url: 'https://x/watch?v=AbC', title: 'Song' }, 230)).not.toBe(a);
    expect(analysisKey({ title: 'Song', artist: 'A' }, 200)).not.toBe(analysisKey({ title: 'Song', artist: 'B' }, 200));
  });
});
