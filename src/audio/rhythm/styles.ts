/**
 * The dhol wala's taals: what the Live Rhythm Enhancer plays, on dhol or dholak, written as
 * 16-step bars (16th notes of a 4-beat bar).
 *
 * Like a dhol player at a wedding, each taal has several things to play, chosen bar by bar by
 * the score (dholScore.ts):
 * - `light`: keeps time softly under the singing (verses)
 * - `groove`: the full taal, for choruses, hooks and instrumental parts (several bars = variations)
 * - `answer`: a short phrase on beats 3–4, played in the gap between two vocal lines
 * - `break`: a 2-bar solo for a dhol break (a cue, or carrying the crowd through a mix)
 * Rolls, tihais and accents are built from the taal's voices (dholEvents.ts).
 *
 * Step characters: X accent, x normal, o ghost (soft), m muted stroke (the hand damps the head),
 * F flam (a soft grace stroke just before an accent), . rest.
 * `swing` moves every off-beat 8th later: 0 = straight, 1/3 = full triplet shuffle (bhangra's lilt).
 */
import type { VoiceId } from './kit';
import type { MoodId } from '../Moods';

export type RhythmStyleId = 'bhangra_chaal' | 'dhol_dhamaal' | 'luddi' | 'dholak_keherwa';

type Layer = Partial<Record<VoiceId, string[]>>;
type Phrase = Partial<Record<VoiceId, string>>;

export interface RhythmStyle {
  id: RhythmStyleId;
  name: string;
  instrument: 'dhol' | 'dholak';
  description: string;
  suits: string; // which songs it sits well on, shown in the UI
  swing: number;
  bass: VoiceId; // the low head (accents, the boom of a tihai)
  treble: VoiceId; // the high head (rolls, answers)
  light: Layer;
  groove: Layer;
  answer: Phrase; // beats 3–4 only (steps 8–15), laid over the light bar
  break: Layer; // 2 bars
}

export const RHYTHM_STYLES: RhythmStyle[] = [
  {
    id: 'bhangra_chaal',
    name: 'Bhangra Chaal',
    instrument: 'dhol',
    description: 'The swinging bhangra chaal: dagga on the one and the lift before three, tilli dancing in between.',
    suits: 'Punjabi songs, Bollywood dance numbers, baraat',
    swing: 0.28,
    bass: 'dholBass',
    treble: 'dholCrack',
    light: { dholBass: ['X.......m.......'], dholCrack: ['....o.......o...'] },
    groove: {
      dholBass: ['X.....x.X.......', 'X.....x.X.....m.', 'X.....x.X.......', 'X.....x.X...x.x.'],
      dholCrack: ['..x.X.x...x.X.x.', '..x.X.x...x.X.xo', 'o.x.X.x.o.x.X.x.', '..x.X.xox.x.XoXo'],
    },
    answer: { dholBass: '........X.....x.', dholCrack: '..........x.xxX.' },
    break: {
      dholBass: ['X..x..X.X..x..X.', 'X.x.X.x.X.X.X...'],
      dholCrack: ['.xx.xoxx.xx.xoXx', 'xoxoXoxoXxXxXX..'],
    },
  },
  {
    id: 'dhol_dhamaal',
    name: 'Dhamaal',
    instrument: 'dhol',
    description: 'Peak-time dhamaal: a boom on every beat and driving tilli 8ths. Full power.',
    suits: 'The biggest Punjabi and Bollywood bangers, peak moments',
    swing: 0.12,
    bass: 'dholBass',
    treble: 'dholCrack',
    light: { dholBass: ['X.......X.......'], dholCrack: ['..x...x...x...x.'] },
    groove: {
      dholBass: ['X...X...X...X...', 'X...X...X..xX.x.', 'X...X...X...X...', 'X...X.x.X...X.xX'],
      dholCrack: ['x.X.x.X.x.X.x.X.', 'xoX.x.XoxoX.x.Xo', 'x.X.x.X.x.X.x.X.', 'xoXoxoXoxoXoxXxX'],
    },
    answer: { dholBass: '........X.X.X...', dholCrack: '........xoXoxoX.' },
    break: {
      dholBass: ['X.X.X.X.X.X.X.X.', 'X...X...X.X.XXX.'],
      dholCrack: ['XoxoXoxoXoxoXoxo', 'xxxxxxxxXxXxXX..'],
    },
  },
  {
    id: 'luddi',
    name: 'Luddi',
    instrument: 'dhol',
    description: 'The bouncy luddi: a lilting two-step for folk boliyan and giddha.',
    suits: 'Punjabi folk, boliyan, giddha, jaago',
    swing: 0.33,
    bass: 'dholBass',
    treble: 'dholCrack',
    light: { dholBass: ['X.......X.......'], dholCrack: ['......x.......x.'] },
    groove: {
      dholBass: ['X.....X.X.....X.', 'X.....X.X...m.X.'],
      dholCrack: ['..x.x...X.x.x...', '..x.x.x.X.x.x.xo'],
    },
    answer: { dholBass: '........X.....X.', dholCrack: '..........x.x.X.' },
    break: {
      dholBass: ['X.x.X.x.X.x.X.x.', 'X.X.X.X.X.X.....'],
      dholCrack: ['.x.x.x.x.x.x.x.x', 'xxxxxxxxXXXX....'],
    },
  },
  {
    id: 'dholak_keherwa',
    name: 'Dholak Keherwa',
    instrument: 'dholak',
    description: 'The 8-beat keherwa on dholak (dha ge na ti na ka dhi na): lighter than dhol, made for singing along.',
    suits: 'Bollywood, sangeet, ladies sangeet, mid-tempo and romantic desi songs',
    swing: 0.18,
    bass: 'dholakGe',
    treble: 'dholakNa',
    light: { dholakGe: ['X.......x.......'], dholakNa: ['....x.......x...'] },
    groove: {
      dholakGe: ['X.x.........x...', 'X.x.......x.x...'],
      dholakNa: ['x...x.x.x.o...x.', 'x...x.x.x.o.o.x.'],
    },
    answer: { dholakGe: '........x.x.....', dholakNa: '..........x.xox.' },
    break: {
      dholakGe: ['X.x.X.x.X.x.XxXx', 'XxXxXxXxX.x.X...'],
      dholakNa: ['x.x.xox.x.xoxoxo', 'xoxoxoxoxoxoX...'],
    },
  },
];

