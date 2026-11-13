/**
 * The two "special" mixes a DJ saves for the right moment (MIXING_RULES.md "Drop mix" and
 * "Vocal overlay"):
 *
 * - Drop mix: song A builds up (loop roll riser: the loop speeds up, a filter rises, a noise
 *   riser), then song B lands straight on its drop, on beat 1. Works whatever the tempos, since
 *   there's no blend.
 * - Vocal overlay: song B's vocals (its deck's vocal isolator, music down) ride over song A's beat
 *   (A's mids cut, so its own vocals step back) for a few bars before B's chorus. On the chorus
 *   downbeat B's full music comes in and A drops out. Needs beatmatched tempos, keys known to fit,
 *   and B past its intro, since both play together.
 */
import type { SongHook } from '../../types';

export type SpecialMix = 'drop' | 'overlay';

/** Mixes in between two special mixes, so each keeps its impact. */
export const SPECIAL_MIX_EVERY = 4;
/** Bars of song B's vocals over song A's beat before B's chorus comes in. */
export const OVERLAY_BARS = 8;

interface SongShape {
  bpm?: number;
  duration?: number;
  musicStartTime?: number;
  highlightTime?: number;
  hooks?: SongHook[];
}

const barSeconds = (s: SongShape) => 240 / (s.bpm || 120);

/**
 * Where song B's drop is (song seconds), for a drop mix: its detected drop, else its first chorus,
 * else its hook. Undefined when it's too close to the start (that's the intro, nothing to drop
 * into) or leaves less than a minute of song.
 */
export function dropPoint(song: SongShape): number | undefined {
  if (!song.bpm || !song.duration) return undefined;
  const hooks = song.hooks ?? [];
  const start = (song.musicStartTime ?? 0) + 4 * barSeconds(song);
  const candidates = [
    hooks.find((h) => h.kind === 'drop' && h.time >= start)?.time,
    hooks.find((h) => h.kind === 'chorus' && h.time >= start)?.time,
    song.highlightTime !== undefined && song.highlightTime >= start ? song.highlightTime : undefined,
  ];
  const time = candidates.find((t) => t !== undefined);
  return time !== undefined && time >= 15 && time <= song.duration - 60 ? time : undefined;
}

/**
 * Where song B starts for a vocal overlay (its vocals, OVERLAY_BARS before its chorus) and the
 * chorus it reveals. Undefined when the chorus comes too early for the bars before it.
 */
export function overlayCue(song: SongShape): { cue: number; chorus: number } | undefined {
  if (!song.bpm || !song.duration) return undefined;
  const hooks = song.hooks ?? [];
  const chorus = hooks.find((h) => h.kind === 'chorus')?.time ?? song.highlightTime;
  if (chorus === undefined || chorus > song.duration - 60) return undefined;
  const cue = chorus - OVERLAY_BARS * barSeconds(song);
  // Past the intro (at least 8 bars into the music), so it's a verse or pre-chorus with singing in
  // it: an intro through the vocal isolator is only faint leftover instruments
  return cue >= (song.musicStartTime ?? 0) + 8 * barSeconds(song) ? { cue, chorus } : undefined;
}

/**
 * Whether this mix is a special one, and which. Never two close together; they take turns.
 * @param mixesSince mixes since the last special one
 * @param last the last special mix played, if any
 */
export function pickSpecialMix(situation: {
  mood: string;
  matched: boolean;
  keyFit: 'good' | 'ok' | 'clash' | 'unknown' | undefined;
  hasDrop: boolean;
  hasOverlay: boolean;
  mixesSince: number;
  last: SpecialMix | null;
}): SpecialMix | null {
  const { mood, matched, keyFit, hasDrop, hasOverlay, mixesSince, last } = situation;
  if (mixesSince < SPECIAL_MIX_EVERY - 1) return null;
  const calm = mood === 'chill' || mood === 'romantic';
  const drop = hasDrop && !calm; // a drop needs a dance floor
  // Both play together: tempos must match and the keys must be known to fit. An unknown key let
  // Naina (7A) sing over Never Fold (1B), opposite sides of the key wheel.
  const overlay = hasOverlay && matched && (keyFit === 'good' || keyFit === 'ok');
  if (drop && overlay) return last === 'drop' ? 'overlay' : 'drop';
  return drop ? 'drop' : overlay ? 'overlay' : null;
}

/**
 * The crossfader during a vocal overlay: from where it is to the middle in the first moments (both
 * songs heard: the old one's beat, the new one's vocals), held there, then fully over to the new
 * song at the reveal.
 * @param revealAt the reveal, as a fraction (0…1) of the whole mix
 */
export function overlayFaderAt(start: number, target: number, revealAt: number): (progress: number) => number {
  const rampEnd = revealAt / 16;
  return (p) => (p >= revealAt ? target : p < rampEnd ? start + (0 - start) * (p / rampEnd) : 0);
}
