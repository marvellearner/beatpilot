/**
 * The listener's taste, worked out from their own library: who they play most (Most Played,
 * weighted by play count and how recently), their favourites, what they just played, and what
 * they banned. Recommendations use it twice: the AI is told about it when it suggests songs,
 * and search results by artists they like are preferred over other hits.
 *
 * Pure functions: the server builds it from data/*.json, the browser from its own copies.
 */

export interface TasteSong {
  title?: string;
  artist?: string;
  playCount?: number;
  lastPlayed?: number;
}

export interface TasteProfile {
  artists: string[]; // most played first
  loved: string[]; // favourites and most played songs
  recent: string[]; // just played: not to be suggested again
  avoidArtists: string[];
  avoidSongs: string[];
}

export const EMPTY_TASTE: TasteProfile = { artists: [], loved: [], recent: [], avoidArtists: [], avoidSongs: [] };

const DAY_MS = 86_400_000;
const MAX_ARTISTS = 8;

// Channel names that are record labels or compilers, not the singer
const LABEL =
  /\b(t-series|sony music|zee music|speed records|saregama|tips (official|music|films)|yrf|being punjabi|sadda punjab|folk n funky|latinhype|rehaan records|white hill|desi melodies|geet mp3|times music|eros now|shemaroo|jjust music|naresh parmar|records|music company|official channel)\b/i;
const NOT_ARTIST = /^(unknown artist|unknown|artist|artists|searching\.*|various artists|party hits|https?:.*)$/i;

/** Lower case letters and digits only, so "LuisFonsiVEVO", "Luis Fonsi" and "LUIS FONSI" agree. */
export const artistKey = (name: string) => name.toLowerCase().replace(/vevo$/, '').replace(/[^\p{L}\p{N}]/gu, '');

function cleanName(name: string): string {
  return name
    .replace(/\s*-\s*topic$/i, '')
    .replace(/vevo$/i, '')
    .replace(/\s*\(?official\)?$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const splitNames = (s: string) => s.split(/\s*(?:,|&|\||\bft\.?|\bfeat\.?|\bfeaturing\b|\bwith\b|\s[xX]\s)\s*/i);
const usable = (name: string) => name.length >= 2 && name.length <= 40 && !LABEL.test(name) && !NOT_ARTIST.test(name) && name.split(' ').length <= 4;

/**
 * The song's artists, main one first: from the artist field unless that's a label's channel,
 * otherwise from the "Artist - Song" or "Artist: Song" part of the title.
 */
export function songArtists(song: TasteSong): string[] {
  const fromField = splitNames(song.artist || '').map(cleanName).filter(usable);
  if (fromField.length) return fromField.slice(0, 3);
  const title = song.title || '';
  const lead = title.match(/^([^|:()\[\]-]{2,60}?)(?:\s*:|\s+[-–])\s+/)?.[1];
  return lead ? splitNames(lead).map(cleanName).filter(usable).slice(0, 3) : [];
}

/** The song's name without "(Official Music Video)", "| T-Series" and the like. */
export function cleanTitle(title: string): string {
  return (
    title
      .split('|')[0]
      .replace(/[([][^)\]]*(official|video|audio|lyric|full song|hd)[^)\]]*[)\]]/gi, '')
      .replace(/\b(official (music )?(video|audio)|full (video|song)|hd video)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 70) || title.slice(0, 70)
  );
}

export function buildTaste(
  input: {
    history?: TasteSong[];
    favourites?: TasteSong[];
    recent?: TasteSong[];
    banned?: TasteSong[];
    avoidArtists?: string[]; // e.g. artists whose songs were removed from Up Next tonight
  },
  now = Date.now()
): TasteProfile {
  const scores = new Map<string, { name: string; score: number }>();
  const add = (song: TasteSong, weight: number) => {
    songArtists(song).forEach((name, i) => {
      const key = artistKey(name);
      if (key.length < 3) return;
      const entry = scores.get(key) ?? { name, score: 0 };
      // Prefer the spelling with spaces ("Luis Fonsi" over "LuisFonsi")
      if (!entry.name.includes(' ') && name.includes(' ')) entry.name = name;
      entry.score += i === 0 ? weight : weight / 2; // featured artists count half
      scores.set(key, entry);
    });
  };

  const history = (input.history || []).filter((s) => s.title);
  for (const s of history) {
    const plays = Math.max(1, s.playCount || 1);
    const fresh = s.lastPlayed && now - s.lastPlayed < 30 * DAY_MS ? 1 : 0.6;
    add(s, (1 + Math.log2(plays)) * fresh);
  }
  for (const s of input.favourites || []) add(s, 3);
  for (const s of input.recent || []) add(s, 1);

  const bannedCount = new Map<string, { name: string; n: number }>();
  for (const s of input.banned || []) {
    const name = songArtists(s)[0];
    if (!name) continue;
    const e = bannedCount.get(artistKey(name)) ?? { name, n: 0 };
    e.n++;
    bannedCount.set(artistKey(name), e);
  }
  const avoidArtists = [...bannedCount.values()].filter((e) => e.n >= 2).map((e) => e.name);
  for (const name of input.avoidArtists || []) {
    if (!avoidArtists.some((a) => artistKey(a) === artistKey(name))) avoidArtists.push(name);
  }
  const avoidKeys = new Set(avoidArtists.map(artistKey));

  const artists = [...scores.entries()]
    .filter(([key]) => !avoidKeys.has(key))
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, MAX_ARTISTS)
    .map(([, e]) => e.name);

  const loved = [
    ...(input.favourites || []),
    ...[...history].sort((a, b) => (b.playCount || 0) - (a.playCount || 0)).filter((s) => (s.playCount || 0) >= 3),
  ]
    .map((s) => cleanTitle(s.title || ''))
    .filter((t, i, all) => t && all.indexOf(t) === i)
    .slice(0, 10);

  return {
    artists,
    loved,
    recent: (input.recent || []).map((s) => cleanTitle(s.title || '')).filter(Boolean).slice(0, 12),
    avoidArtists,
    avoidSongs: (input.banned || []).map((s) => cleanTitle(s.title || '')).filter(Boolean).slice(0, 15),
  };
}

