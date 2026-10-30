/** "What should play next": AI-curated song suggestions with a hand-made per-mood fallback. */
import { IncomingMessage, ServerResponse } from 'http';
import { ollamaGenerate } from './llm';
import { isOnline, localRecommendations } from './localLibrary';
import { SearchResult, canonicalYouTubeUrl, formatDuration } from './youtube';
import { searchVideos } from './audioSource';
import { BANNED_SONGS_FILE, FAVORITES_FILE, PLAY_HISTORY_FILE, type HistoryEntry } from './library';
import { readJsonArray } from './jsonFile';
import { logError } from './logger';
import { EMPTY_TASTE, artistKey, buildTaste, rankHits, songArtists, tasteForPrompt, type TasteProfile, type TasteSong } from '../shared/taste';

/**
 * Suggests 5 stylistically and energetically compatible song queries
 * using local Ollama if available, with intelligent fallback heuristics.
 */
const SEARCH_CONCURRENCY = 3;
const MAX_QUERIES = 16; // each one is a search on a public instance
// A busy CPU model times out; while it does, use the quick searches instead of waiting 45 s each time
const OLLAMA_REST_MS = 5 * 60_000;
let ollamaRestUntil = 0;

export const MOOD_PROMPTS: Record<string, string> = {
  normal: 'a relaxed house party; mix of popular songs',
  party: 'a high-energy dance party; upbeat, well-known bangers',
  bhangra: 'a Punjabi bhangra / wedding dance floor; dhol-heavy, high energy',
  chill: 'a chill, laid-back evening; mellow, smooth, low-tempo songs',
  romantic: 'a romantic, slow-dance mood; love songs and soft melodies',
};

