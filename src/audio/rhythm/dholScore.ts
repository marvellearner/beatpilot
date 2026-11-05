/**
 * The dhol wala's score for a song: bar by bar, what to play. A wedding dhol player doesn't drum
 * over everything: they keep time softly while someone sings, answer in the gaps between vocal
 * lines, come in hard on the chorus, roll into it, land it with an accent, and close a section
 * with a tihai. This plans that from the song's loudness (MixPointPlanner's EnergyProfile) and
 * its vocal map (rhythmPlan.ts), in 4-bar phrases, so it changes where a musician would.
 */
import type { EnergyProfile } from '../MixPointPlanner';
import type { VocalMap } from './rhythmPlan';

export type BarRole = 'out' | 'light' | 'groove';

export interface ScoreBar {
  role: BarRole;
  answer: boolean; // a phrase on beats 3–4, in a gap between vocal lines (light bars)
  roll: boolean; // roll through beats 3–4 into the next bar (a section rises next)
  tihai: boolean; // the bar is a tihai landing on the next downbeat (a groove section ends)
  accent: boolean; // a big stroke on the 1 (a groove section starts, or a roll / tihai lands here)
  variation: number; // which groove bar of the taal to play (cycles its variations)
  reason: string; // for the status line
}

export interface ScoreInput {
  profile: EnergyProfile;
  vocal?: VocalMap;
  vocalScale?: number; // song seconds -> vocal-map seconds (the song may be re-timed for a set tempo)
  barSeconds: number; // one rhythm bar, song seconds
  downbeat: number; // a bar start, song seconds
  duration: number;
  musicStartTime?: number; // where the music begins (after a spoken intro)
  hookTime?: number; // the song's best-known part
}

const PHRASE_BARS = 4;
// Phrase loudness relative to the song's loud parts (90th percentile of its phrases, i.e. the
// choruses): modern masters are compressed, so a verse is often only 2–4 dB below the chorus
const OFF_BELOW = 0.5;
const GROOVE_FROM = 0.88;
const HOOK_GROOVE_FROM = 0.7;
// Vocal map levels (1 = the song's normal singing level)
const SINGING = 0.55; // a phrase with this much voice on average has someone singing
const INSTRUMENTAL_BELOW = 0.3; // a phrase below this is instrumental
const GAP_BELOW = 0.35; // a half-bar below this, after singing, is a gap between lines
const INSTRUMENTAL_GROOVE_FROM = 0.7; // an instrumental part at least this loud gets the groove

function mean(values: Float32Array, rate: number, from: number, to: number): number {
  const a = Math.max(0, Math.floor(from * rate));
  const b = Math.min(values.length, Math.ceil(to * rate));
  if (b <= a) return 0;
  let sum = 0;
  for (let i = a; i < b; i++) sum += values[i];
  return sum / (b - a);
}

