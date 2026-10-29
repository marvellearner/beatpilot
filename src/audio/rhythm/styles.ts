/**
 * Rhythm styles for the Live Rhythm Enhancer, written as 16-step bars (16th notes).
 *
 * Each style has three versions: `light` (verses, quieter parts), `full` (choruses, drops)
 * and `fill` (the last bar before the energy rises, and the end of every 8-bar phrase in
 * full sections). A voice with several bars cycles through them for variation.
 *
 * Step characters: X = accent, x = normal, o = ghost (soft), . = rest.
 * `swing` moves every off-beat 8th later: 0 = straight, 1/3 = full triplet shuffle.
 */
import type { VoiceId } from './kit';
import type { MoodId } from '../Moods';

export type RhythmStyleId =
  | 'dhol_chaal'
  | 'dhol_dhamaal'
  | 'dholak_keherwa'
  | 'clap_tambourine'
  | 'club_tops'
  | 'club_drive'
  | 'afro_groove'
  | 'light_shaker';

type Layer = Partial<Record<VoiceId, string[]>>;

export interface RhythmStyle {
  id: RhythmStyleId;
  name: string;
  description: string;
  suits: string; // which songs it sits well on, shown in the UI
  swing: number;
  light: Layer;
  full: Layer;
  fill: Partial<Record<VoiceId, string>>;
}

