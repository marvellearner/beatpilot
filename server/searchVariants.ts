/**
 * Other ways to write a search that found nothing. The third-party search front-ends match
 * words literally: no "did you mean", and even the word order matters ("goliya honey singh" and
 * "goliyan honey singh" found 0, "honey singh goliyan" found 20). So: the artist moved first
 * (the last two words, then the last word), and the usual Hindi / Punjabi spelling differences
 * of romanised titles (goliya / goliyan, ee / i, oo / u, a doubled or not at the end).
 */
const MAX_VARIANTS = 6;

/** Spellings of one romanised word that people (and uploaders) commonly use instead. */
function spellings(word: string): string[] {
  const w = word.toLowerCase();
  if (w.length < 4 || !/^[a-z]+$/.test(w)) return [];
  const out = new Set<string>();
  if (/[aeiou]$/.test(w) && !w.endsWith('n')) out.add(`${w}n`); // goliya -> goliyan, naina -> nainan
  if (/[aeiou]n$/.test(w)) out.add(w.slice(0, -1)); // goliyan -> goliya
  if (w.includes('ee')) out.add(w.replace(/ee/g, 'i')); // deewana -> diwana
  if (w.includes('oo')) out.add(w.replace(/oo/g, 'u')); // khoobsurat -> khubsurat
  if (w.endsWith('aa')) out.add(w.slice(0, -1)); // raataa -> raata
  else if (w.endsWith('a')) out.add(`${w}a`); // raata -> raataa
  out.delete(w);
  return [...out];
}

/** Up to MAX_VARIANTS other ways to write `query`, most likely first. */
export function searchVariants(query: string): string[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  // The artist is usually typed last: the last two words (a full name) or, for two words, the last
  const artistWords = words.length >= 3 ? 2 : words.length === 2 ? 1 : 0;
  const artist = words.slice(words.length - artistWords);
  const title = words.slice(0, words.length - artistWords);
  const out: string[] = [];
  const add = (ws: string[]) => {
    const q = ws.join(' ');
    if (q.toLowerCase() !== query.trim().toLowerCase() && !out.some((o) => o.toLowerCase() === q.toLowerCase())) out.push(q);
  };
  // Other spellings of the title words (an artist's name is usually written the one way)
  const titleSpellings: string[][] = [];
  title.forEach((w, i) => spellings(w).forEach((s) => titleSpellings.push(title.map((x, j) => (j === i ? s : x)))));
  // Most likely first: artist first with the title respelled, artist first as typed, then as
  // typed with the title respelled
  if (artist.length) {
    for (const t of titleSpellings) add([...artist, ...t]);
    add([...artist, ...title]);
  }
  for (const t of titleSpellings) add([...t, ...artist]);
  return out.slice(0, MAX_VARIANTS);
}
