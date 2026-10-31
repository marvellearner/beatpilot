/**
 * Research behind Up Next beyond plain search: which songs people who play the listener's songs
 * also play (YouTube's related list, through the third-party instances), and which artists fans
 * of their artists also like (Deezer's public API, no key). Results are kept only briefly
 * (RESEARCH_TTL_MS) so suggestions follow what's popular now.
 */
import { relatedVideos, searchVideos, type VideoHit } from './audioSource';
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
