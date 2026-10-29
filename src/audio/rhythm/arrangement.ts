/**
 * Decides, bar by bar, how much the rhythm layer should play on a song: drums out in the
 * intro and breakdowns, a light groove in verses, the full groove on choruses and drops,
 * and a fill on the bar that leads into a bigger section.
 *
 * Works from the song's loudness envelope (MixPointPlanner's EnergyProfile) in 4-bar
 * phrases, so the layer only changes where a drummer would: on phrase boundaries.
 */
import type { EnergyProfile } from '../MixPointPlanner';

export type RhythmSection = 'off' | 'light' | 'full';

export interface ArrangementInput {
  profile: EnergyProfile;
  barSeconds: number; // length of one rhythm bar in song seconds
  downbeat: number; // a bar start, in song seconds
  duration: number;
  musicStartTime?: number; // where the music begins (after a spoken intro)
  hookTime?: number; // the song's best-known part
}

export interface Arrangement {
  barSeconds: number;
  downbeat: number;
  sections: RhythmSection[]; // per bar, from bar 0 at the downbeat
  fills: boolean[]; // per bar
  reasons: string[]; // per bar, for the status line
}

const PHRASE_BARS = 4;
// Phrase loudness relative to the song's loud parts (90th percentile of its phrases, i.e. the
// choruses). Not the average: quiet intros and outros drag that down until verses look like
// choruses. Modern masters are compressed, so a verse is often only 2–4 dB below the chorus:
// FULL is within ~1 dB of it, and under half of it the song has dropped out (intro, breakdown).
const OFF_BELOW = 0.5;
const FULL_FROM = 0.88;
const HOOK_FULL_FROM = 0.7;

function mean(values: Float32Array, rate: number, from: number, to: number): number {
  const a = Math.max(0, Math.floor(from * rate));
  const b = Math.min(values.length, Math.ceil(to * rate));
  if (b <= a) return 0;
  let sum = 0;
  for (let i = a; i < b; i++) sum += values[i];
  return sum / (b - a);
}

export function planArrangement(input: ArrangementInput): Arrangement {
  const { profile, barSeconds, downbeat, duration } = input;
  const barCount = Math.max(0, Math.floor((duration - downbeat) / barSeconds));
  const phraseCount = Math.ceil(barCount / PHRASE_BARS);
  const phraseSeconds = barSeconds * PHRASE_BARS;
  const musicStart = input.musicStartTime ?? 0;

  // 1. Each phrase's level from its loudness, relative to the song's loud parts
  const raw: number[] = [];
  for (let p = 0; p < phraseCount; p++) {
    const start = downbeat + p * phraseSeconds;
    raw.push(mean(profile.full, profile.rate, start, start + phraseSeconds));
  }
  const sorted = [...raw].sort((a, b) => a - b);
  const loud = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] || 1;
  const phraseEnergy = raw.map((e) => e / loud);
  const level: RhythmSection[] = phraseEnergy.map((e) => (e < OFF_BELOW ? 'off' : e < FULL_FROM ? 'light' : 'full'));

  // 2. Smooth out single-phrase flips (a loud bar in a verse isn't a chorus)
  const smoothed = level.map((l, p) => {
    const prev = level[p - 1];
    const next = level[p + 1];
    return prev !== undefined && prev === next && prev !== l ? prev : l;
  });

  // 3. Hard rules on top of the loudness
  const rank: Record<RhythmSection, number> = { off: 0, light: 1, full: 2 };
  const why: string[] = smoothed.map((l) =>
    l === 'full' ? 'chorus energy: full groove' : l === 'light' ? 'verse: light groove' : 'quiet part: drums out'
  );
  for (let p = 0; p < phraseCount; p++) {
    const start = downbeat + p * phraseSeconds;
    const end = start + phraseSeconds;
    if (end <= musicStart + 0.5) {
      smoothed[p] = 'off';
      why[p] = 'intro before the music: drums out';
    } else if (input.hookTime !== undefined && input.hookTime >= start - phraseSeconds && input.hookTime < end && phraseEnergy[p] >= HOOK_FULL_FROM) {
      smoothed[p] = 'full';
      why[p] = 'the hook: full groove';
    } else if (end > duration - phraseSeconds && smoothed[p] === 'full') {
      smoothed[p] = 'light'; // leave the ending to the mix
      why[p] = 'song ending: light groove';
    }
  }

  // 4. Per bar, with a fill leading into a bigger section and at the end of every 8 bars of full
  const sections: RhythmSection[] = [];
  const fills: boolean[] = [];
  const reasons: string[] = [];
  for (let b = 0; b < barCount; b++) {
    const p = Math.floor(b / PHRASE_BARS);
    const lastBarOfPhrase = b % PHRASE_BARS === PHRASE_BARS - 1;
    const next = smoothed[p + 1];
    const risesNext = next !== undefined && rank[next] > rank[smoothed[p]];
    const phraseEnd = smoothed[p] === 'full' && b % (PHRASE_BARS * 2) === PHRASE_BARS * 2 - 1 && next !== 'off';
    const fill = lastBarOfPhrase && (risesNext || phraseEnd) && next !== 'off';
    sections.push(smoothed[p]);
    fills.push(fill);
    reasons.push(fill && risesNext ? `fill into the ${next === 'full' ? 'chorus' : 'groove'}` : why[p]);
  }
  return { barSeconds, downbeat, sections, fills, reasons };
}

/** A steady layer: the full groove everywhere the music plays, with a fill every 8 bars. */
export function steadyArrangement(input: ArrangementInput): Arrangement {
  const { barSeconds, downbeat, duration } = input;
  const barCount = Math.max(0, Math.floor((duration - downbeat) / barSeconds));
  const musicStart = input.musicStartTime ?? 0;
  const sections: RhythmSection[] = [];
  const fills: boolean[] = [];
  const reasons: string[] = [];
  for (let b = 0; b < barCount; b++) {
    const beforeMusic = downbeat + (b + 1) * barSeconds <= musicStart + 0.5;
    sections.push(beforeMusic ? 'off' : 'full');
    fills.push(!beforeMusic && b % 8 === 7);
    reasons.push(beforeMusic ? 'intro before the music: drums out' : 'steady groove');
  }
  return { barSeconds, downbeat, sections, fills, reasons };
}
