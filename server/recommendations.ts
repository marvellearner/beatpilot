/** "What should play next": AI-curated song suggestions with a hand-made per-mood fallback. */
import fs from 'fs';
// @ts-expect-error yt-search has untyped default export
import ytSearch from 'yt-search';
import { IncomingMessage, ServerResponse } from 'http';
import { ollamaGenerate } from './llm';
import { isOnline, localRecommendations } from './localLibrary';
import { SearchResult } from './youtube';
import { BANNED_SONGS_FILE } from './library';

/**
 * Suggests 5 stylistically and energetically compatible song queries
 * using local Ollama if available, with intelligent fallback heuristics.
 */
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

export async function generateRelatedSongQueries(currentTitle: string, artist: string, mood: string = 'normal'): Promise<string[]> {
  const combined = `${currentTitle} ${artist}`.toLowerCase();
  const moodDescription = MOOD_PROMPTS[mood] ?? MOOD_PROMPTS.normal;

  // Try local Ollama first for creative curation
  try {
    const prompt = `You are a professional club/party AI DJ.
CURRENT PLAYING SONG: "${currentTitle}" by "${artist}".
THE MOOD OF THE PARTY: ${moodDescription}.
Suggest exactly 25 to 30 songs that fit this mood and are musically, culturally, and energetically compatible to play NEXT in the DJ set.
Return a STRICT JSON object with key "suggestions" containing an array of 25-30 song titles with artists.
Example: { "suggestions": ["Diljit Dosanjh - Lover", "Sidhu Moose Wala - 295", "AP Dhillon - Brown Munde", "Karan Aujla - Softly", "Badshah - Jugnu", "Shubh - Cheques", "Yo Yo Honey Singh - Blue Eyes", "Guru Randhawa - High Rated Gabru", "Mika Singh - Subha Hone Na De", "Arijit Singh - Ghungroo"] }
Output ONLY valid JSON.`;

    // Runs in the background, so give the CPU model time: ~4 s warm, up to ~12 s cold.
    const parsed = JSON.parse(await ollamaGenerate(prompt, 200, 20_000));
    if (Array.isArray(parsed.suggestions) && parsed.suggestions.length >= 3) {
      return parsed.suggestions.slice(0, 30);
    }
  } catch {
    // Fall back to party graph heuristics
  }

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

    // Get curated recommendations using Ollama or genre intelligence (10-12 suggestions)
    const queries = await generateRelatedSongQueries(currentTitle, artist, mood);

    // Run YouTube searches in parallel for speed
    const searchPromises = queries.map(async (q) => {
      try {
        const searchRes = await ytSearch(q);
        if (searchRes.videos && searchRes.videos.length > 0) {
          return searchRes.videos
            .filter((v) => !v.seconds || v.seconds <= 300)
            .slice(0, 2)
            .map((v) => ({
              title: v.title,
              url: v.url,
              author: v.author?.name || 'Artist',
              duration: v.seconds || 180,
              thumbnail: v.thumbnail || '',
              timestamp: v.timestamp || '',
            }));
        }
      } catch {
        return [];
      }
      return [];
    });

    let bannedKeys = new Set<string>();
    try {
      if (fs.existsSync(BANNED_SONGS_FILE)) {
        const bannedData = JSON.parse(fs.readFileSync(BANNED_SONGS_FILE, 'utf-8') || '[]');
        for (const b of bannedData) {
          if (b.url) bannedKeys.add(b.url.toLowerCase());
          if (b.title) bannedKeys.add(b.title.toLowerCase());
        }
      }
    } catch {}

    const settled = await Promise.all(searchPromises);
    const rawRecommendations = settled.flat();
    const seen = new Set<string>();
    const recommendations: SearchResult[] = [];
    for (const r of rawRecommendations) {
      if (r.duration && r.duration > 300) continue;
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
    console.error('Recommendation error:', err);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'Recommendation failed', details: String(err) }));
  }
  return;
}
