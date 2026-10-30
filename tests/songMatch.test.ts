import { describe, expect, it } from 'vitest';
import { areSongsConsecutivelySame, cleanCoreTitle, is8dOrMashupSong, is8dSong, isMashupSong, isSameSong, isStrictStartSong, songKeys, type SongRef } from '../src/audio/songMatch';

const same = (a: SongRef, b: SongRef) => isSameSong(songKeys(a), songKeys(b));

describe('cleanCoreTitle', () => {
  it('drops "(Official Video)"-style extras and the artist prefix', () => {
    expect(cleanCoreTitle('Diljit Dosanjh - Lover (Official Music Video)')).toBe('lover');
    expect(cleanCoreTitle('Brown Munde [Lyrics]')).toBe('brownmunde');
  });
});

describe('isSameSong', () => {
  it('matches the same video id written differently', () => {
    expect(same({ title: 'A', url: 'https://youtu.be/kJQP7kiw5Fk' }, { title: 'B', url: 'https://www.youtube.com/watch?v=kJQP7kiw5Fk' })).toBe(true);
  });

  it('matches my_songs.txt style names against YouTube titles', () => {
    expect(same({ title: 'Diljit Dosanjh - Lover' }, { title: 'Lover (Official Video)', artist: 'Diljit Dosanjh' })).toBe(true);
  });

  it('keeps different songs apart', () => {
    expect(same({ title: 'Softly', artist: 'Karan Aujla' }, { title: 'Brown Munde', artist: 'AP Dhillon' })).toBe(false);
  });
});

// Formerly test_top_bangers.mjs: Top Bangers must leave out songs queued, played or on air
describe('top bangers filter', () => {
  const inAny = (song: SongRef, lists: SongRef[]) => lists.some((o) => same(song, o));
  const queue = [{ id: 'q1', title: 'Song In Queue (Official Video)', artist: 'Artist A', url: 'https://youtube.com/watch?v=11111111111' }];
  const playLog = [{ id: 'p1', title: 'Song In History', artist: 'Artist B', url: 'https://youtube.com/watch?v=22222222222' }];
  const onAir = { id: 'd1', title: 'Song On Air', artist: 'Artist C', url: 'https://youtube.com/watch?v=33333333333' };
  const bangers = [
    { id: 'b1', title: 'Song In Queue', artist: 'Artist A', url: 'https://youtube.com/watch?v=11111111111' },
    { id: 'b2', title: 'Song In History', artist: 'Artist B', url: 'https://youtube.com/watch?v=22222222222' },
    { id: 'b3', title: 'Song On Air', artist: 'Artist C', url: 'https://youtube.com/watch?v=33333333333' },
    { id: 'b4', title: 'Fresh Banger', artist: 'Artist D', url: 'https://youtube.com/watch?v=44444444444' },
  ];

  it('keeps only the fresh song', () => {
    const fresh = bangers.filter((b) => !inAny(b, [...queue, ...playLog, onAir]));
    expect(fresh.map((b) => b.title)).toEqual(['Fresh Banger']);
  });
});

describe('areSongsConsecutivelySame', () => {
  it('treats a re-titled upload of the same song as the same', () => {
    expect(areSongsConsecutivelySame({ title: 'Lover' }, { title: 'lover ' })).toBe(true);
    expect(areSongsConsecutivelySame({ title: 'Lover' }, { title: 'Softly' })).toBe(false);
    expect(areSongsConsecutivelySame(null, { title: 'Softly' })).toBe(false);
  });
});

describe('isStrictStartSong', () => {
  it('correctly identifies Ping Pong Tremor mashup and variants', () => {
    expect(isStrictStartSong({ title: 'Ping Pong Tremor' })).toBe(true);
    expect(isStrictStartSong({ title: 'Ping Pong vs Tremor' })).toBe(true);
    expect(isStrictStartSong({ title: 'Tremor vs Ping Pong (Live Festival Mashup)' })).toBe(true);
    expect(isStrictStartSong({ title: 'Ping Pong', artist: 'Armin van Buuren' })).toBe(true);
    expect(isStrictStartSong({ title: 'Tremor', artist: 'Dimitri Vegas & Martin Garrix' })).toBe(true);
    expect(isStrictStartSong({ title: 'Armin van Buuren vs Dimitri Vegas - Ping Pong Tremor' })).toBe(true);
  });

  it('does not falsely trigger on normal tracks', () => {
    expect(isStrictStartSong({ title: 'Levels', artist: 'Avicii' })).toBe(false);
    expect(isStrictStartSong({ title: 'Animals', artist: 'Martin Garrix' })).toBe(false);
    expect(isStrictStartSong(null)).toBe(false);
  });
});

describe('is8dSong', () => {
  it('detects 8D / 16D / 24D audio and remixes', () => {
    expect(is8dSong({ title: 'Imagine Dragons - Believer (8D AUDIO)' })).toBe(true);
    expect(is8dSong({ title: 'Alan Walker - Faded [8D Audio] - Use Headphones' })).toBe(true);
    expect(is8dSong({ title: 'Coldplay - Hymn For The Weekend (8D Remix)' })).toBe(true);
    expect(is8dSong({ title: 'Ed Sheeran - Shape of You 8-D version' })).toBe(true);
    expect(is8dSong({ title: 'Astronomia 8 D Remix' })).toBe(true);
    expect(is8dSong({ title: 'Hypnotic Beat 16D Audio' })).toBe(true);
    expect(is8dSong({ title: 'Spatial Dimension 24D' })).toBe(true);
  });

  it('does not falsely trigger on regular numbers or songs with 8 days', () => {
    expect(is8dSong({ title: 'The Beatles - Eight Days A Week' })).toBe(false);
    expect(is8dSong({ title: '8 Days in Paris' })).toBe(false);
    expect(is8dSong({ title: 'Levels', artist: 'Avicii' })).toBe(false);
    expect(is8dSong({ title: 'Brown Munde', artist: 'AP Dhillon' })).toBe(false);
    expect(is8dSong(null)).toBe(false);
  });
});

describe('isMashupSong', () => {
  it('detects mashup songs and variations', () => {
    expect(isMashupSong({ title: 'Tauba Tauba Mashup' })).toBe(true);
    expect(isMashupSong({ title: 'Bollywood Mash-Up 2024' })).toBe(true);
    expect(isMashupSong({ title: 'Punjabi Mash Up Nonstop' })).toBe(true);
    expect(isMashupSong({ title: 'Tauba Tauba (Mashup) | Karan Aujla X Shubh' })).toBe(true);
  });

  it('does not trigger on normal original tracks', () => {
    expect(isMashupSong({ title: 'Tauba Tauba', artist: 'Karan Aujla' })).toBe(false);
    expect(isMashupSong({ title: 'Softly', artist: 'Karan Aujla' })).toBe(false);
    expect(isMashupSong({ title: 'Levels', artist: 'Avicii' })).toBe(false);
    expect(isMashupSong(null)).toBe(false);
  });
});

describe('is8dOrMashupSong', () => {
  it('detects both 8D and mashup songs', () => {
    expect(is8dOrMashupSong({ title: 'Believer (8D AUDIO)' })).toBe(true);
    expect(is8dOrMashupSong({ title: 'Party Mashup 2026' })).toBe(true);
    expect(is8dOrMashupSong({ title: 'Lover', artist: 'Diljit Dosanjh' })).toBe(false);
  });
});


