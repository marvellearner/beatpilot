import { describe, expect, it } from 'vitest';
import { namesArtist, soundKey } from '../shared/taste';
import { fitsFilter } from '../shared/songFilter';
import { parseSongCommand } from '../src/ai/DJAgent';

describe('soundKey: one key for the usual English spellings of a name', () => {
  it.each([
    ['fateh', 'fatah'],
    ['fateh', 'fatheh'],
    ['qawwali', 'qawali'],
    ['qawwali', 'kawali'],
    ['nusrat', 'nushrat'],
    ['sagar', 'saagar'],
  ])('%s = %s', (a, b) => expect(soundKey(a)).toBe(soundKey(b)));
});

describe('namesArtist with other spellings', () => {
  it('finds Nusrat Fateh Ali Khan and Sagar Wali Qawwali however they are typed', () => {
    expect(namesArtist('Kali Kali Zulfon | Nusrat Fateh Ali Khan | Sagar Wali Qawwali', 'nusrat fatah ali khan')).toBe(true);
    expect(namesArtist('Unke Andaaz e Karam | Sagar Wali Qawwali Live Studio Session', 'sagar wali qawali')).toBe(true);
    expect(namesArtist('Mast Qalandar | Nusrat Fateh Ali Khan', 'nusrat fateh ali khan')).toBe(true);
  });

  it('does not match different names', () => {
    expect(namesArtist('Tadap Tadap | KK', 'Ikky')).toBe(false);
    expect(namesArtist('Brown Munde | AP Dhillon', 'Prem Dhillon')).toBe(false);
    expect(namesArtist('Kesariya | Arijit Singh', 'Mika Singh')).toBe(false);
    expect(namesArtist('Lover | Diljit Dosanjh', 'Shubh')).toBe(false);
    // Short names only match exactly (a two-letter sound skeleton is too loose)
    expect(namesArtist('Sab Tera | Armaan Malik', 'Shubh')).toBe(false);
  });
});

describe('"Play nusrat fatah ali khan & sagar wali qawali only"', () => {
  it('becomes a play-only filter that their songs fit', () => {
    const plan = parseSongCommand('Play nusrat fatah ali khan & sagar wali qawali only');
    expect(plan?.action).toBe('queue_control');
    expect(plan?.queue?.only).toBe(true);
    const filter = { artists: plan!.queue!.focus_artists!, only: true };
    expect(fitsFilter(filter, { title: 'Sanson Ki Mala Pe | Live Performance | Nusrat Fateh Ali Khan', author: 'Saregama' })).toBe(true);
    expect(fitsFilter(filter, { title: 'Dulhe Ka Sehra | Sagar Wali Qawwali 2.0', author: 'Humara Music' })).toBe(true);
    expect(fitsFilter(filter, { title: 'Brown Munde', author: 'AP Dhillon' })).toBe(false);
  });
});
