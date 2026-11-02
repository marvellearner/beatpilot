import { describe, expect, it } from 'vitest';
import { searchVariants } from '../server/searchVariants';

describe('searchVariants (searches that found nothing)', () => {
  it('puts the artist first with the usual spelling of the title first ("goliya honey singh")', () => {
    expect(searchVariants('goliya honey singh')[0]).toBe('honey singh goliyan');
    expect(searchVariants('goliya honey singh')).toContain('honey singh goliya');
  });
  it('spells romanised words the other common ways', () => {
    expect(searchVariants('kesariya')).toContain('kesariyan');
    expect(searchVariants('deewana')).toContain('diwana');
    expect(searchVariants('goliyan')).toContain('goliya');
    expect(searchVariants('goliya')).toContain('goliyan');
  });
  it("doesn't respell the artist's name", () => {
    expect(searchVariants('tum hi ho arijit singh').some((v) => /seengh|arijeet/.test(v))).toBe(false);
  });
  it('gives nothing back for nothing', () => {
    expect(searchVariants('   ')).toEqual([]);
  });
});
