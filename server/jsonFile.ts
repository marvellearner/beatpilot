/**
 * JSON files under data/ that must never be lost: written to a temp file and renamed into place
 * (so a crash mid-write leaves the old file intact), and a file that doesn't parse is set aside
 * as a backup rather than silently replaced by an empty list on the next save.
 */
import * as fs from 'fs';
import * as path from 'path';
import { logError } from './logger';

/** Reads a JSON array; a missing file is an empty list, an unreadable one is backed up first. */
export function readJsonArray<T>(file: string): T[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch {
    return []; // not created yet
  }
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as T[];
  } catch {
    // fall through to the backup
  }
  const backup = `${file}.corrupt-${Date.now()}`;
  try {
    fs.renameSync(file, backup);
    console.error(`[data] ${path.basename(file)} could not be read; kept it as ${path.basename(backup)} and started a new one`);
  } catch (err) {
    console.error(`[data] ${path.basename(file)} could not be read or backed up:`, err);
  }
  return [];
}

/** Writes JSON atomically: a crash or power cut leaves either the old file or the new one. */
export function writeJsonAtomic(file: string, data: unknown, pretty = true) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, pretty ? 2 : undefined), 'utf-8');
  fs.renameSync(tmp, file);
}
