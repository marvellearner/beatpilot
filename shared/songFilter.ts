/**
 * What the AI chat was told to play: "only Diljit Dosanjh", "only dance songs", "more Punjabi
 * songs", "only old romantic Bollywood"… Artists, a vibe, a language and an era, any mix of them.
 * Shared by the browser (Up Next, the chip) and the server (research for /api/recommend).
 * Rules: MIXING_RULES.md "AI Chat Song Filters".
 */
import { namesArtist } from './taste';
import { guessLanguage } from './songLanguage';

export type Vibe = 'dance' | 'romantic' | 'chill' | 'bhangra';
export type FilterLanguage = 'punjabi' | 'hindi' | 'english' | 'spanish';
export type Era = 'old' | '90s' | '2000s' | 'new';

export interface SongFilter {
  artists: string[];
  only: boolean; // true: nothing else plays; false: just more of it
  vibe?: Vibe;
  language?: FilterLanguage;
  era?: Era;
}

/** The mood each vibe switches to (Moods.ts ids). */
export const VIBE_MOOD: Record<Vibe, 'party' | 'romantic' | 'chill' | 'bhangra'> = {
  dance: 'party',
  romantic: 'romantic',
  chill: 'chill',
  bhangra: 'bhangra',
};

// Slow or stripped-down versions: not dance songs
const SLOW = /\b(sad|unplugged|lo-?fi|slowed|acoustic|piano version|lullaby|reprise|emotional|heart ?break|bewafa|dard|female version|soft version)\b/i;
// Party versions: not for a romantic or chill set
const LOUD = /\b(party|club|remix|dj|bhangra|dance|edm|mashup|banger|dhol)\b/i;
// A song with a steady beat this slow isn't one people dance to
const DANCE_MIN_BPM = 88;

type Song = { title?: string; artist?: string; author?: string; bpm?: number; bpmConfidence?: number };

/** Whether a song fits the filter (songs not analysed yet are judged by title and artist). */
export function fitsFilter(f: SongFilter, song: Song): boolean {
  const title = song.title ?? '';
  const artist = song.author ?? song.artist ?? '';
  const text = `${title} | ${artist}`;
  if (f.artists.length && !f.artists.some((a) => namesArtist(text, a))) return false;

  if (f.language) {
    const guess = guessLanguage(title, artist);
    // Punjabi, Hindi and Spanish need a sure sign (script, words, known artists or labels);
    // English needs only to not be surely another language
    if (f.language === 'english' ? guess.sure && guess.language !== 'english' : !(guess.sure && guess.language === f.language)) return false;
  }

  switch (f.vibe) {
    case 'dance':
      if (SLOW.test(title)) return false;
      if (song.bpm && (song.bpmConfidence ?? 0) >= 0.6 && song.bpm < DANCE_MIN_BPM) return false;
      return true;
    case 'romantic':
    case 'chill':
      return !LOUD.test(title);
    case 'bhangra': {
      const guess = guessLanguage(title, artist);
      return /\b(bhangra|dhol)\b/i.test(title) || (guess.sure && guess.language === 'punjabi');
    }
    default:
      return true;
  }
}

const VIBE_WORD: Record<Vibe, string> = { dance: 'dance', romantic: 'romantic', chill: 'chill', bhangra: 'bhangra' };
const LANGUAGE_WORD: Record<FilterLanguage, string> = { punjabi: 'Punjabi', hindi: 'Bollywood', english: 'English', spanish: 'Latin' };
const ERA_WORD: Record<Era, string> = { old: 'old', '90s': '90s', '2000s': '2000s', new: 'latest' };

/** "Only Punjabi dance songs by Diljit Dosanjh", "More romantic songs", "Only Karan Aujla". */
export function describeFilter(f: SongFilter): string {
  const kind = [f.era && ERA_WORD[f.era], f.language && LANGUAGE_WORD[f.language], f.vibe && VIBE_WORD[f.vibe]].filter(Boolean).join(' ');
  const who = f.artists.join(' & ');
  const what = kind ? `${kind} songs${who ? ` by ${who}` : ''}` : who;
  return `${f.only ? 'Only' : 'More'} ${what}`;
}

/** Searches that find songs for the filter, e.g. "Punjabi dance songs", "Diljit Dosanjh dance songs". */
export function filterQueries(f: SongFilter, tasteArtists: string[]): string[] {
  // ("party songs", not "dance songs": the latter finds children's dance songs)
  const vibe = f.vibe ? (f.vibe === 'dance' ? 'party songs' : `${VIBE_WORD[f.vibe]} songs`) : 'songs';
  const lang = f.language ? LANGUAGE_WORD[f.language] : '';
  const era = f.era ? ERA_WORD[f.era] : '';
  const out: string[] = [];
  if (f.artists.length) {
    for (const a of f.artists) out.push(`${a} ${vibe}`.trim(), `${a} ${era} hits`.replace(/\s+/g, ' ').trim());
  } else if (f.vibe || f.language || f.era) {
    const base = `${era} ${lang} ${vibe}`.replace(/\s+/g, ' ').trim();
    out.push(base, `${base} hits`, `best ${base}`);
    // The listener's own artists, when they fit the language
    for (const a of tasteArtists.slice(0, 4)) {
      if (!f.language || fitsFilter({ artists: [], only: true, language: f.language }, { title: '', artist: a })) out.push(`${a} ${vibe}`);
    }
  }
  return [...new Set(out)];
}

/** One line for the AI's prompt, e.g. "ONLY Punjabi dance songs." */
export function filterForPrompt(f: SongFilter): string {
  const d = describeFilter(f).replace(/^Only /, '').replace(/^More /, '');
  return f.only ? `ONLY ${d}: nothing else at all.` : `About half of them: ${d}.`;
}
