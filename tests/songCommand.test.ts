import { describe, expect, it } from 'vitest';
import { parseSongCommand } from '../src/ai/DJAgent';

describe('parseSongCommand', () => {
  it('"only <artist>" in its usual phrasings', () => {
    for (const text of ['Play only Diljit Dosanjh songs', 'only diljit dosanjh', 'just Diljit Dosanjh please', 'Diljit Dosanjh songs only', 'play nothing but Diljit Dosanjh']) {
      const plan = parseSongCommand(text)!;
      expect(plan.action).toBe('queue_control');
      expect(plan.queue).toEqual({ focus_artists: [expect.stringMatching(/^diljit dosanjh$/i)], only: true });
    }
  });

  it('several artists and "more <artist>"', () => {
    expect(parseSongCommand('play only Karan Aujla and AP Dhillon')!.queue!.focus_artists).toEqual(['Karan Aujla', 'AP Dhillon']);
    expect(parseSongCommand('play more Shubh songs')!.queue).toEqual({ focus_artists: ['Shubh'], only: false });
  });

  it('back to normal', () => {
    for (const text of ['play anything', 'back to normal', 'clear the filter', 'play all artists again']) {
      expect(parseSongCommand(text)!.queue).toEqual({ clear_focus: true });
    }
  });

  it('a song to play now', () => {
    expect(parseSongCommand('play Lover by Diljit Dosanjh')!.queue).toEqual({ play_song: 'Lover Diljit Dosanjh' });
  });

  it('leaves mixing, drums and EQ to the model', () => {
    for (const text of ['kill the bass on deck A', 'start the dhol', 'pause deck B', 'smooth crossfade into deck A']) {
      expect(parseSongCommand(text)).toBeNull();
    }
  });
});

describe('parseSongCommand: typos, Hindi and short names', () => {
  it('reads past a misspelt "songs" and Hindi song-words', () => {
    expect(parseSongCommand('Play only kk osngs')!.queue).toEqual({ focus_artists: ['kk'], only: true });
    expect(parseSongCommand('only arijit singh sogns')!.queue).toEqual({ focus_artists: ['arijit singh'], only: true });
    expect(parseSongCommand('sirf kk ke gaane chalao')!.queue).toEqual({ focus_artists: ['kk'], only: true });
  });
});

describe('parseSongCommand: kinds of songs', () => {
  const q = (t: string) => parseSongCommand(t)?.queue;
  it('vibe, language and era are a filter, not an artist', () => {
    expect(q('I want to play only dance songs')).toEqual({ focus_artists: undefined, only: true, vibe: 'dance' });
    expect(q('only punjabi songs')).toEqual({ focus_artists: undefined, only: true, language: 'punjabi' });
    expect(q('play more old romantic bollywood songs')).toEqual({ focus_artists: undefined, only: false, vibe: 'romantic', language: 'hindi', era: 'old' });
    expect(q('play party songs')).toEqual({ focus_artists: undefined, only: false, vibe: 'dance' });
  });
  it('combines with artists', () => {
    expect(q('only Diljit Dosanjh dance songs')).toEqual({ focus_artists: ['Diljit Dosanjh'], only: true, vibe: 'dance' });
  });
  it('leaves song titles with those words alone', () => {
    expect(q('play Love Dose')).toEqual({ play_song: 'Love Dose' });
  });
});