export const MOOD_FALLBACK_SONGS: Record<string, string[]> = {
  party: [
    'Sidhu Moose Wala 295',
    'Diljit Dosanjh Lover',
    'AP Dhillon Brown Munde',
    'Shubh Baller',
    'Karan Aujla Softly',
    'Mankirt Aulakh Badnam',
    'Badshah Kar Gayi Chull',
    'Guru Randhawa High Rated Gabru',
    'Mika Singh Subha Hone Na De',
    'Yo Yo Honey Singh Dope Shope',
    'Karan Aujla Tauba Tauba',
    'Diljit Dosanjh GOAT',
    'Sidhu Moose Wala Same Beef',
    'Shubh Cheques',
    'Yo Yo Honey Singh Blue Eyes',
    'Simmba Aankh Marey',
    'War Jai Jai Shivshankar',
    'Diljit Dosanjh Born to Shine',
    'Badshah Kala Chashma',
    'Arijit Singh Ghungroo Party Mix',
    'Guru Randhawa Lahore',
    'Fisher Losing It',
    'Calvin Harris One Kiss',
    'David Guetta Titanium',
    'Tiësto The Business',
    'Mau P Drugs From Amsterdam',
    'Swedish House Mafia Moth To A Flame',
    'Acraze Do It To It',
    'Peggy Gou Nanana',
    'The Weeknd Blinding Lights',
  ],
  normal: [
    'Diljit Dosanjh Lover',
    'Sidhu Moose Wala 295',
    'AP Dhillon Brown Munde',
    'Karan Aujla Softly',
    'Shubh Cheques',
    'Badshah Kar Gayi Chull',
    'Guru Randhawa High Rated Gabru',
    'Yo Yo Honey Singh Blue Eyes',
    'Mika Singh Subha Hone Na De',
    'Mankirt Aulakh Badnam',
    'Arijit Singh Ghungroo',
    'Diljit Dosanjh GOAT',
    'Shubh Baller',
    'Karan Aujla Tauba Tauba',
    'War Jai Jai Shivshankar',
    'Simmba Aankh Marey',
    'Badshah Kala Chashma',
    'Yo Yo Honey Singh Dope Shope',
    'The Weeknd Blinding Lights',
    'Dua Lipa Levitating',
    'David Guetta Titanium',
    'Calvin Harris One Kiss',
    'Fisher Losing It',
    'Tiësto The Business',
    'AP Dhillon Excuses',
  ],
  chill: [
    'Prateek Kuhad Kasoor',
    'AP Dhillon Excuses',
    'Anuv Jain Baarishein',
    'Arijit Singh Kesariya',
    'The Local Train Choo Lo',
    'Zaeden tere bina',
    'Twin Strings Dhaldha Chand',
    'Jasleen Royal Kho Gaye Hum Kahan',
    'Lucky Ali O Sanam',
    'Prateek Kuhad cold/mess',
    'Anuv Jain Alag Aasmaan',
    'Bayaan Din Dhalay',
    'Lifafa Nikamma',
    'When Chai Met Toast When We Feel Young',
    'Mohit Chauhan Phir Se Ud Chala',
    'Atif Aslam Aadat Acoustic',
    'Arijit Singh Safar',
    'Armaan Malik Ghar Se Nikalte Hi',
    'The Local Train Aaoge Tum Kabhi',
    'Anuv Jain Husn',
    'Mitraz Akhiyaan',
    'Prateek Kuhad Kho Gaye Hum Kahan',
    'Lucky Ali Safarnama',
    'Strings Duur',
    'Silk Route Dooba Dooba',
  ],
  romantic: [
    'Arijit Singh Tum Hi Ho',
    'Atif Aslam Tera Hone Laga Hoon',
    'Jubin Nautiyal Raataan Lambiyan',
    'B Praak Mann Bharrya',
    'Diljit Dosanjh Lover',
    'Arijit Singh Apna Bana Le',
    'Mohit Chauhan Tum Se Hi',
    'Shreya Ghoshal Sun Raha Hai',
    'Atif Aslam Jeene Laga Hoon',
    'Arijit Singh Hawayein',
    'Pritam Shayad',
    'Armaan Malik Bol Do Na Zara',
    'Arijit Singh Raabta',
    'Atif Aslam Pehli Dafa',
    'Mohit Chauhan Pee Loon',
    'Rahat Fateh Ali Khan O Re Piya',
    'Sonu Nigam Abhi Mujh Mein Kahin',
    'Arijit Singh Mast Magan',
    'Shreya Ghoshal Saibo',
    'Kailash Kher Teri Deewani',
    'KK Aankhon Mein Teri',
    'Atif Aslam Tu Jaane Na',
    'Arijit Singh Enna Sona',
    'Pritam Subhanallah',
    'Darshan Raval Chogada',
  ],
  bhangra: [
    'Diljit Dosanjh Lover',
    'AP Dhillon Brown Munde',
    'Karan Aujla Softly',
    'Sidhu Moose Wala Same Beef',
    'Shubh Cheques',
    'Mankirt Aulakh Badnam',
    'Karan Aujla Tauba Tauba',
    'Diljit Dosanjh GOAT',
    'Sidhu Moose Wala 295',
    'Shubh Baller',
    'Guru Randhawa High Rated Gabru',
    'Badshah Jugnu',
    'Diljit Dosanjh Born to Shine',
    'Sidhu Moose Wala So High',
    'Karan Aujla Chitta Kurta',
    'Shubh No Love',
    'AP Dhillon With You',
    'Mickey Singh Phone',
    'Imran Khan Amplifier',
    'Panjabi MC Mundian To Bach Ke',
    'Daler Mehndi Bolo Tara Rara',
    'Bally Sagoo Gur Nalon Ishq Mitha',
    'Surjit Bindrakhia Tera Yaar Bolda',
    'Jazzy B Dil Luteya',
    'Yo Yo Honey Singh Angreji Beat',
    'Garry Sandhu Illegal Weapon',
    'Amrit Maan Bamb Jatt',
    'Jordan Sandhu Teeje Week',
  ],
};

