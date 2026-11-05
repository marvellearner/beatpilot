/**
 * Turns one bar of the dhol wala's score into strokes: beat positions (0 = the bar's 1,
 * 4 = the next bar's 1), which head, how hard. Pure, so the scheduler and the tests share it.
 *
 * - A taal bar (light / groove / break) comes from the taal's 16-step patterns, with swing.
 * - An answer replaces beats 3–4 of a light bar with the taal's answer phrase.
 * - A roll replaces everything from `fromBeat` to the bar line with fast, straight strokes on the
 *   treble head getting louder (and the bass on each beat), landing on the next bar's accent.
 * - A tihai fills the bar with one phrase played three times so its last stroke lands on the next
 *   bar's 1 (that stroke is the next bar's accent).
 * - An accent is a full bass stroke with a flammed treble crack on the 1.
 */
import { stepHit, swungBeatOffset, type RhythmStyle } from './styles';
import type { VoiceId } from './kit';

export interface Hit {
  beat: number; // 0 … <4, from the bar's 1
  voice: VoiceId;
  velocity: number; // 0–~1.15
  muted?: boolean; // damped stroke
}

export type BarPlay =
  | { kind: 'rest' }
  | { kind: 'light'; answer?: boolean }
  | { kind: 'groove'; variation: number }
  | { kind: 'break'; part: number }; // 0, 1: the two bars of the taal's break

export interface BarExtras {
  accent?: boolean;
  // A roll from `fromBeat` to the bar line. A roll across two bars sets `from`/`to`: how far along
  // the whole roll this bar's part starts and ends (0…1), so the crescendo is one continuous rise
  roll?: { fromBeat: number; from?: number; to?: number };
  tihai?: boolean;
}

// How present each kind of bar is (the light bar sits under the singing)
const LEVEL = { light: 0.72, groove: 1, break: 1.05, answer: 0.92 } as const;
const FLAM_SECONDS = 0.022; // a grace stroke this long before the accent
const ROLL_STROKE_SECONDS = 0.07; // a dhol roll's strokes, about 14 a second

function patternHits(layer: Partial<Record<VoiceId, string[] | string>>, barIndex: number, style: RhythmStyle, beatSeconds: number, level: number, fromStep = 0, toStep = 16): Hit[] {
  const hits: Hit[] = [];
  for (const [voice, bars] of Object.entries(layer) as Array<[VoiceId, string[] | string]>) {
    for (let step = fromStep; step < toStep; step++) {
      const h = stepHit(bars, barIndex, step);
      if (h.velocity <= 0) continue;
      const beat = swungBeatOffset(step, style.swing);
      if (h.flam) hits.push({ beat: Math.max(0, beat - FLAM_SECONDS / beatSeconds), voice: style.treble, velocity: 0.42 * level });
      hits.push({ beat, voice, velocity: h.velocity * level, muted: h.muted || undefined });
    }
  }
  return hits;
}

function tihaiHits(style: RhythmStyle): Hit[] {
  // Phrase "X . x . X" (5 steps) three times with a 1-step gap: starts on 0, 6, 12; the third
  // phrase's last stroke would be step 16 = the next bar's 1 (played there as its accent)
  const hits: Hit[] = [];
  [0, 6, 12].forEach((start, i) => {
    const v = 0.78 + i * 0.11;
    for (const [offset, strong] of [[0, true], [2, false], [4, true]] as const) {
      const step = start + offset;
      if (step >= 16) continue;
      const beat = step / 4;
      hits.push({ beat, voice: style.treble, velocity: strong ? v : v * 0.7 });
      if (strong) hits.push({ beat, voice: style.bass, velocity: v * 0.95 });
    }
  });
  return hits;
}

/** Roll velocity at `t` (0 … 1 along the whole roll): soft start, a steep rise to the landing. */
export const rollVelocity = (t: number) => 0.3 + 0.75 * Math.pow(Math.max(0, Math.min(1, t)), 1.4);

function rollHits(style: RhythmStyle, fromBeat: number, beatSeconds: number, from = 0, to = 1): Hit[] {
  const perBeat = Math.max(3, Math.min(8, Math.round(beatSeconds / ROLL_STROKE_SECONDS)));
  const total = Math.round((4 - fromBeat) * perBeat);
  const hits: Hit[] = [];
  for (let i = 0; i < total; i++) {
    const beat = fromBeat + i / perBeat;
    const local = total > 1 ? i / (total - 1) : 1; // 0 … 1 across this bar's part
    const t = from + (to - from) * local; // … across the whole roll
    hits.push({ beat, voice: style.treble, velocity: rollVelocity(t) });
    if (i % perBeat === 0) hits.push({ beat, voice: style.bass, velocity: 0.55 + 0.4 * t });
  }
  return hits;
}

/** The strokes of one bar. `barIndex` cycles the taal's multi-bar patterns. */
export function barHits(style: RhythmStyle, play: BarPlay, extras: BarExtras, barIndex: number, beatSeconds: number): Hit[] {
  let hits: Hit[] = [];
  if (extras.tihai) {
    hits = tihaiHits(style);
  } else {
    switch (play.kind) {
      case 'rest':
        break;
      case 'light':
        if (play.answer) {
          hits = [
            ...patternHits(style.light, barIndex, style, beatSeconds, LEVEL.light, 0, 8),
            ...patternHits(style.answer, barIndex, style, beatSeconds, LEVEL.answer, 8, 16),
          ];
        } else {
          hits = patternHits(style.light, barIndex, style, beatSeconds, LEVEL.light);
        }
        break;
      case 'groove':
        hits = patternHits(style.groove, play.variation, style, beatSeconds, LEVEL.groove);
        break;
      case 'break':
        hits = patternHits(style.break, play.part, style, beatSeconds, LEVEL.break);
        break;
    }
  }
  if (extras.roll) {
    const from = Math.max(0, Math.min(3.75, extras.roll.fromBeat));
    hits = [...hits.filter((h) => h.beat < from - 1e-6), ...rollHits(style, from, beatSeconds, extras.roll.from, extras.roll.to)];
  }
  if (extras.accent) {
    // The 1 belongs to the accent: a full boom and a flammed crack instead of whatever was there
    hits = hits.filter((h) => h.beat > 1e-6);
    hits.push({ beat: 0, voice: style.bass, velocity: 1.1 });
    hits.push({ beat: 0, voice: style.treble, velocity: 1.05 });
    // The flam's grace stroke comes just before the 1: a negative beat (the scheduler plays it
    // at the end of the previous bar's time)
    hits.push({ beat: -FLAM_SECONDS / beatSeconds, voice: style.treble, velocity: 0.45 });
  }
  return hits.sort((a, b) => a.beat - b.beat);
}