/** The taste as lines for an AI prompt; empty when there's no history yet. */
export function tasteForPrompt(t: TasteProfile): string {
  const lines: string[] = [];
  if (t.artists.length) lines.push(`- Artists they play most: ${t.artists.join(', ')}`);
  if (t.loved.length) lines.push(`- Songs they love: ${t.loved.join('; ')}`);
  if (t.recent.length) lines.push(`- Just played (do NOT suggest these again): ${t.recent.join('; ')}`);
  if (t.avoidArtists.length) lines.push(`- Never suggest songs by: ${t.avoidArtists.join(', ')}`);
  if (t.avoidSongs.length) lines.push(`- Never suggest: ${t.avoidSongs.join('; ')}`);
  return lines.length ? `THE LISTENER'S TASTE (from their own play history):\n${lines.join('\n')}` : '';
}

// Versions that don't belong in a DJ set (unless the search asked for one)
const UNWANTED =
  /\b(slowed|reverb|lo-?fi|8d|nightcore|sped up|speed up|karaoke|instrumental|cover|reaction|jukebox|mashup|non[- ]?stop|1 hour|hour loop|ringtone|status|teaser|trailer|unplugged|live (at|in|from|performance|concert|show)|tonight show|show starring|interview|vlog|jhankar)\b/i;
const OFFICIAL = /\b(official (music )?(video|audio)|full (video|song))\b/i;

/**
 * How good a search hit is as a pick: early results, official versions, artists the listener
 * plays and songs most people know (many views, out for a while) score higher; remixed or
 * cut-down versions, shorts, brand-new uploads and avoided artists lower.
 * `depth` is how many results were considered: the search order counts for up to 2 points.
 */
export function scoreHit(
  hit: Hit,
  index: number,
  taste: TasteProfile,
  query = '',
  depth = 8,
  now = Date.now()
): number {
  let score = (-2 * index) / depth;
  const text = artistKey(`${hit.title} ${hit.author || ''}`);
  const liked = taste.artists.findIndex((a) => {
    const key = artistKey(a);
    return key.length >= 4 && text.includes(key);
  });
  if (liked >= 0) score += 2 - liked * 0.15;
  if (taste.avoidArtists.some((a) => artistKey(a).length >= 4 && text.includes(artistKey(a)))) score -= 6;

  const unwanted = `${hit.title} ${hit.author || ''}`.match(UNWANTED)?.[0]; // the channel too, e.g. "Mei Lofi"
  if (unwanted && !query.toLowerCase().includes(unwanted.toLowerCase())) score -= 5; // outweighs a liked artist
  if (/#\w/.test(hit.title)) score -= 3; // fan clips and shorts are tagged; artists' releases rarely are
  if (OFFICIAL.test(hit.title)) score += 0.5;
  if (hit.lengthSeconds && hit.lengthSeconds < 90) score -= 4; // shorts and previews

  // Well known: about 3 M views is neutral, 100 M+ a hit, under 100 k obscure
  if (hit.viewCount) score += Math.max(-1.5, Math.min(1.5, 0.5 * (Math.log10(hit.viewCount) - 6.5)));
  // Brand-new uploads are songs nobody knows yet
  const ageDays = hit.publishedAt ? (now - hit.publishedAt) / 86_400_000 : Infinity;
  if (ageDays < 30) score -= 1.5;
  else if (ageDays < 120) score -= 0.5;
  return score;
}

type Hit = { title: string; author?: string; lengthSeconds?: number; viewCount?: number; publishedAt?: number };

/** Hits worth keeping, best first, from the first `depth` results. */
export function rankHits<T extends Hit>(hits: T[], taste: TasteProfile, query = '', keep = 2, depth = 8): T[] {
  const isQuery8d = /\b(8|16|24)[-_ ]*d\b/i.test(query);
  const isQueryMashup = /\bmash[-_ ]*up\b/i.test(query);
  return hits
    .slice(0, depth)
    .filter((hit) => {
      const text = `${hit.title} ${hit.author || ''}`;
      if (!isQuery8d && /\b(8|16|24)[-_ ]*d\b/i.test(text)) return false;
      if (!isQueryMashup && /\bmash[-_ ]*up\b/i.test(text)) return false;
      return true;
    })
    .map((hit, i) => ({ hit, score: scoreHit(hit, i, taste, query, depth) }))
    .filter((h) => h.score > -2.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, keep)
    .map((h) => h.hit);
}