export const RHYTHM_STYLE_IDS = RHYTHM_STYLES.map((s) => s.id) as [RhythmStyleId, ...RhythmStyleId[]];

export const getRhythmStyle = (id: RhythmStyleId | string): RhythmStyle =>
  RHYTHM_STYLES.find((s) => s.id === id) ?? RHYTHM_STYLES[0];

export const isRhythmStyleId = (id: unknown): id is RhythmStyleId => RHYTHM_STYLES.some((s) => s.id === id);

/** The taal a manual "choose myself" setup starts on in each mood. */
export const STYLE_FOR_MOOD: Record<MoodId, RhythmStyleId> = {
  normal: 'bhangra_chaal',
  party: 'bhangra_chaal',
  bhangra: 'bhangra_chaal',
  chill: 'dholak_keherwa',
  romantic: 'dholak_keherwa',
};

export interface StepHit {
  velocity: number; // 0 = no hit
  muted: boolean; // damped stroke: short decay
  flam: boolean; // with a grace stroke just before
}

const NO_HIT: StepHit = { velocity: 0, muted: false, flam: false };
const HITS: Record<string, StepHit> = {
  X: { velocity: 1, muted: false, flam: false },
  x: { velocity: 0.72, muted: false, flam: false },
  o: { velocity: 0.42, muted: false, flam: false },
  m: { velocity: 0.7, muted: true, flam: false },
  F: { velocity: 1, muted: false, flam: true },
};

/** The hit (or none) of a voice at `step` (0–15) of a bar, cycling multi-bar patterns. */
export function stepHit(bars: string[] | string | undefined, barIndex: number, step: number): StepHit {
  if (!bars) return NO_HIT;
  const bar = typeof bars === 'string' ? bars : bars[((barIndex % bars.length) + bars.length) % bars.length];
  return HITS[bar[step]] ?? NO_HIT;
}

/** Velocity only (0 = no hit), for callers that don't need the stroke type. */
export function hitVelocity(bars: string[] | string | undefined, barIndex: number, step: number): number {
  return stepHit(bars, barIndex, step).velocity;
}

/**
 * Where step `step` (0–15) of a bar falls, in beats from the bar start, with swing:
 * the off-beat 8th moves from 0.5 to 0.5 + swing/2 of a beat, and the 16ths in between
 * move proportionally so the feel stays even.
 */
export function swungBeatOffset(step: number, swing: number): number {
  const beat = Math.floor(step / 4);
  const offbeat = 0.5 + swing / 2;
  const within = [0, offbeat / 2, offbeat, (offbeat + 1) / 2][step % 4];
  return beat + within;
}
