import { describe, expect, it } from 'vitest';
import { parseNlpSearchQuery } from '../shared/songFilter';
import { parseSongCommand } from '../src/ai/DJAgent';

describe('NLP Search Query Parser', () => {
  it('parses artist + vibe compound queries with conversational fillers', () => {
    const res = parseNlpSearchQuery('play some romantic arijit singh songs');
    expect(res.isNlp).toBe(true);
    expect(res.intentType).toBe('artist_vibe');
    expect(res.artists).toContain('Arijit Singh');
    expect(res.vibe).toBe('romantic');
    expect(res.language).toBe('hindi');
    expect(res.searchTerms.length).toBeGreaterThan(0);
    expect(res.searchTerms[0]).toMatch(/Arijit Singh.*romantic.*hits/i);
    expect(res.badgeLabel).toContain('Arijit Singh');
    expect(res.badgeLabel).toContain('Romantic');
  });

  it('parses bhangra party bangers by Diljit', () => {
    const res = parseNlpSearchQuery('bhangra party bangers by diljit');
    expect(res.isNlp).toBe(true);
    expect(res.intentType).toBe('artist_vibe');
    expect(res.artists).toContain('Diljit Dosanjh');
    expect(res.vibe).toBe('bhangra');
    expect(res.language).toBe('punjabi');
    expect(res.searchTerms.some((t) => /Diljit Dosanjh.*bhangra/i.test(t))).toBe(true);
    expect(res.badgeLabel).toContain('Diljit Dosanjh');
  });

  it('parses pure mood / language / era vibe filters', () => {
    const res = parseNlpSearchQuery('fast upbeat hindi dance songs');
    expect(res.isNlp).toBe(true);
    expect(res.intentType).toBe('vibe_filter');
    expect(res.vibe).toBe('dance');
    expect(res.language).toBe('hindi');
    expect(res.filter).toBeDefined();
    expect(res.badgeLabel).toContain('Bollywood');
    expect(res.badgeLabel).toContain('Dance');
  });

  it('parses "something like" and "similar to" recommendation requests', () => {
    const res = parseNlpSearchQuery('play something like brown munde');
    expect(res.isNlp).toBe(true);
    expect(res.intentType).toBe('similar_tracks');
    expect(res.trackTitle?.toLowerCase()).toBe('brown munde');
    expect(res.searchTerms.some((t) => t.toLowerCase().includes('brown munde'))).toBe(true);
    expect(res.badgeLabel).toContain('Brown Munde');

    const res2 = parseNlpSearchQuery('songs similar to lover');
    expect(res2.isNlp).toBe(true);
    expect(res2.intentType).toBe('similar_tracks');
    expect(res2.trackTitle?.toLowerCase()).toBe('lover');
  });

  it('parses conversational track and artist requests', () => {
    const res = parseNlpSearchQuery('can you play chaleya by arijit singh');
    expect(res.isNlp).toBe(true);
    expect(res.intentType).toBe('track_request');
    expect(res.trackTitle?.toLowerCase()).toBe('chaleya');
    expect(res.artists).toContain('Arijit Singh');
    expect(res.searchTerms[0]).toContain('chaleya');
    expect(res.badgeLabel).toContain('Chaleya');
  });

  it('identifies explicit focus filters ("only ...")', () => {
    const res = parseNlpSearchQuery('play only diljit dosanjh');
    expect(res.isNlp).toBe(true);
    expect(res.only).toBe(true);
    expect(res.artists).toContain('Diljit Dosanjh');
    expect(res.badgeLabel).toContain('Only Diljit Dosanjh');
  });

  it('preserves direct literal searches without false NLP positives', () => {
    const res = parseNlpSearchQuery('kesariya');
    expect(res.isNlp).toBe(false);
    expect(res.intentType).toBe('direct_search');
    expect(res.searchTerms).toEqual(['kesariya']);
    expect(res.badgeLabel).toBeUndefined();

    const urlRes = parseNlpSearchQuery('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(urlRes.isNlp).toBe(false);
    expect(urlRes.intentType).toBe('direct_search');
  });
});

describe('AI DJ Command Integration with NLP', () => {
  it('understands natural language "play some romantic arijit singh songs" in AI chat', () => {
    const plan = parseSongCommand('play some romantic arijit singh songs');
    expect(plan).not.toBeNull();
    expect(plan?.action).toBe('queue_control');
    expect(plan?.queue?.vibe).toBe('romantic');
    expect(plan?.queue?.focus_artists?.[0]).toMatch(/arijit singh/i);
  });

  it('understands "play something like brown munde" in AI chat', () => {
    const plan = parseSongCommand('play something like brown munde');
    expect(plan).not.toBeNull();
    expect(plan?.action).toBe('queue_control');
    expect(plan?.queue?.play_song?.toLowerCase()).toContain('brown munde');
  });
});

