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

// Kinds of songs in plain words (removed before the rest is read as artists' names or a title).
// Earlier entries win: "bhangra" wins over generic "dance", "classic 90s songs" is the 90s, not just "old".
const KIND_WORDS: Array<[RegExp, 'vibe' | 'language' | 'era', string]> = [
  [/\bbhangra\b/gi, 'vibe', 'bhangra'],
  [/\b(dance|dancing|danceable|party|club|upbeat|bangers?|floor ?fillers?|naach|nachne|edm|house(\s+music)?|techno|electro|trance|electronic(\s+dance)?)\b/gi, 'vibe', 'dance'],
  [/\b(romantic|love|slow)\b/gi, 'vibe', 'romantic'],
  [/\b(chill|relax(ing)?|calm|soft)\b/gi, 'vibe', 'chill'],
  [/\bpunjabi\b/gi, 'language', 'punjabi'],
  [/\b(hindi|bollywood)\b/gi, 'language', 'hindi'],
  [/\benglish\b/gi, 'language', 'english'],
  [/\b(spanish|latin)\b/gi, 'language', 'spanish'],
  // "90s", "90's", "1990s", "nineties", and the "19s" / "9os" typos
  [/(?<![\w])(?:19)?90'?s\b|\bnineties\b|\b19s\b|\b9os\b/gi, 'era', '90s'],
  [/\b(?:20)?00'?s\b|\b2000s\b/gi, 'era', '2000s'],
  [/\b(old|retro|classics?|evergreen|purane|purana)\b/gi, 'era', 'old'],
  [/\b(new|latest)\b/gi, 'era', 'new'],
];

/** The vibe, language and era named in a request, and the text without those words. */
export function parseSongKinds(text: string): { vibe?: Vibe; language?: FilterLanguage; era?: Era; rest: string } {
  const found: { vibe?: Vibe; language?: FilterLanguage; era?: Era } = {};
  let rest = text;
  for (const [re, kind, value] of KIND_WORDS) {
    if (re.test(rest)) {
      (found as Record<string, string>)[kind] ??= value;
      rest = rest.replace(re, ' ');
    }
    re.lastIndex = 0;
  }
  return { ...found, rest };
}

/**
 * Words around what is asked for: "play all the … songs of all time please", "best ever",
 * "favourite", Hinglish "gaane chalao". Removed before the rest is read as artists' names.
 */
export const REQUEST_FILLER =
  /\b(please|pls|plz|now|from now on|tonight|for now|the|all|all[- ]time|of all time|time|ever|every|best|top|greatest|most|famous|popular|favou?rites?|fav|faves|superhits?|super hits?|evergreen|songs?|tracks?|music|hits?|gaane|gane|gaana|gana|ke|ki|ka|wale|waale|sirf|bas|chalao|lagao|by|of|from|or|and|play|playing|put on|only|just|nothing but|more|some|let'?s|can you|could you|i want|we want|want|wanna|to|i|me|us|we|my|our)\b/gi;

/**
 * A search that describes a kind of songs rather than naming one ("classic hindi dance songs of
 * all time", "90s bollywood party hits"): its filter, or null when a title or artist is left over.
 */
export function describedSongs(query: string): SongFilter | null {
  const { vibe, language, era, rest } = parseSongKinds(query);
  if (!vibe && !language && !era) return null;
  const leftover = rest.replace(REQUEST_FILLER, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return leftover ? null : { artists: [], only: true, vibe, language, era };
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

// ---------------------------------------------------------------------------
// NLP Search Resolution Pipeline
// Translates natural, conversational requests (e.g. "play some romantic arijit
// singh songs", "bhangra party bangers by diljit", "something like brown munde")
// into high-accuracy music video search queries and structured DJ intents.
// ---------------------------------------------------------------------------

export interface NlpSearchIntent {
  rawQuery: string;
  isNlp: boolean;
  intentType: 'track_request' | 'artist_vibe' | 'vibe_filter' | 'similar_tracks' | 'direct_search';
  artists: string[];
  trackTitle?: string;
  vibe?: Vibe;
  language?: FilterLanguage;
  era?: Era;
  searchTerms: string[];
  badgeLabel?: string;
  filter?: SongFilter;
  only?: boolean;
}

const KNOWN_ARTIST_ENTRIES: Array<{ match: RegExp; name: string; defaultLanguage?: FilterLanguage }> = [
  // Punjabi / Desi Hip-hop
  { match: /\b(diljit\s+dosanjh|diljit)\b/i, name: 'Diljit Dosanjh', defaultLanguage: 'punjabi' },
  { match: /\b(karan\s+aujla|aujla)\b/i, name: 'Karan Aujla', defaultLanguage: 'punjabi' },
  { match: /\b(sidhu\s+moose\s*wala|sidhu\s*moosewala|moose\s*wala|sidhu)\b/i, name: 'Sidhu Moose Wala', defaultLanguage: 'punjabi' },
  { match: /\b(ap\s+dhillon|dhillon)\b/i, name: 'AP Dhillon', defaultLanguage: 'punjabi' },
  { match: /\b(shubh)\b/i, name: 'Shubh', defaultLanguage: 'punjabi' },
  { match: /\b(yo\s+yo\s+honey\s+singh|honey\s+singh)\b/i, name: 'Yo Yo Honey Singh', defaultLanguage: 'punjabi' },
  { match: /\b(badshah)\b/i, name: 'Badshah', defaultLanguage: 'hindi' },
  { match: /\b(guru\s+randhawa)\b/i, name: 'Guru Randhawa', defaultLanguage: 'punjabi' },
  { match: /\b(amrinder\s+gill)\b/i, name: 'Amrinder Gill', defaultLanguage: 'punjabi' },
  { match: /\b(b\s+praak)\b/i, name: 'B Praak', defaultLanguage: 'punjabi' },
  { match: /\b(jassie\s+gill)\b/i, name: 'Jassie Gill', defaultLanguage: 'punjabi' },
  { match: /\b(hardy\s+sandhu|harrdy\s+sandhu)\b/i, name: 'Harrdy Sandhu', defaultLanguage: 'punjabi' },
  { match: /\b(mankirt\s+aulakh)\b/i, name: 'Mankirt Aulakh', defaultLanguage: 'punjabi' },
  { match: /\b(prem\s+dhillon)\b/i, name: 'Prem Dhillon', defaultLanguage: 'punjabi' },
  { match: /\b(mickey\s+singh)\b/i, name: 'Mickey Singh', defaultLanguage: 'punjabi' },
  { match: /\b(ikky)\b/i, name: 'Ikky', defaultLanguage: 'punjabi' },
  { match: /\b(divine)\b/i, name: 'DIVINE', defaultLanguage: 'hindi' },
  { match: /\b(seedhe\s+maut)\b/i, name: 'Seedhe Maut', defaultLanguage: 'hindi' },
  { match: /\b(raftaar)\b/i, name: 'Raftaar', defaultLanguage: 'hindi' },
  { match: /\b(mc\s+stan)\b/i, name: 'MC Stan', defaultLanguage: 'hindi' },

  // Bollywood / Hindi
  { match: /\b(arijit\s+singh|arijit)\b/i, name: 'Arijit Singh', defaultLanguage: 'hindi' },
  { match: /\b(atif\s+aslam|atif)\b/i, name: 'Atif Aslam', defaultLanguage: 'hindi' },
  { match: /\b(kk|krishnakumar\s+kunnath)\b/i, name: 'KK', defaultLanguage: 'hindi' },
  { match: /\b(mohit\s+chauhan)\b/i, name: 'Mohit Chauhan', defaultLanguage: 'hindi' },
  { match: /\b(sonu\s+nigam)\b/i, name: 'Sonu Nigam', defaultLanguage: 'hindi' },
  { match: /\b(shreya\s+ghoshal)\b/i, name: 'Shreya Ghoshal', defaultLanguage: 'hindi' },
  { match: /\b(sunidhi\s+chauhan)\b/i, name: 'Sunidhi Chauhan', defaultLanguage: 'hindi' },
  { match: /\b(neha\s+kakkar)\b/i, name: 'Neha Kakkar', defaultLanguage: 'hindi' },
  { match: /\b(jubin\s+nautiyal)\b/i, name: 'Jubin Nautiyal', defaultLanguage: 'hindi' },
  { match: /\b(armaan\s+malik)\b/i, name: 'Armaan Malik', defaultLanguage: 'hindi' },
  { match: /\b(darshan\s+raval)\b/i, name: 'Darshan Raval', defaultLanguage: 'hindi' },
  { match: /\b(pritam)\b/i, name: 'Pritam', defaultLanguage: 'hindi' },
  { match: /\b(a\.?r\.?\s*rahman|ar\s+rahman|rahman)\b/i, name: 'A.R. Rahman', defaultLanguage: 'hindi' },
  { match: /\b(kishore\s+kumar|kishore\s+da)\b/i, name: 'Kishore Kumar', defaultLanguage: 'hindi' },
  { match: /\b(lata\s+mangeshkar)\b/i, name: 'Lata Mangeshkar', defaultLanguage: 'hindi' },
  { match: /\b(mohammed\s+rafi|mohd\s+rafi|rafi\s+sahab|rafi)\b/i, name: 'Mohammed Rafi', defaultLanguage: 'hindi' },
  { match: /\b(kumar\s+sanu)\b/i, name: 'Kumar Sanu', defaultLanguage: 'hindi' },
  { match: /\b(udit\s+narayan)\b/i, name: 'Udit Narayan', defaultLanguage: 'hindi' },
  { match: /\b(alka\s+yagnik)\b/i, name: 'Alka Yagnik', defaultLanguage: 'hindi' },
  { match: /\b(anuv\s+jain)\b/i, name: 'Anuv Jain', defaultLanguage: 'hindi' },
  { match: /\b(prateek\s+kuhad)\b/i, name: 'Prateek Kuhad', defaultLanguage: 'hindi' },

  // Global / Pop / Hip-Hop
  { match: /\b(the\s+weeknd|weeknd)\b/i, name: 'The Weeknd', defaultLanguage: 'english' },
  { match: /\b(drake)\b/i, name: 'Drake', defaultLanguage: 'english' },
  { match: /\b(taylor\s+swift)\b/i, name: 'Taylor Swift', defaultLanguage: 'english' },
  { match: /\b(ed\s+sheeran)\b/i, name: 'Ed Sheeran', defaultLanguage: 'english' },
  { match: /\b(justin\s+bieber)\b/i, name: 'Justin Bieber', defaultLanguage: 'english' },
  { match: /\b(post\s+malone)\b/i, name: 'Post Malone', defaultLanguage: 'english' },
  { match: /\b(dua\s+lipa)\b/i, name: 'Dua Lipa', defaultLanguage: 'english' },
  { match: /\b(bruno\s+mars)\b/i, name: 'Bruno Mars', defaultLanguage: 'english' },
  { match: /\b(coldplay)\b/i, name: 'Coldplay', defaultLanguage: 'english' },
  { match: /\b(chainsmokers|the\s+chainsmokers)\b/i, name: 'The Chainsmokers', defaultLanguage: 'english' },
  { match: /\b(calvin\s+harris)\b/i, name: 'Calvin Harris', defaultLanguage: 'english' },
  { match: /\b(david\s+guetta)\b/i, name: 'David Guetta', defaultLanguage: 'english' },
  { match: /\b(avicii)\b/i, name: 'Avicii', defaultLanguage: 'english' },
  { match: /\b(martin\s+garrix)\b/i, name: 'Martin Garrix', defaultLanguage: 'english' },
  { match: /\b(tiesto|tiësto)\b/i, name: 'Tiësto', defaultLanguage: 'english' },
  { match: /\b(dj\s+snake)\b/i, name: 'DJ Snake', defaultLanguage: 'english' },
  { match: /\b(alan\s+walker)\b/i, name: 'Alan Walker', defaultLanguage: 'english' },
  { match: /\b(marshmello)\b/i, name: 'Marshmello', defaultLanguage: 'english' },
  { match: /\b(skrillex)\b/i, name: 'Skrillex', defaultLanguage: 'english' },
  { match: /\b(fred\s+again(\.\.)?)\b/i, name: 'Fred again..', defaultLanguage: 'english' },
  { match: /\b(swedish\s+house\s+mafia)\b/i, name: 'Swedish House Mafia', defaultLanguage: 'english' },
  { match: /\b(alesso)\b/i, name: 'Alesso', defaultLanguage: 'english' },
  { match: /\b(kygo)\b/i, name: 'Kygo', defaultLanguage: 'english' },
  { match: /\b(zedd)\b/i, name: 'Zedd', defaultLanguage: 'english' },
  { match: /\b(travis\s+scott)\b/i, name: 'Travis Scott', defaultLanguage: 'english' },
  { match: /\b(kendrick\s+lamar)\b/i, name: 'Kendrick Lamar', defaultLanguage: 'english' },
  { match: /\b(eminem)\b/i, name: 'Eminem', defaultLanguage: 'english' },
  { match: /\b(billie\s+eilish)\b/i, name: 'Billie Eilish', defaultLanguage: 'english' },
];

/** Conversational prefixes indicating intentional user commands rather than literal titles */
export const CONVERSATIONAL_PREFIXES =
  /^(?:can you(?:\s+please)?|could you(?:\s+please)?|please|pls|plz|i want to hear|i want|we want|wanna hear|put on|play|queue up|queue|add|mix in|drop|blast|spin|find me|search for|give me|get me|look up|chalao|lagao|baja do|sunao)\s+/i;

const MUSIC_DESCRIPTORS =
  /\b(fast|slow|hard|soft|heavy|high|low|bass|loud|upbeat|acoustic|unplugged|live|remix|original|instrumental|clean|radio|extended|short|bangers?|hits?|songs?|tracks?|music|vibes?)\b/i;

function toTitleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Parses natural language intent from any search query */
export function parseNlpSearchQuery(query: string): NlpSearchIntent {
  const trimmed = query.trim();
  if (!trimmed || /^(https?:\/\/|local:)/i.test(trimmed)) {
    return {
      rawQuery: trimmed,
      isNlp: false,
      intentType: 'direct_search',
      artists: [],
      searchTerms: [trimmed],
    };
  }

  let withoutPrefix = trimmed;
  let hasConversationalPrefix = false;
  while (CONVERSATIONAL_PREFIXES.test(withoutPrefix)) {
    hasConversationalPrefix = true;
    withoutPrefix = withoutPrefix.replace(CONVERSATIONAL_PREFIXES, '').trim();
  }

  // 1. "Something like X" / "songs like X" / "similar to X"
  const similarMatch =
    withoutPrefix.match(/^(?:something|songs?|tracks?)\s+(?:like|similar\s+to)\s+(.+)$/i) ||
    withoutPrefix.match(/^similar\s+to\s+(.+)$/i);
  if (similarMatch) {
    const rawRef = similarMatch[1].replace(/['"]/g, '').trim();
    const cleanRef = rawRef.replace(REQUEST_FILLER, ' ').replace(/\s+/g, ' ').trim() || rawRef;
    const searchTerms = [
      `${cleanRef} official video`,
      `${cleanRef} song`,
      `songs like ${cleanRef} hits`,
    ];
    return {
      rawQuery: trimmed,
      isNlp: true,
      intentType: 'similar_tracks',
      artists: [],
      trackTitle: cleanRef,
      searchTerms: [...new Set(searchTerms)],
      badgeLabel: `✨ Similar: "${toTitleCase(cleanRef)}"`,
    };
  }

  // 2. Extract song kinds: vibe, language, era
  const { vibe, language: parsedLanguage, era, rest: restAfterKinds } = parseSongKinds(withoutPrefix);
  const hasKinds = !!(vibe || parsedLanguage || era);

  // 3. Extract known artists
  const matchedArtists: string[] = [];
  let defaultLangFromArtist: FilterLanguage | undefined;
  for (const entry of KNOWN_ARTIST_ENTRIES) {
    if (entry.match.test(trimmed)) {
      matchedArtists.push(entry.name);
      defaultLangFromArtist ??= entry.defaultLanguage;
    }
  }

  // Check explicit "by <artist>" or "from <artist>" pattern
  const byMatch = withoutPrefix.match(/\b(?:by|from)\s+([A-Za-z0-9\s.'-]+)$/i);
  if (byMatch) {
    const byCandidate = byMatch[1].trim();
    if (byCandidate.length >= 2 && !matchedArtists.some((a) => a.toLowerCase() === byCandidate.toLowerCase())) {
      matchedArtists.push(byCandidate);
    }
  }

  // If no known artist matched yet, but kinds exist, check if rest has leftover words that look like an artist
  if (hasKinds && matchedArtists.length === 0) {
    const candidate = restAfterKinds.replace(REQUEST_FILLER, ' ').replace(/[^\p{L}\p{N}\s]+/gu, ' ').trim();
    const candidateWords = candidate.split(/\s+/).filter(Boolean);
    const nonDescriptorWords = candidateWords.filter((w) => !MUSIC_DESCRIPTORS.test(w));
    if (nonDescriptorWords.length >= 1 && nonDescriptorWords.length <= 4 && candidate.length >= 2) {
      matchedArtists.push(nonDescriptorWords.join(' '));
    }
  }

  const language = parsedLanguage || defaultLangFromArtist;
  const isOnly = /\b(only|just|nothing but|sirf)\b/i.test(trimmed);

  // 4. Compound Artist + Vibe / Era / Language
  if (matchedArtists.length > 0 && (hasKinds || isOnly)) {
    const primaryArtist = matchedArtists[0];
    const isEdm = /\b(edm|electronic(\s+dance)?|house(\s+music)?|techno|electro|trance)\b/i.test(trimmed);
    const vibeWord = isEdm ? 'edm' : vibe ? (vibe === 'dance' ? 'party' : VIBE_WORD[vibe]) : '';
    const langWord = language ? LANGUAGE_WORD[language] : '';
    const eraWord = era ? ERA_WORD[era] : '';

    const searchTerms: string[] = [];
    if (vibeWord) {
      searchTerms.push(
        `${primaryArtist} ${vibeWord} hits official song`,
        `${primaryArtist} ${vibeWord} songs`,
        `best ${primaryArtist} ${vibeWord} full video`,
        `${primaryArtist} ${vibeWord}`
      );
    } else if (eraWord || langWord) {
      searchTerms.push(
        `${primaryArtist} ${eraWord} ${langWord} hits official song`.replace(/\s+/g, ' ').trim(),
        `${primaryArtist} ${langWord} songs`.replace(/\s+/g, ' ').trim(),
        `${primaryArtist} official video`
      );
    } else {
      searchTerms.push(
        `${primaryArtist} hits official video`,
        `${primaryArtist} official songs`,
        `best of ${primaryArtist}`
      );
    }

    const badgeParts = [
      isEdm ? 'EDM' : vibe && VIBE_WORD[vibe].charAt(0).toUpperCase() + VIBE_WORD[vibe].slice(1),
      language && LANGUAGE_WORD[language],
      era && ERA_WORD[era],
      primaryArtist,
    ].filter(Boolean);

    const filter: SongFilter = {
      artists: matchedArtists,
      only: isOnly,
      ...(vibe && { vibe }),
      ...(language && { language }),
      ...(era && { era }),
    };

    return {
      rawQuery: trimmed,
      isNlp: true,
      intentType: 'artist_vibe',
      artists: matchedArtists,
      vibe,
      language,
      era,
      only: isOnly,
      searchTerms: [...new Set(searchTerms)],
      badgeLabel: isOnly ? `✨ Filter: Only ${primaryArtist}` : `✨ AI NLP: ${badgeParts.join(' · ')}`,
      filter,
    };
  }

  // 5. Pure Vibe / Language / Era Filter (e.g. "fast upbeat hindi dance songs", "90s bollywood party hits")
  if (hasKinds) {
    const isEdm = /\b(edm|electronic(\s+dance)?|house(\s+music)?|techno|electro|trance)\b/i.test(trimmed);
    const filter: SongFilter = {
      artists: [],
      only: isOnly || !hasConversationalPrefix,
      ...(vibe && { vibe }),
      ...(language && { language }),
      ...(era && { era }),
    };
    const baseQueries = filterQueries(filter, []);
    const single = (baseQueries[0] || 'party songs').replace(/\bsongs$/, 'song');
    const searchTerms: string[] = [];
    if (isEdm) {
      searchTerms.push(
        'best edm dance hits official video',
        'top edm club song official music video',
        'popular edm tracks official audio',
        'famous edm festival anthem official video',
        ...baseQueries
      );
    } else {
      searchTerms.push(
        `${single} full video`,
        `${single} official video`,
        `best ${single} hits`,
        ...baseQueries
      );
    }

    const badgeParts = [
      isEdm ? 'EDM' : undefined,
      language && LANGUAGE_WORD[language],
      era && ERA_WORD[era],
      vibe && VIBE_WORD[vibe].charAt(0).toUpperCase() + VIBE_WORD[vibe].slice(1),
    ].filter(Boolean);

    return {
      rawQuery: trimmed,
      isNlp: true,
      intentType: 'vibe_filter',
      artists: [],
      vibe,
      language,
      era,
      only: filter.only,
      searchTerms: [...new Set(searchTerms)],
      badgeLabel: `✨ AI Vibe: ${badgeParts.join(' · ')}`,
      filter,
    };
  }

  // 6. Conversational Track Request: "play chaleya by arijit singh" or "can you play kesariya"
  if (hasConversationalPrefix) {
    // Check "play <track> by <artist>"
    const trackByArtist = withoutPrefix.match(/^(.+?)\s+(?:by|from)\s+(.+)$/i);
    if (trackByArtist) {
      let title = trackByArtist[1].replace(/['"]/g, '').trim();
      while (CONVERSATIONAL_PREFIXES.test(title)) {
        title = title.replace(CONVERSATIONAL_PREFIXES, '').trim();
      }
      const rawArtist = trackByArtist[2].replace(/['"]/g, '').trim();
      const known = KNOWN_ARTIST_ENTRIES.find((k) => k.match.test(rawArtist));
      const canonicalArtist = known ? known.name : toTitleCase(rawArtist);
      const searchTerms = [
        `${title} ${canonicalArtist} official song video`,
        `${title} ${canonicalArtist} official video`,
        `${title} ${canonicalArtist}`,
      ];
      return {
        rawQuery: trimmed,
        isNlp: true,
        intentType: 'track_request',
        artists: [canonicalArtist],
        trackTitle: title,
        searchTerms: [...new Set(searchTerms)],
        badgeLabel: `✨ AI Track: "${toTitleCase(title)}" · ${canonicalArtist}`,
      };
    }

    const cleanTitle = withoutPrefix.replace(/^(some|a|the)\s+/i, '').replace(/['"]/g, '').trim();
    if (cleanTitle.length >= 2) {
      const searchTerms = [
        `${cleanTitle} official song video`,
        `${cleanTitle} official video`,
        cleanTitle,
      ];
      return {
        rawQuery: trimmed,
        isNlp: true,
        intentType: 'track_request',
        artists: matchedArtists,
        trackTitle: cleanTitle,
        searchTerms: [...new Set(searchTerms)],
        badgeLabel: `✨ AI Request: "${toTitleCase(cleanTitle)}"`,
      };
    }
  }

  // 7. Direct search (song title, artist name, plain keywords)
  return {
    rawQuery: trimmed,
    isNlp: false,
    intentType: 'direct_search',
    artists: matchedArtists,
    searchTerms: [trimmed],
  };
}
