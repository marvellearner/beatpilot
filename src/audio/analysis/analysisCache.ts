/**
 * Saved analysis per song (everything but the energy envelope, which is cheap and large), so a
 * song played before needs no BPM / hook / intro / key detection after a reload.
 * Bump ANALYSIS_VERSION when a detector changes, so old results are measured again.
 */

import { ANALYSIS_FIELDS, AnalysisFields } from './trackAnalysis';

const ANALYSIS_VERSION = 1;
const STORAGE_KEY = `ai_dj_analysis_v${ANALYSIS_VERSION}`;
const MAX_SONGS = 800; // ~0.5 KB each
const SAVE_DELAY_MS = 2000;

type Saved = Omit<AnalysisFields, 'energyProfile'>;

let entries: Map<string, Saved> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function load(): Map<string, Saved> {
  if (entries) return entries;
  entries = new Map();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, Saved>)) entries.set(k, v);
  } catch {
    // Unreadable or blocked storage: start empty
  }
  return entries;
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(load())));
    } catch {
      // Storage full or blocked: the results stay for this session
    }
  }, SAVE_DELAY_MS);
}

/** The song's key: its source URL (or title + artist) and its length, so a different file never matches. */
export function analysisKey(song: { url?: string; title: string; artist?: string }, durationSeconds: number): string {
  const base = (song.url || `${song.title}|${song.artist ?? ''}`).trim().toLowerCase().replace(/[^a-z0-9|]/g, '');
  return `${base}|${Math.round(durationSeconds)}`;
}

export function getSavedAnalysis(key: string): Saved | undefined {
  return load().get(key);
}

export function saveAnalysis(key: string, f: AnalysisFields) {
  const map = load();
  const saved: Saved = {};
  for (const name of ANALYSIS_FIELDS) {
    if (name !== 'energyProfile' && f[name] !== undefined) (saved as Record<string, unknown>)[name] = f[name];
  }
  map.delete(key); // re-insert: the oldest songs are dropped first
  map.set(key, saved);
  while (map.size > MAX_SONGS) map.delete(map.keys().next().value!);
  scheduleSave();
}
