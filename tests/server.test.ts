import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readJsonArray, writeJsonAtomic } from '../server/jsonFile';
import { parseRange } from '../server/sendFile';
import { findSong } from '../server/library';
import { guessLanguage } from '../shared/songLanguage';

describe('jsonFile', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dj-test-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips a list and leaves no temp file behind', () => {
    const file = path.join(dir, 'history.json');
    writeJsonAtomic(file, [{ id: 'a' }]);
    expect(readJsonArray(file)).toEqual([{ id: 'a' }]);
    expect(fs.readdirSync(dir)).toEqual(['history.json']);
  });

  it('treats a missing or empty file as an empty list', () => {
    const file = path.join(dir, 'missing.json');
    expect(readJsonArray(file)).toEqual([]);
    fs.writeFileSync(file, '');
    expect(readJsonArray(file)).toEqual([]);
  });

  it('backs up a corrupt file instead of losing it', () => {
    const file = path.join(dir, 'history.json');
    fs.writeFileSync(file, '[{"id": "a"}, {"id"'); // cut off mid-write
    expect(readJsonArray(file)).toEqual([]);
    const backups = fs.readdirSync(dir).filter((n) => n.startsWith('history.json.corrupt-'));
    expect(backups).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, backups[0]), 'utf-8')).toBe('[{"id": "a"}, {"id"');
  });
});

describe('parseRange', () => {
  it('reads the byte ranges browsers send', () => {
    expect(parseRange(undefined, 1000)).toBeNull();
    expect(parseRange('bytes=0-', 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 });
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
  });

  it('rejects ranges outside the file', () => {
    expect(parseRange('bytes=1000-', 1000)).toBe('invalid');
    expect(parseRange('bytes=500-100', 1000)).toBe('invalid');
    expect(parseRange('bytes=-', 1000)).toBe('invalid');
  });

  it('sends the whole file for multi-range requests', () => {
    expect(parseRange('bytes=0-1,5-6', 1000)).toBeNull();
  });
});

describe('findSong (history, favourites, banned)', () => {
  const list = [
    { id: 'h1', title: 'Lover', artist: 'Diljit Dosanjh', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' },
    { id: 'h2', title: 'Softly', artist: 'Karan Aujla' },
  ];

  it('matches by id, url, or title by the same artist', () => {
    expect(findSong(list, { id: 'h2' })).toBe(1);
    expect(findSong(list, { url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' })).toBe(0);
    expect(findSong(list, { title: ' lover ', artist: 'diljit dosanjh', url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb' })).toBe(0);
  });

  it('keeps apart different songs that share a title', () => {
    expect(findSong(list, { title: 'Lover', artist: 'Taylor Swift' })).toBe(-1);
    expect(findSong(list, { title: 'Lover', artist: 'Unknown Artist', url: 'https://www.youtube.com/watch?v=ccccccccccc' })).toBe(-1);
  });
});

describe('guessLanguage', () => {
  it('knows languages from artists and scripts', () => {
    expect(guessLanguage('295', 'Sidhu Moose Wala')).toEqual({ language: 'punjabi', sure: true });
    expect(guessLanguage('Kesariya', 'Arijit Singh')).toEqual({ language: 'hindi', sure: true });
    expect(guessLanguage('Blinding Lights', 'The Weeknd')).toEqual({ language: 'english', sure: false });
  });
});
