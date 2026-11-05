/**
 * A failed /api/search or /api/stream answer as an Error a listener can act on. The server says
 * why in its JSON `details` ("No audio source could provide this song (host: fetch failed; …)");
 * `statusText` alone showed "Search failed: Internal Server Error".
 */
export async function apiFailure(res: Response, what: 'search' | 'download'): Promise<Error> {
  let details = '';
  try {
    const body = await res.clone().json();
    details = String(body?.details ?? body?.error ?? '');
  } catch {
    // not JSON
  }
  return new Error(describeApiFailure(details, what, res.status));
}

/** The message for a failure's server details (pure, for tests). */
export function describeApiFailure(details: string, what: 'search' | 'download', status = 500): string {
  const sources = details.match(/\(([^)]*)\)\s*$/)?.[1] ?? '';
  const parts = sources.split(';').map((s) => s.trim()).filter(Boolean);
  if (parts.length && parts.every((p) => /fetch failed|ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH/i.test(p))) {
    return "couldn't reach the audio sources (the internet dropped for a moment?). Try again in a few seconds";
  }
  if (/No audio source could provide/i.test(details)) {
    return 'the audio sources don\'t have this upload right now. Try another result for the same song';
  }
  return `${what === 'search' ? 'search' : 'download'} failed (${details.slice(0, 120) || `HTTP ${status}`})`;
}
