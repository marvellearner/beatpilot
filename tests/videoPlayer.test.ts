import { describe, expect, it } from 'vitest';
import { extractYouTubeVideoId, calculateTransitionOpacities } from '../src/renderer/components/SyncedVideoPlayer';

describe('extractYouTubeVideoId', () => {
  it('extracts videoId from full youtube.com/watch URL', () => {
    expect(extractYouTubeVideoId({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeVideoId({ url: 'https://music.youtube.com/watch?v=7wtfhZwyrcc&feature=share' })).toBe('7wtfhZwyrcc');
  });

  it('extracts videoId from youtu.be short URL', () => {
    expect(extractYouTubeVideoId({ url: 'https://youtu.be/dQw4w9WgXcQ?t=42' })).toBe('dQw4w9WgXcQ');
  });

  it('extracts videoId from youtube shorts and embed URLs', () => {
    expect(extractYouTubeVideoId({ url: 'https://www.youtube.com/shorts/cQq6iLF66Gc' })).toBe('cQq6iLF66Gc');
    expect(extractYouTubeVideoId({ url: 'https://www.youtube.com/embed/cQq6iLF66Gc' })).toBe('cQq6iLF66Gc');
  });

  it('extracts videoId when track id is itself an 11-character YouTube ID', () => {
    expect(extractYouTubeVideoId({ id: 'cQq6iLF66Gc' })).toBe('cQq6iLF66Gc');
  });

  it('extracts videoId from YouTube thumbnail URL when url is absent or search query', () => {
    expect(extractYouTubeVideoId({ thumbnail: 'https://i.ytimg.com/vi/cQq6iLF66Gc/hqdefault.jpg' })).toBe('cQq6iLF66Gc');
    expect(extractYouTubeVideoId({ thumbnail: 'https://img.youtube.com/vi_webp/7wtfhZwyrcc/mqdefault.webp' })).toBe('7wtfhZwyrcc');
  });

  it('returns null for local songs or missing identifiers', () => {
    expect(extractYouTubeVideoId({ url: 'local:my-song-file.mp3', id: 'local:123' })).toBe(null);
    expect(extractYouTubeVideoId(null)).toBe(null);
    expect(extractYouTubeVideoId({})).toBe(null);
  });
});

describe('calculateTransitionOpacities', () => {
  it('returns 1 active, 0 incoming and 0 filler when not transitioning', () => {
    const res = calculateTransitionOpacities(false, 0.5, true, true);
    expect(res.activeOpacity).toBe(1);
    expect(res.incomingOpacity).toBe(0);
    expect(res.fillerOpacity).toBe(0);
  });

  it('peaks filler video in the middle of transition when both tracks have video', () => {
    // Start of transition (progress 0)
    const atStart = calculateTransitionOpacities(true, 0, true, true);
    expect(atStart.fillerOpacity).toBeCloseTo(0, 2);
    expect(atStart.activeOpacity).toBe(1);

    // Midpoint of transition (progress 0.5)
    const atMid = calculateTransitionOpacities(true, 0.5, true, true);
    expect(atMid.fillerOpacity).toBeCloseTo(1.0, 2); // 100% full filler video!
    expect(atMid.activeOpacity).toBeLessThan(0.4);

    // End of transition (progress 1.0)
    const atEnd = calculateTransitionOpacities(true, 1.0, true, true);
    expect(atEnd.fillerOpacity).toBeCloseTo(0, 2);
    expect(atEnd.incomingOpacity).toBe(1);
  });

  it('bridges gap completely when neither song has a video', () => {
    const res = calculateTransitionOpacities(true, 0.5, false, false);
    expect(res.fillerOpacity).toBe(1);
  });

  it('fades filler smoothly when only incoming song has video', () => {
    const atStart = calculateTransitionOpacities(true, 0, false, true);
    expect(atStart.fillerOpacity).toBe(1);

    const atEnd = calculateTransitionOpacities(true, 1, false, true);
    expect(atEnd.fillerOpacity).toBe(0);
  });
});

