/**
 * Loudness matching: every song is trimmed toward the same level, so a quiet older track
 * doesn't drop the room's energy after a loud modern master (and vice versa).
 *
 * The measure is the RMS level of a song's loud parts (75th percentile of its 0.1 s frames,
 * from MixPointPlanner's EnergyProfile). On 40 songs from this app's cache it tracked the
 * EBU R128 integrated loudness (LUFS) with a correlation of 0.89; library median -9.5 dB
 * (about -8.3 LUFS), range about -14 to -7 dB.
 */
import type { EnergyProfile } from './MixPointPlanner';

const TARGET_DB = -9.5; // the library's median: most songs barely change
const MAX_BOOST_DB = 4; // boosting further mostly drives the master limiter
const MAX_CUT_DB = 6;

/** RMS level (dBFS) of the song's loud parts. */
export function measureLoudnessDb(profile: EnergyProfile): number {
  const frames = Array.from(profile.full).filter((v) => v > 1e-4); // ignore digital silence
  if (!frames.length) return TARGET_DB;
  frames.sort((a, b) => a - b);
  return 20 * Math.log10(frames[Math.floor(frames.length * 0.75)]);
}

/** The trim (dB) that brings a song of `loudnessDb` to the target level. */
export function loudnessGainDb(loudnessDb: number): number {
  return Math.max(-MAX_CUT_DB, Math.min(MAX_BOOST_DB, TARGET_DB - loudnessDb));
}
