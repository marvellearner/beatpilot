/**
 * "What should play next" (Up Next). One request researches, in parallel:
 * 1. songs people play together with the listener's songs (YouTube's related lists, via the instances),
 * 2. artists fans of their artists also like (Deezer), searched for their hits,
 * 3. the AI DJ's ideas for this listener and mood (when allowed: it takes ~30 s on this CPU),
 * then ranks every candidate once (votes from several sources + popularity + taste, see scoreHit).
 * Rules: MIXING_RULES.md "Up Next Familiar-First Rules".
 */
import { IncomingMessage, ServerResponse } from 'http';
import { ollamaGenerate } from './llm';
import { isOnline, localRecommendations } from './localLibrary';
import { SearchResult, canonicalYouTubeUrl, extractYouTubeVideoId, formatDuration } from './youtube';
import { artistHits, fansAlsoLike, mapLimit, related, search, type VideoHit } from './discover';
import { BANNED_SONGS_FILE, FAVORITES_FILE, PLAY_HISTORY_FILE, type HistoryEntry } from './library';
import { readJsonArray } from './jsonFile';
import { logError } from './logger';
import { MAX_AUTO_SONG_SECONDS, artistKey, buildTaste, namesArtist, rankHits, scoreHit, songArtists, tasteForPrompt, type TasteProfile, type TasteSong } from '../shared/taste';

const SEARCH_CONCURRENCY = 3;
const RESEARCH_SEEDS = 10; // songs whose "also played" lists are fetched per request
const DISCOVERY_ARTISTS = 4; // new artists (fans of yours also like) searched per request
const FOCUS_EXTRA_SEEDS = 5; // with "play only <artist>": their top hits whose "also played" lists are fetched too
const MAX_RECOMMENDATIONS = 40;
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

/**
 * The AI's song ideas ("Artist - Song") for what to play next, for this listener and mood.
 * Empty when it's switched off for this request, resting after a timeout, or fails.
 */
async function aiSongIdeas(currentTitle: string, artist: string, mood: string, taste: TasteProfile, focus: Focus | null): Promise<string[]> {
  if (Date.now() < ollamaRestUntil) return [];
  const moodDescription = MOOD_PROMPTS[mood] ?? MOOD_PROMPTS.normal;
  const tasteLines = tasteForPrompt(taste);
  try {
    const prompt = `You are a professional club/party AI DJ.
CURRENT PLAYING SONG: "${currentTitle}" by "${artist}".
THE MOOD OF THE PARTY: ${moodDescription}.
${tasteLines ? `${tasteLines}\n` : ''}Suggest exactly 12 songs that fit this mood and are musically, culturally, and energetically compatible to play NEXT in the DJ set. Only well-known hits that most people at a party would recognise and sing along to: no new releases, deep cuts or obscure songs. NEVER suggest 8D audio, 8D versions, or mashup songs under any circumstances. Suggest only original songs or official versions.${
      tasteLines
        ? ' Pick them for THIS listener: about half by the artists they play most, the rest by similar artists in the same languages and styles that they would like.'
        : ''
    }
${focus ? (focus.only ? `ONLY songs by ${focus.artists.join(' or ')}: no other artists at all.\n` : `About half of them by ${focus.artists.join(' or ')}.\n`) : ''}Return a STRICT JSON object with key "suggestions" containing an array of 12 "Artist - Song" strings.
Example: { "suggestions": ["Diljit Dosanjh - Lover", "AP Dhillon - Brown Munde", "Karan Aujla - Softly", "Badshah - Jugnu"] }
Output ONLY valid JSON.`;

    // Runs in the background, so give the CPU model time: ~35 s for this prompt on the laptop's CPU.
    const parsed = JSON.parse(await ollamaGenerate(prompt, 320, 45_000));
    if (!Array.isArray(parsed.suggestions)) return [];
    // The small model repeats itself and sometimes suggests what was just played
    const recent = new Set(taste.recent.map((t) => t.toLowerCase()));
    return [
      ...new Set(
        parsed.suggestions
          .filter((x: unknown): x is string => typeof x === 'string')
          .map((x: string) => x.replace(/\s*\([^)]*\)\s*$/, '').trim())
          .filter((x: string) => x && !recent.has(x.toLowerCase()) && !/\b(8|16|24)[-_ ]*d\b/i.test(x) && !/\bmash[-_ ]*up\b/i.test(x))
      ),
    ].slice(0, 12) as string[];
  } catch (err) {
    // A timeout means the model is busy: rest it a while
    if ((err as Error)?.name === 'TimeoutError') ollamaRestUntil = Date.now() + OLLAMA_REST_MS;
    return [];
  }
}

