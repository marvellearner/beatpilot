import { describe, expect, it } from 'vitest';
import { getCamelotDetails, keyCompatibility, keyFromTonic, shiftKey } from '../src/audio/KeyDetector';

describe('Camelot keys', () => {
  it('names keys on the wheel', () => {
    expect(keyFromTonic(9, true).camelot).toBe('8A'); // A minor
    expect(keyFromTonic(0, false).camelot).toBe('8B'); // C major
    expect(getCamelotDetails('8A').shortName).toBe('Am');
    expect(getCamelotDetails(undefined).musicalKey).toBe('Unknown Key');
  });

  it('shifts the key when a song is sped up without key lock', () => {
    expect(shiftKey('8A', 1)).toBe('8A');
    expect(shiftKey('8A', 2 ** (1 / 12))).toBe('3A'); // one semitone up: A minor -> A# minor
  });

  it('scores how well two keys mix', () => {
    expect(keyCompatibility('8A', '8A')).toBe(1);
    expect(keyCompatibility('8A', '9A')).toBe(1);
    expect(keyCompatibility('12A', '1A')).toBe(1); // the wheel wraps around
    expect(keyCompatibility('8A', '8B')).toBe(1); // relative major
    expect(keyCompatibility('8A', '10A')).toBe(0.5);
    expect(keyCompatibility('8A', '2A')).toBe(0);
    expect(keyCompatibility('8A', undefined)).toBeNull();
  });
});