export function planDholScore(input: ScoreInput): ScoreBar[] {
  const { profile, barSeconds, downbeat, duration } = input;
  const barCount = Math.max(0, Math.floor((duration - downbeat) / barSeconds));
  const phraseCount = Math.ceil(barCount / PHRASE_BARS);
  const phraseSeconds = barSeconds * PHRASE_BARS;
  const musicStart = input.musicStartTime ?? 0;
  const scale = input.vocalScale ?? 1;
  const voice = (from: number, to: number) => (input.vocal ? mean(input.vocal.values, input.vocal.rate, from * scale, to * scale) : NaN);

  // 1. Each phrase: loudness relative to the song's loud parts, and how much singing it has
  const raw: number[] = [];
  const singing: number[] = [];
  for (let p = 0; p < phraseCount; p++) {
    const start = downbeat + p * phraseSeconds;
    raw.push(mean(profile.full, profile.rate, start, start + phraseSeconds));
    singing.push(voice(start, start + phraseSeconds));
  }
  const sorted = [...raw].sort((a, b) => a - b);
  const loud = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] || 1;
  const energy = raw.map((e) => e / loud);
  let role: BarRole[] = energy.map((e) => (e < OFF_BELOW ? 'out' : e < GROOVE_FROM ? 'light' : 'groove'));

  // 2. Smooth single-phrase flips (a loud bar in a verse isn't a chorus)
  role = role.map((r, p) => (role[p - 1] !== undefined && role[p - 1] === role[p + 1] && role[p - 1] !== r ? role[p - 1] : r));

  const why: string[] = role.map((r) => (r === 'groove' ? 'chorus: full taal' : r === 'light' ? 'singing: keeping time softly' : 'quiet part: dhol out'));
  for (let p = 0; p < phraseCount; p++) {
    const start = downbeat + p * phraseSeconds;
    const end = start + phraseSeconds;
    if (end <= musicStart + 0.5) {
      role[p] = 'out';
      why[p] = 'intro before the music: dhol out';
    } else if (input.hookTime !== undefined && input.hookTime >= start - phraseSeconds && input.hookTime < end && energy[p] >= HOOK_GROOVE_FROM) {
      role[p] = 'groove';
      why[p] = 'the hook: full taal';
    } else if (role[p] === 'light' && singing[p] < INSTRUMENTAL_BELOW && energy[p] >= INSTRUMENTAL_GROOVE_FROM) {
      // Nobody singing but the music is going: the dhol wala's moment
      role[p] = 'groove';
      why[p] = 'instrumental: full taal';
    } else if (end > duration - phraseSeconds && role[p] === 'groove') {
      role[p] = 'light'; // leave the ending to the mix
      why[p] = 'song ending: keeping time';
    }
  }

  // 3. Per bar: rolls into rises, accents where a groove starts, tihais where it ends, answers in gaps
  const rank: Record<BarRole, number> = { out: 0, light: 1, groove: 2 };
  const bars: ScoreBar[] = [];
  let lastAnswer = -99;
  let grooveBar = 0;
  for (let b = 0; b < barCount; b++) {
    const p = Math.floor(b / PHRASE_BARS);
    const r = role[p];
    const lastBarOfPhrase = b % PHRASE_BARS === PHRASE_BARS - 1;
    const next = role[p + 1];
    const prev = role[p - 1];
    const roll = lastBarOfPhrase && next !== undefined && rank[next] > rank[r];
    const tihai = lastBarOfPhrase && r === 'groove' && next !== undefined && rank[next] < rank[r] && next !== 'out';
    const accent = b % PHRASE_BARS === 0 && r === 'groove' && prev !== 'groove';
    grooveBar = r === 'groove' ? (accent ? 0 : grooveBar + 1) : 0;

    // Answer a vocal line: the first half of the bar sings, the second half is a clear gap
    let answer = false;
    if (r === 'light' && !roll && b - lastAnswer >= 2 && input.vocal) {
      const start = downbeat + b * barSeconds;
      const firstHalf = voice(start, start + barSeconds / 2);
      const secondHalf = voice(start + barSeconds / 2, start + barSeconds);
      answer = firstHalf >= SINGING && secondHalf < GAP_BELOW;
      if (answer) lastAnswer = b;
    }

    bars.push({
      role: r,
      answer,
      roll,
      tihai,
      accent,
      variation: grooveBar,
      reason: roll ? `roll into the ${next === 'groove' ? 'chorus' : 'groove'}` : tihai ? 'tihai: closing the chorus' : answer ? 'answering the singer' : accent ? `${why[p]} (accent)` : why[p],
    });
  }
  // A roll or tihai lands on the next bar's 1
  for (let b = 1; b < bars.length; b++) {
    if ((bars[b - 1].roll || bars[b - 1].tihai) && bars[b].role !== 'out') bars[b].accent = true;
  }
  return bars;
}

/** Steady (manual "Steady all song"): the full taal wherever the music plays, a roll every 8 bars. */
export function steadyDholScore(input: ScoreInput): ScoreBar[] {
  const { barSeconds, downbeat, duration } = input;
  const barCount = Math.max(0, Math.floor((duration - downbeat) / barSeconds));
  const musicStart = input.musicStartTime ?? 0;
  const bars: ScoreBar[] = [];
  for (let b = 0; b < barCount; b++) {
    const beforeMusic = downbeat + (b + 1) * barSeconds <= musicStart + 0.5;
    bars.push({
      role: beforeMusic ? 'out' : 'groove',
      answer: false,
      roll: !beforeMusic && b % 8 === 7,
      tihai: false,
      accent: !beforeMusic && b % 8 === 0,
      variation: b,
      reason: beforeMusic ? 'intro before the music: dhol out' : 'steady taal',
    });
  }
  return bars;
}