type Seed = { title: string; artist: string; url?: string };
type Focus = { artists: string[]; only: boolean };

/** "Play only / more <artist>" from the AI chat (?focus={"artists":[…],"only":true}). */
function parseFocus(url: URL): Focus | null {
  try {
    const raw = JSON.parse(url.searchParams.get('focus') || 'null') as { artists?: unknown; only?: unknown } | null;
    const artists = Array.isArray(raw?.artists) ? raw!.artists.map(String).filter((a) => artistKey(a).length >= 2).slice(0, 5) : [];
    return artists.length ? { artists, only: raw?.only !== false } : null;
  } catch {
    return null;
  }
}

/** Whether a song is by one of the focus artists (its title or channel names them). */
const byFocus = (focus: Focus, song: { title?: string; author?: string; artist?: string }) =>
  focus.artists.some((a) => namesArtist(`${song.title ?? ''} | ${song.author ?? song.artist ?? ''}`, a));

/** The songs the request is about (?seeds=[[title, artist, url], …], or ?title=&artist=), the song on air first. */
function parseSeeds(url: URL): Seed[] {
  try {
    const raw: unknown = JSON.parse(url.searchParams.get('seeds') || '[]');
    if (Array.isArray(raw) && raw.length) {
      return raw.slice(0, 8).map((r) => ({ title: String(r?.[0] ?? ''), artist: String(r?.[1] ?? ''), url: r?.[2] ? String(r[2]) : undefined })).filter((x) => x.title);
    }
  } catch {
    // fall back to title/artist
  }
  return [{ title: url.searchParams.get('title') || 'Bollywood Punjabi Party', artist: url.searchParams.get('artist') || '' }];
}

/**
 * Songs to ask "who plays this also plays…" about, with weights: the request's seeds (the song
 * on air counts most, then what was just played) plus a random handful of liked and most played
 * songs, so the listener's whole taste is asked about, not just tonight's last song.
 */
function researchSeeds(seeds: Seed[], focus: Focus | null): Array<{ videoId: string; weight: number }> {
  const out: Array<{ videoId: string; weight: number }> = [];
  const add = (u: string | undefined, weight: number) => {
    const id = u ? extractYouTubeVideoId(u) : null;
    if (id && !out.some((o) => o.videoId === id)) out.push({ videoId: id, weight });
  };
  const fits = (x: { title?: string; artist?: string }) => !focus?.only || byFocus(focus, x);
  seeds.filter(fits).forEach((sd, i) => add(sd.url, i === 0 ? 3 : 2));
  const liked = readJsonArray<{ url?: string; title?: string; artist?: string }>(FAVORITES_FILE);
  const played = readJsonArray<HistoryEntry>(PLAY_HISTORY_FILE)
    .filter((h) => (h.playCount || 0) >= (focus ? 1 : 2))
    .sort((a, b) => (b.playCount || 0) - (a.playCount || 0))
    .slice(0, focus ? 200 : 30);
  // With a focus, ask about the listener's songs by those artists first
  const pool = [...liked, ...played].sort(() => Math.random() - 0.5).sort((a, b) => Number(!!focus && byFocus(focus, b)) - Number(!!focus && byFocus(focus, a)));
  for (const p of pool) {
    if (out.length >= RESEARCH_SEEDS) break;
    if (fits(p)) add(p.url, 1);
  }
  return out;
}

/**
 * Artists the listener doesn't play much yet whom fans of their artists also like (Deezer): an
 * artist named by several of their artists comes first.
 */
