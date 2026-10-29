/** Hot cues: 4 saved points per song (by song key), kept in this browser across sessions. */

export const HOT_CUE_SLOTS = 4;
const STORAGE_KEY = 'ai_dj_hot_cues';
const MAX_SONGS = 500;

type Store = Record<string, { cues: Array<number | null>; at: number }>;

function read(): Store {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function loadHotCues(song: string): Array<number | null> {
  const cues = read()[song]?.cues ?? [];
  return Array.from({ length: HOT_CUE_SLOTS }, (_, i) => (typeof cues[i] === 'number' ? cues[i] : null));
}

export function saveHotCues(song: string, cues: Array<number | null>) {
  try {
    const all = read();
    if (cues.every((c) => c === null)) delete all[song];
    else all[song] = { cues, at: Date.now() };
    // Keep the most recently edited songs
    const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at);
    for (const k of keys.slice(MAX_SONGS)) delete all[k];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // storage unavailable: cues last until reload
  }
}
