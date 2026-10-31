/**
 * Research behind Up Next beyond plain search: which songs people who play the listener's songs
 * also play (YouTube's related list, through the third-party instances), which artists fans
 * of their artists also like (Deezer's public API, no key), and an artist's biggest songs (their
 * channel's most viewed uploads, via Invidious). Results are kept only briefly
 * (RESEARCH_TTL_MS) so suggestions follow what's popular now.
 */
import { channelPopular, relatedVideos, searchVideos, type VideoHit } from './audioSource';
import { artistKey } from '../shared/taste';

const RESEARCH_TTL_MS = 10 * 60_000; // related songs and search results: reused within one refill, fresh soon after
const ARTISTS_TTL_MS = 60 * 60_000; // "fans also like" barely changes within an evening
const DEEZER = 'https://api.deezer.com';
const DEEZER_TIMEOUT_MS = 8_000;

const store = new Map<string, { at: number; value: Promise<unknown> }>();

/** One lookup per key while it's fresh; a failed lookup isn't kept. */
function remember<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as Promise<T>;
  const value = load().catch((err) => {
    store.delete(key);
    throw err;
  });
  store.set(key, { at: Date.now(), value });
  if (store.size > 2000) store.delete(store.keys().next().value!);
  return value;
}

export const related = (videoId: string) => remember(`rel:${videoId}`, RESEARCH_TTL_MS, () => relatedVideos(videoId));
export const search = (query: string) => remember(`q:${query.toLowerCase().trim()}`, RESEARCH_TTL_MS, () => searchVideos(query));

async function deezer<T>(pathAndQuery: string): Promise<T> {
  const res = await fetch(`${DEEZER}${pathAndQuery}`, { signal: AbortSignal.timeout(DEEZER_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Deezer HTTP ${res.status}`);
  const j = (await res.json()) as T & { error?: { message?: string } };
  if (j.error) throw new Error(`Deezer: ${j.error.message ?? 'error'}`);
  return j;
}

/** Artists Deezer's listeners of `name` also listen to (empty if Deezer doesn't know the artist). */
export function fansAlsoLike(name: string): Promise<string[]> {
  return remember(`fans:${artistKey(name)}`, ARTISTS_TTL_MS, async () => {
    const found = await deezer<{ data?: Array<{ id: number; name: string }> }>(`/search/artist?q=${encodeURIComponent(name)}&limit=3`);
    const artist = found.data?.find((a) => artistKey(a.name) === artistKey(name)) ?? found.data?.[0];
    if (!artist || !artistKey(artist.name).includes(artistKey(name).slice(0, 6))) return [];
    const rel = await deezer<{ data?: Array<{ name: string }> }>(`/artist/${artist.id}/related?limit=15`);
    return (rel.data ?? []).map((a) => a.name);
  });
}

/** "The Chainsmokers" / "ChainsmokersVEVO" / "chainsmokers" are one name. */
// ("K.K. - Topic" is YouTube's own channel of an artist's songs: theirs too)
const bareName = (name: string) => artistKey(name).replace(/^the(?=.{3})/, '').replace(/(vevo|official|music|topic)$/, '');

/**
 * An artist's most viewed uploads on their own channel (found from a search for their name):
 * their hits, biggest first. Empty when no channel of theirs shows up.
 */
export function artistHits(name: string): Promise<VideoHit[]> {
  return remember(`hits:${bareName(name)}`, RESEARCH_TTL_MS, async () => {
    const want = bareName(name);
    const isTheirs = (h: VideoHit) => !!h.authorId && bareName(h.author) === want;
    // Their own channel, or YouTube's "<artist> - Topic" channel of their songs (common for singers
    // whose songs are on film labels' channels, e.g. "K.K. - Topic")
    const [byName, byTopic] = await Promise.all([search(name), search(`${name} topic`).catch(() => [] as VideoHit[])]);
    const channel = (byName.find(isTheirs) ?? byTopic.find(isTheirs))?.authorId;
    // Topic channels can't be listed by popularity through the instance: their search hits instead
    const popular = channel ? await channelPopular(channel).catch(() => [] as VideoHit[]) : [];
    return [...popular, ...byTopic.filter(isTheirs)];
  });
}

/** Runs `fn` over `items`, at most `limit` at a time; failures give `fallback`. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>, fallback: R): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]).catch(() => fallback);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export type { VideoHit };
