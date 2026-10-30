import { describe, expect, it } from 'vitest';
import { EMPTY_TASTE, buildTaste, cleanTitle, rankHits, scoreHit, songArtists, tasteForPrompt } from '../shared/taste';

describe('songArtists', () => {
  it('splits featured artists and drops channel suffixes', () => {
    expect(songArtists({ artist: 'AP Dhillon, Gurinder Gill, Shinda Kahlon' })).toEqual(['AP Dhillon', 'Gurinder Gill', 'Shinda Kahlon']);
    expect(songArtists({ artist: 'Shakira ft. Wyclef Jean' })).toEqual(['Shakira', 'Wyclef Jean']);
    expect(songArtists({ artist: 'EnriqueIglesiasVEVO' })).toEqual(['EnriqueIglesias']);
  });

  it('reads the artist from the title when the channel is a label', () => {
    expect(songArtists({ title: 'Guru Randhawa: Lahore (Official Video) | T-Series', artist: 'T-Series' })).toEqual(['Guru Randhawa']);
    expect(songArtists({ title: 'https://www.youtube.com/watch?v=xRb8hxwN5zc', artist: 'Searching...' })).toEqual([]);
  });
});

describe('cleanTitle', () => {
  it('drops video labels and pipe-separated extras', () => {
    expect(cleanTitle('Shubh - Cheques (Official Music Video)')).toBe('Shubh - Cheques');
    expect(cleanTitle('Badnam (HD VIdeo) | Mankirt Aulakh | New Punjabi Songs 2024')).toBe('Badnam');
  });
});

describe('buildTaste', () => {
  const now = Date.UTC(2026, 9, 31);
  const taste = buildTaste(
    {
      history: [
        { title: 'Sidhu Moose Wala - 295', artist: 'Sidhu Moose Wala', playCount: 26, lastPlayed: now },
        { title: 'Diljit Dosanjh - Lover', artist: 'Diljit Dosanjh', playCount: 22, lastPlayed: now },
        { title: 'Diljit Dosanjh - G.O.A.T. (Official Music Video)', artist: 'Diljit Dosanjh', playCount: 3, lastPlayed: now },
        { title: 'Blue Eyes Full Video Song Yo Yo Honey Singh', artist: 'T-Series', playCount: 2, lastPlayed: now },
      ],
      favourites: [{ title: 'Shape of You', artist: 'Ed Sheeran' }],
      recent: [{ title: 'Shubh - Baller (Official Music Video)', artist: 'SHUBH' }],
      banned: [
        { title: 'Song A', artist: 'Some Singer' },
        { title: 'Song B', artist: 'Some Singer' },
      ],
    },
    now
  );

  it('ranks artists by plays and favourites, merging spellings and skipping labels', () => {
    expect(taste.artists.slice(0, 2)).toEqual(['Diljit Dosanjh', 'Sidhu Moose Wala']);
    expect(taste.artists).toContain('Ed Sheeran');
    expect(taste.artists).toContain('SHUBH');
    expect(taste.artists).not.toContain('T-Series');
  });

  it('collects loved, recent and avoided songs', () => {
    expect(taste.loved).toEqual(['Shape of You', 'Sidhu Moose Wala - 295', 'Diljit Dosanjh - Lover', 'Diljit Dosanjh - G.O.A.T.']);
    expect(taste.recent).toEqual(['Shubh - Baller']);
    expect(taste.avoidArtists).toEqual(['Some Singer']);
    expect(tasteForPrompt(taste)).toContain('Artists they play most: Diljit Dosanjh, Sidhu Moose Wala');
  });

  it('is empty without history', () => {
    expect(buildTaste({})).toEqual(EMPTY_TASTE);
    expect(tasteForPrompt(EMPTY_TASTE)).toBe('');
  });
});

describe('rankHits', () => {
  const taste = { ...EMPTY_TASTE, artists: ['Diljit Dosanjh'], avoidArtists: ['Some Singer'] };

  it('prefers liked artists and proper versions over the first hit', () => {
    const hits = [
      { title: 'Lover (Slowed + Reverb)', author: 'Lofi Beats', lengthSeconds: 200 },
      { title: 'Some Singer - Party', author: 'Some Singer', lengthSeconds: 200 },
      { title: 'Random Song', author: 'Someone', lengthSeconds: 200 },
      { title: 'Diljit Dosanjh - Lover (Official Video)', author: 'Diljit Dosanjh', lengthSeconds: 195 },
      { title: 'Lover #shorts', author: 'Someone', lengthSeconds: 30 },
    ];
    expect(rankHits(hits, taste, 'lover').map((h) => h.title)).toEqual(['Diljit Dosanjh - Lover (Official Video)', 'Random Song']);
  });

  it("drops a liked artist's fan clips, TV performances and karaoke", () => {
    const hits = [
      { title: 'Diljit dosanjh live show Delhi 2026 #diljitdosanjh #delhishow', author: 'JEET SINGH', lengthSeconds: 200 },
      { title: 'Diljit Dosanjh: Morni | The Tonight Show Starring Jimmy Fallon', author: 'The Tonight Show', lengthSeconds: 200 },
      { title: 'Lover - Diljit Dosanjh (Karaoke Songs With Lyrics)', author: 'Musisi Karaoke', lengthSeconds: 200 },
    ];
    expect(rankHits(hits, taste, 'diljit dosanjh', 3)).toEqual([]);
  });

  it('keeps a version the search asked for', () => {
    const hits = [{ title: 'Tauba Tauba Mashup', author: 'DJ', lengthSeconds: 200 }];
    expect(rankHits(hits, EMPTY_TASTE, 'tauba tauba mashup')).toHaveLength(1);
    expect(rankHits(hits, EMPTY_TASTE, 'tauba tauba')).toHaveLength(0);
  });
});

describe('popularity', () => {
  const now = Date.UTC(2026, 9, 31);
  it("prefers an artist's known hit over their brand-new upload", () => {
    const hits = [
      { title: 'Karan Aujla - New Song (Official Video)', author: 'Karan Aujla', lengthSeconds: 200, viewCount: 7_800_000, publishedAt: now - 4 * 86_400_000 },
      { title: 'Karan Aujla - Softly (Official Video)', author: 'Karan Aujla', lengthSeconds: 170, viewCount: 300_000_000, publishedAt: now - 700 * 86_400_000 },
    ];
    const taste = { ...EMPTY_TASTE, artists: ['Karan Aujla'] };
    expect(scoreHit(hits[1], 1, taste, 'karan aujla', 20, now)).toBeGreaterThan(scoreHit(hits[0], 0, taste, 'karan aujla', 20, now));
  });
});