export async function generateRelatedSongQueries(
  currentTitle: string,
  artist: string,
  mood: string = 'normal',
  taste: TasteProfile = EMPTY_TASTE,
  useAi = true
): Promise<string[]> {
  const moodDescription = MOOD_PROMPTS[mood] ?? MOOD_PROMPTS.normal;
  const tasteLines = tasteForPrompt(taste);

  // Try local Ollama first for creative curation (unless it has just timed out)
  if (useAi && Date.now() >= ollamaRestUntil) try {
    const prompt = `You are a professional club/party AI DJ.
CURRENT PLAYING SONG: "${currentTitle}" by "${artist}".
THE MOOD OF THE PARTY: ${moodDescription}.
${tasteLines ? `${tasteLines}\n` : ''}Suggest exactly 12 songs that fit this mood and are musically, culturally, and energetically compatible to play NEXT in the DJ set. Only well-known hits that most people at a party would recognise and sing along to: no new releases, deep cuts or obscure songs. NEVER suggest 8D audio, 8D versions, or mashup songs under any circumstances. Suggest only original songs or official versions.${
      tasteLines
        ? ' Pick them for THIS listener: about half by the artists they play most, the rest by similar artists in the same languages and styles that they would like.'
        : ''
    }
Return a STRICT JSON object with key "suggestions" containing an array of 12 "Artist - Song" strings.
Example: { "suggestions": ["Diljit Dosanjh - Lover", "AP Dhillon - Brown Munde", "Karan Aujla - Softly", "Badshah - Jugnu"] }
Output ONLY valid JSON.`;

    // Runs in the background, so give the CPU model time: ~35 s for this prompt on the laptop's CPU.
    const parsed = JSON.parse(await ollamaGenerate(prompt, 320, 45_000));
    if (Array.isArray(parsed.suggestions)) {
      // The small model repeats itself and sometimes suggests what was just played
      const recent = new Set(taste.recent.map((t) => t.toLowerCase()));
      const suggestions = [
        ...new Set(
          parsed.suggestions
            .filter((s: unknown): s is string => typeof s === 'string')
            .map((s: string) => s.replace(/\s*\([^)]*\)\s*$/, '').trim())
            .filter((s: string) => s && !recent.has(s.toLowerCase()) && !/\b(8|16|24)[-_ ]*d\b/i.test(s) && !/\bmash[-_ ]*up\b/i.test(s))
        ),
      ] as string[];
      // Its picks take turns with searches for the listener's top artists, which always fit their taste
      if (suggestions.length >= 3) return withTasteArtists(suggestions, taste);
    }
  } catch (err) {
    // Fall back to party graph heuristics; a timeout means the model is busy, so rest it a while
    if ((err as Error)?.name === 'TimeoutError') ollamaRestUntil = Date.now() + OLLAMA_REST_MS;
  }

  // Without the AI every seed would give the same list: start from the seed's own artist and turn
  // the lists by the seed, so each seed of a fill searches different songs
  const turn = [...currentTitle].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rotate = <T,>(list: T[]) => (list.length ? [...list.slice(turn % list.length), ...list.slice(0, turn % list.length)] : list);
  const seedArtist = songArtists({ title: currentTitle, artist })[0];
  const artists = rotate(taste.artists.slice(0, 8)).filter((a) => !seedArtist || artistKey(a) !== artistKey(seedArtist));
  return withTasteArtists(rotate(fallbackQueries(currentTitle, artist, mood)), { ...taste, artists: seedArtist ? [seedArtist, ...artists] : artists });
}

/**
 * Without the AI: the listener's most played artists (a search by artist name finds their
 * popular songs) taking turns with the hand-made list.
 */
function withTasteArtists(queries: string[], taste: TasteProfile): string[] {
  const artists = taste.artists.slice(0, 6);
  const out: string[] = [];
  for (let i = 0; i < Math.max(artists.length, queries.length); i++) {
    if (artists[i]) out.push(artists[i]);
    if (queries[i]) out.push(queries[i]);
  }
  return out.slice(0, MAX_QUERIES);
}

