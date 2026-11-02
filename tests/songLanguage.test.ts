import { describe, expect, it } from 'vitest';
import { languageFamily } from '../shared/songLanguage';

describe('languageFamily', () => {
  it('counts Hindi and Punjabi songs as desi', () => {
    expect(languageFamily('Kesariya', 'Arijit Singh')).toBe('desi');
    expect(languageFamily('295', 'Sidhu Moose Wala')).toBe('desi');
  });

  it('spots Hindi / Punjabi words in a title by an unknown artist', () => {
    expect(languageFamily('Tera Hone Laga Hoon', 'Some Channel')).toBe('desi');
    expect(languageFamily('Nachde Ne Saare', 'Wedding Hits')).toBe('desi');
  });

  it('counts other Latin-alphabet titles as western', () => {
    expect(languageFamily('Blinding Lights', 'The Weeknd')).toBe('western');
    expect(languageFamily('Despacito', 'Luis Fonsi')).toBe('western');
  });

  it("uses the AI DJ's answer when the built-in guess isn't sure", () => {
    expect(languageFamily('Aankh Marey', 'Unknown Uploads', 'hindi')).toBe('desi');
    expect(languageFamily('Some Song', 'Someone', 'english')).toBe('western');
    expect(languageFamily('Some Song', 'Someone', 'other')).toBeUndefined();
  });
});