export const RHYTHM_STYLES: RhythmStyle[] = [
  {
    id: 'dhol_chaal',
    name: 'Dhol Chaal',
    description: 'The classic bhangra dhol shuffle: boom on the beat, stick crack on the off-beats.',
    suits: 'Punjabi, bhangra, wedding songs',
    swing: 0.28,
    light: { dholBass: ['X.......X.......'], dholCrack: ['....x.......x...'] },
    full: {
      dholBass: ['X.....x.X.....x.', 'X.....x.X...x.x.'],
      dholCrack: ['..x.X.x...x.X.x.', '..x.X.x...x.X.xo'],
    },
    fill: { dholBass: 'X.......X...X.X.', dholCrack: '..x.X.x.XoxoXxXX' },
  },
  {
    id: 'dhol_dhamaal',
    name: 'Dhol Dhamaal',
    description: 'Peak-time dhol: a boom on every beat and driving cracks for the biggest moments.',
    suits: 'High-energy Punjabi and Bollywood bangers',
    swing: 0.12,
    light: { dholBass: ['X.......X.......'], dholCrack: ['..x...x...x...x.'] },
    full: {
      dholBass: ['X...X...X...X...', 'X...X...X..xX.x.'],
      dholCrack: ['x.X.x.X.x.X.x.X.', 'xoX.x.XoxoX.x.Xo'],
    },
    fill: { dholBass: 'X...X...X.X.XXXX', dholCrack: 'XoxoXoxoXxXxXXXX' },
  },
  {
    id: 'dholak_keherwa',
    name: 'Dholak Keherwa',
    description: 'The 8-beat keherwa on dholak (dha ge na ti na ka dhi na), lighter than dhol.',
    suits: 'Bollywood, sangeet, folk and mid-tempo desi songs',
    swing: 0.18,
    light: { dholakGe: ['X.......x.......'], dholakNa: ['....x.......x...'] },
    full: {
      dholakGe: ['X.x.........x...', 'X.x.......x.x...'],
      dholakNa: ['x...x.x.x.o...x.', 'x...x.x.x.o.o.x.'],
      tambourine: ['....x.......x...'],
    },
    fill: { dholakGe: 'X.x.X.x.X.x.XxXx', dholakNa: 'x.x.x.xox.xoxoxo' },
  },
  {
    id: 'clap_tambourine',
    name: 'Clap & Tambourine',
    description: 'Claps on 2 and 4 with a tambourine shuffle. No low end, so it fits on almost anything.',
    suits: 'Pop, Bollywood, anything with its own strong drums',
    swing: 0.05,
    light: { tambourine: ['..x...x...x...x.'] },
    full: { clap: ['....X.......X...'], tambourine: ['o.x.o.x.o.x.o.x.'] },
    fill: { clap: '....X...X.X.XXXX', tambourine: 'oxoxoxoxoxoxXxXx' },
  },
  {
    id: 'club_tops',
    name: 'Club Tops',
    description: 'House-style shaker and claps on top of the song. Adds drive without touching the kick.',
    suits: 'House, EDM, dance remixes',
    swing: 0,
    light: { shaker: ['..x...x...x...x.'] },
    full: { shaker: ['o.Xoo.Xoo.Xoo.Xo'], clap: ['....X.......X...'] },
    fill: { clap: '....X...X..XX.XX', shaker: 'oxoxoxoxoxoxXXXX', tambourine: '........x.x.x.xX' },
  },
  {
    id: 'club_drive',
    name: 'Club Drive (with kick)',
    description: 'Four-on-the-floor kick, claps and shaker. Only for songs whose own kick is weak or missing.',
    suits: 'Songs with soft or no drums',
    swing: 0,
    light: { kick: ['X.......X.......'], shaker: ['..x...x...x...x.'] },
    full: { kick: ['X...X...X...X...'], clap: ['....X.......X...'], shaker: ['o.Xoo.Xoo.Xoo.Xo'] },
    fill: { kick: 'X...X...X.X.XXXX', clap: '....X...X.X.XXXX' },
  },
  {
    id: 'afro_groove',
    name: 'Afro Groove',
    description: 'Congas, a son clave on sticks, shaker and a soft frame-drum pulse.',
    suits: 'Afrobeats, amapiano, reggaeton, Latin',
    swing: 0.1,
    light: { shaker: ['o.x.o.x.o.x.o.x.'], stick: ['X..X..X...X.X...'] },
    full: {
      conga: ['..x..X.x..x..X.o', '..x..X.x..x.xX.o'],
      stick: ['X..X..X...X.X...'],
      shaker: ['xoxoXoxoxoxoXoxo'],
      frameDrum: ['X.......X.......'],
    },
    fill: { conga: 'x.x.X.x.XxXxXXXX', stick: 'X..X..X...X.X...' },
  },
  {
    id: 'light_shaker',
    name: 'Light Shaker',
    description: 'Just a soft shaker and maraca: movement without weight.',
    suits: 'Chill, romantic and acoustic songs',
    swing: 0,
    light: { shaker: ['..o...o...o...o.'] },
    full: { shaker: ['o.x.o.x.o.x.o.x.'], maraca: ['....x.......x...'] },
    fill: { shaker: 'o.x.o.x.oxoxoxXx' },
  },
];

export const RHYTHM_STYLE_IDS = RHYTHM_STYLES.map((s) => s.id) as [RhythmStyleId, ...RhythmStyleId[]];

export const getRhythmStyle = (id: RhythmStyleId): RhythmStyle =>
  RHYTHM_STYLES.find((s) => s.id === id) ?? RHYTHM_STYLES[0];

/** Where the fallback rules start for each mood (the AI DJ decides per song when it is available). */
export const STYLE_FOR_MOOD: Record<MoodId, RhythmStyleId> = {
  normal: 'clap_tambourine',
  party: 'dhol_dhamaal',
  bhangra: 'dhol_chaal',
  chill: 'light_shaker',
  romantic: 'light_shaker',
};

const VELOCITY: Record<string, number> = { X: 1, x: 0.72, o: 0.42 };

/** Velocity (0 = no hit) of `voice` at `step` (0–15) of a bar, cycling multi-bar patterns. */
export function hitVelocity(bars: string[] | string | undefined, barIndex: number, step: number): number {
  if (!bars) return 0;
  const bar = typeof bars === 'string' ? bars : bars[((barIndex % bars.length) + bars.length) % bars.length];
  return VELOCITY[bar[step]] ?? 0;
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