/** The listener's taste: their library on disk plus what the browser just played (?recent=[[title, artist], …]) and avoids. */
function loadTaste(url: URL): TasteProfile {
  let recent: TasteSong[] = [];
  try {
    const raw: unknown = JSON.parse(url.searchParams.get('recent') || '[]');
    if (Array.isArray(raw)) recent = raw.slice(0, 15).map((r) => ({ title: String(r?.[0] ?? ''), artist: String(r?.[1] ?? '') }));
  } catch {
    // a malformed parameter just means no recent songs
  }
  // Artists the listener keeps removing from Up Next tonight (?avoid=[name, …])
  let avoidArtists: string[] = [];
  try {
    const raw: unknown = JSON.parse(url.searchParams.get('avoid') || '[]');
    if (Array.isArray(raw)) avoidArtists = raw.slice(0, 20).map(String);
  } catch {
    // ignore a malformed parameter
  }
  return buildTaste({
    avoidArtists,
    history: readJsonArray<HistoryEntry>(PLAY_HISTORY_FILE),
    favourites: readJsonArray<TasteSong>(FAVORITES_FILE),
    recent,
    banned: readJsonArray<TasteSong>(BANNED_SONGS_FILE),
  });
}

function fallbackQueries(currentTitle: string, artist: string, mood: string): string[] {
  const combined = `${currentTitle} ${artist}`.toLowerCase();
  // Heuristic Party Graph: the mood decides first, then the current song's style
  if (MOOD_FALLBACK_SONGS[mood]) {
    return MOOD_FALLBACK_SONGS[mood];
  }
  if (
    combined.includes('moose') ||
    combined.includes('sidhu') ||
    combined.includes('punjabi') ||
    combined.includes('diljit') ||
    combined.includes('aujla') ||
    combined.includes('dhillon') ||
    combined.includes('desi') ||
    combined.includes('bhangra')
  ) {
    return [
      'Diljit Dosanjh Lover',
      'AP Dhillon Brown Munde',
      'Karan Aujla Softly',
      'Sidhu Moose Wala Same Beef',
      'Shubh Cheques',
      'Mankirt Aulakh Badnam',
      'Karan Aujla Tauba Tauba',
      'Diljit Dosanjh GOAT',
      'Sidhu Moose Wala 295',
      'Shubh Baller',
      'Guru Randhawa High Rated Gabru',
      'Badshah Jugnu',
    ];
  }

  if (combined.includes('house') || combined.includes('techno') || combined.includes('club') || combined.includes('remix')) {
    return [
      'Fisher Losing It',
      'Peggy Gou Nanana',
      'Calvin Harris One Kiss',
      'Mau P Drugs From Amsterdam',
      'Meduza Piece Of Your Heart',
      'Fred again.. adore u',
      'Tiësto The Business',
      'Swedish House Mafia Moth To A Flame',
      'David Guetta Titanium',
      'Acraze Do It To It',
      'John Summit Where You Are',
      'Dom Dolla Rhyme Dust',
    ];
  }

  // Default energetic Bollywood / Desi club bangers
  return [
    'Yo Yo Honey Singh Blue Eyes',
    'Badshah Kala Chashma',
    'Diljit Dosanjh GOAT',
    'Mika Singh Subha Hone Na De',
    'Arijit Singh Ghungroo Party Mix',
    'Badshah Kar Gayi Chull',
    'Yo Yo Honey Singh Dope Shope',
    'Guru Randhawa Lahore',
    'Simmba Aankh Marey',
    'War Jai Jai Shivshankar',
    'Karan Aujla Tauba Tauba',
    'Diljit Dosanjh Born to Shine',
  ];
}