async function discoveryArtists(taste: TasteProfile, seedArtist?: string): Promise<string[]> {
  const from = [...new Set([seedArtist, ...taste.artists.slice(0, 4)].filter(Boolean) as string[])];
  const lists = await mapLimit(from, 3, fansAlsoLike, [] as string[]);
  const known = new Set(taste.artists.map(artistKey));
  const avoid = new Set(taste.avoidArtists.map(artistKey));
  const votes = new Map<string, { name: string; n: number }>();
  for (const list of lists) {
    list.forEach((name, i) => {
      const key = artistKey(name);
      if (known.has(key) || avoid.has(key)) return;
      const v = votes.get(key) ?? { name, n: 0 };
      v.n += 1 - i / 30; // earlier in the list = closer
      votes.set(key, v);
    });
  }
  return [...votes.values()].sort((a, b) => b.n - a.n).slice(0, DISCOVERY_ARTISTS).map((v) => v.name);
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
  const mood = url.searchParams.get('mood') || 'normal';
  const first = parseSeeds(url)[0];

  try {
    res.setHeader('Content-Type', 'application/json');

    // No internet (or the app is set to offline only): Up Next comes from the songs on this laptop
    if (url.searchParams.get('offline') === '1' || !(await isOnline())) {
      res.end(JSON.stringify({ recommendations: localRecommendations(first.title, first.artist, 12), offline: true }));
      return;
    }

    const taste = loadTaste(url);
    const seeds = parseSeeds(url);
    const seedArtist = songArtists({ title: seeds[0].title, artist: seeds[0].artist })[0];
    const useAi = url.searchParams.get('ai') !== '0'; // ?ai=0: skip the ~30 s AI (Refresh, later seeds of a fill)
    const focus = parseFocus(url);

    // Every candidate song, by video id, with a running score and why it's there
    const cands = new Map<string, { hit: VideoHit; score: number; why: string }>();
    const ownIds = new Set(seeds.map((sd) => (sd.url ? extractYouTubeVideoId(sd.url) : null)).filter(Boolean));
    const isWanted = (h: VideoHit) =>
      h.lengthSeconds >= 90 &&
      h.lengthSeconds <= MAX_AUTO_SONG_SECONDS &&
      !ownIds.has(h.videoId) &&
      !/\b(8|16|24)[-_ ]*d\b/i.test(`${h.title} ${h.author || ''}`) &&
      !/\bmash[-_ ]*up\b/i.test(`${h.title} ${h.author || ''}`);
    const consider = (h: VideoHit, points: number, why: string) => {
      if (!isWanted(h)) return;
      if (focus) {
        const theirs = byFocus(focus, h);
        if (focus.only && !theirs) return; // "play only <artist>": nobody else
        if (theirs) points += 2; // "more <artist>": theirs first
      }
      const c = cands.get(h.videoId);
      if (c) {
        c.score += points; // recommended again from another song or source: stronger
        return;
      }
      cands.set(h.videoId, { hit: h, score: scoreHit(h, 0, taste) + points, why });
    };

    // 1. "People who play your songs also play…" and 2. "fans of your artists also like…", together
    const [relatedLists, newArtists, ideas] = await Promise.all([
      Promise.all(researchSeeds(seeds, focus).map(async (sd) => ({ sd, hits: await related(sd.videoId).catch(() => [] as VideoHit[]) }))),
      focus?.only ? Promise.resolve([] as string[]) : discoveryArtists(taste, seedArtist).catch(() => [] as string[]),
      useAi ? aiSongIdeas(seeds[0].title, seeds[0].artist, mood, taste, focus) : Promise.resolve([] as string[]),
    ]);
    for (const { sd, hits } of relatedLists) {
      hits.slice(0, 15).forEach((h, i) => consider(h, sd.weight * (1 - i / 20), 'played together with your songs'));
    }

    // 3. Searches: the AI's ideas (one song each), and the hits of new and favourite artists
    const ownArtists = [...new Set([seedArtist, ...taste.artists.slice(0, 3)].filter(Boolean) as string[])];
    const queries = [
      // The focus artists' hits, from a few angles so there are enough of them
      ...(focus?.artists ?? []).flatMap((a) =>
        (artistKey(a).length <= 3 ? [`${a} songs`, `${a} hits`, `${a} singer best songs`] : [a, `${a} hits`, `${a} best songs`]).map((q) => ({ q, keep: 8, depth: 20, points: 1, why: `by ${a}, as you asked` }))
      ),
      ...ideas.map((q) => ({ q, keep: 1, depth: 8, points: 1.5, why: 'AI DJ suggestion' })),
      ...newArtists.map((q) => ({ q, keep: 2, depth: 20, points: 1, why: `fans of your artists like ${q}` })),
      ...ownArtists.map((q) => ({ q, keep: 2, depth: 20, points: 0.5, why: `a hit by ${q}` })),
    ];
    const found = await mapLimit(queries, SEARCH_CONCURRENCY, async (item) => rankHits((await search(item.q)).filter(isWanted), taste, item.q, item.keep, item.depth), [] as VideoHit[]);
    found.forEach((hits, i) => hits.forEach((h) => consider(h, queries[i].points, queries[i].why)));

    // An artist focus: their channel's most viewed uploads are their hits, biggest first
    if (focus) {
      const channels = await mapLimit(focus.artists, 3, artistHits, [] as VideoHit[]);
      channels.forEach((hits) => hits.slice(0, 60).forEach((h, i) => consider(h, 2 - i / 40, `one of ${h.author}'s biggest songs`)));
    }

    // With an artist focus the listener's own songs by them are few: research from their top hits
    // too ("also played" lists of those, which for "only" keep just that artist's songs)
    if (focus) {
      const researched = new Set(relatedLists.map((l) => l.sd.videoId));
      const topHits = [...cands.values()]
        .filter((c) => byFocus(focus, c.hit) && !researched.has(c.hit.videoId))
        .sort((a, b) => b.score - a.score)
        .slice(0, FOCUS_EXTRA_SEEDS)
        .map((c) => c.hit.videoId);
      const more = await mapLimit(topHits, 4, related, [] as VideoHit[]);
      more.forEach((hits) => hits.slice(0, 20).forEach((h, i) => consider(h, 1 - i / 25, `played together with ${focus.artists[0]} songs`)));
    }

    // Little came back (instances busy): the hand-made list for the mood
    if (cands.size < 10 && !focus?.only) {
      const backup = fallbackQueries(seeds[0].title, seeds[0].artist, mood).slice(0, 8);
      const more = await mapLimit(backup, SEARCH_CONCURRENCY, async (q) => rankHits((await search(q)).filter(isWanted), taste, q, 1), [] as VideoHit[]);
      more.flat().forEach((h) => consider(h, 0, 'party favourite'));
    }

    const bannedKeys = new Set<string>();
    for (const b of readJsonArray<{ url?: string; title?: string }>(BANNED_SONGS_FILE)) {
      if (b.url) bannedKeys.add(b.url.toLowerCase());
      if (b.title) bannedKeys.add(b.title.toLowerCase());
    }
    const recommendations: Array<SearchResult & { why: string }> = [...cands.values()]
      .filter((c) => c.score > -1)
      .sort((a, b) => b.score - a.score)
      .map((c) => ({
        title: c.hit.title,
        url: canonicalYouTubeUrl(c.hit.videoId),
        author: c.hit.author || 'Artist',
        duration: c.hit.lengthSeconds || 180,
        thumbnail: c.hit.thumbnail,
        timestamp: formatDuration(c.hit.lengthSeconds || 180),
        why: c.why,
      }))
      .filter((r) => !bannedKeys.has(r.url.toLowerCase()) && !bannedKeys.has(r.title.toLowerCase()))
      .slice(0, MAX_RECOMMENDATIONS);

    // Every lookup failed (internet dropped mid-way): fall back to the local library
    res.end(
      JSON.stringify(
        recommendations.length
          ? { recommendations, research: { relatedFrom: relatedLists.filter((l) => l.hits.length).length, newArtists, aiIdeas: ideas.length } }
          : { recommendations: localRecommendations(seeds[0].title, seeds[0].artist, 12), offline: true }
      )
    );
  } catch (err) {
    logError('recommendations', err);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'Recommendation failed', details: String(err) }));
  }
  return;
}