// 3. Autonomous Recommendations Based on Current Song
export async function handleRecommend(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const currentTitle = url.searchParams.get('title') || 'Bollywood Punjabi Party';
  const artist = url.searchParams.get('artist') || '';
  const mood = url.searchParams.get('mood') || 'normal';

  try {
    res.setHeader('Content-Type', 'application/json');

    // No internet (or the app is set to offline only): Up Next comes from the songs on this laptop
    if (url.searchParams.get('offline') === '1' || !(await isOnline())) {
      res.end(JSON.stringify({ recommendations: localRecommendations(currentTitle, artist, 12), offline: true }));
      return;
    }

    // Get curated recommendations using Ollama or genre intelligence, shaped by the listener's taste
    const taste = loadTaste(url);
    // ?ai=0: quick searches only (the AI takes ~30 s on this CPU; a fill asks it once, not per seed)
    const queries = await generateRelatedSongQueries(currentTitle, artist, mood, taste, url.searchParams.get('ai') !== '0');

    // Searches go to the third-party instance, a few at a time so a public instance isn't flooded.
    // Of each search's hits the best (liked artists, proper versions) is kept, not just the first. A song
    // search gives one song (its other hits are the same song again); an artist search gives a few.
    const searchOne = async (q: string) => {
      try {
        const hits = (await searchVideos(q)).filter(
          (v) =>
            v.lengthSeconds <= 300 &&
            !/\b(8|16|24)[-_ ]*d\b/i.test(`${v.title} ${v.author || ''}`) &&
            !/\bmash[-_ ]*up\b/i.test(`${v.title} ${v.author || ''}`)
        );
        // An artist search lists new uploads first: look deeper so their hits can win
        const artistSearch = taste.artists.includes(q) || q === songArtists({ title: currentTitle, artist })[0];
        return rankHits(hits, taste, q, artistSearch ? 3 : 1, artistSearch ? 20 : 8)
          .map((v) => ({
            title: v.title,
            url: canonicalYouTubeUrl(v.videoId),
            author: v.author || 'Artist',
            duration: v.lengthSeconds || 180,
            thumbnail: v.thumbnail,
            timestamp: formatDuration(v.lengthSeconds || 180),
          }));
      } catch {
        return [];
      }
    };
    const searchPromises: Array<Promise<Awaited<ReturnType<typeof searchOne>>>> = [];
    let running = Promise.resolve();
    for (let i = 0; i < queries.length; i += SEARCH_CONCURRENCY) {
      const batch = queries.slice(i, i + SEARCH_CONCURRENCY);
      const results = running.then(() => Promise.all(batch.map(searchOne)));
      running = results.then(() => undefined);
      batch.forEach((_, k) => searchPromises.push(results.then((r) => r[k])));
    }

    const bannedKeys = new Set<string>();
    for (const b of readJsonArray<{ url?: string; title?: string }>(BANNED_SONGS_FILE)) {
      if (b.url) bannedKeys.add(b.url.toLowerCase());
      if (b.title) bannedKeys.add(b.title.toLowerCase());
    }

    const settled = await Promise.all(searchPromises);
    const rawRecommendations = settled.flat();
    const seen = new Set<string>();
    const recommendations: SearchResult[] = [];
    for (const r of rawRecommendations) {
      if (r.duration && r.duration > 300) continue;
      if (
        /\b(8|16|24)[-_ ]*d\b/i.test(`${r.title} ${r.author || ''} ${r.url || ''}`) ||
        /\bmash[-_ ]*up\b/i.test(`${r.title} ${r.author || ''} ${r.url || ''}`)
      ) {
        continue;
      }
      const key = (r.url || r.title).toLowerCase();
      if (bannedKeys.has(key) || (r.title && bannedKeys.has(r.title.toLowerCase()))) continue;
      if (!seen.has(key)) {
        seen.add(key);
        recommendations.push(r);
      }
    }

    // Every YouTube search failed (internet dropped mid-way): fall back to the local library
    res.end(JSON.stringify(recommendations.length ? { recommendations } : { recommendations: localRecommendations(currentTitle, artist, 12), offline: true }));
  } catch (err) {
    logError('recommendations', err);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'Recommendation failed', details: String(err) }));
  }
  return;
}
