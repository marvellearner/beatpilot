import type { ExitFx } from '../../types';

/** Tempos further apart than this make a bare cut sound like a mistake. */
const GAP_CUT_MAX_TEMPO_RATIO = 1.08;

/**
 * Whether a bare cut into the old song's pause can work: the new song must land close in tempo,
 * not clashing in key, and at the start of a 4-bar phrase. Otherwise the pause gets a thrown echo
 * or reverb instead.
 * @param entryBar the new song's entry, in bars from its downbeat
 */
export function gapCutFits(pair: { outBpm: number; incBpm: number; keyClash: boolean; entryBar: number }): boolean {
  const ratio = Math.max(pair.outBpm, pair.incBpm) / Math.min(pair.outBpm, pair.incBpm);
  const bar = Math.round(pair.entryBar);
  return ratio <= GAP_CUT_MAX_TEMPO_RATIO && !pair.keyClash && Math.abs(pair.entryBar - bar) < 0.05 && bar % 4 === 0;
}

/** Moves that end in a hard landing: strong, so never two close together. */
const HARD: ExitFx[] = ['roll', 'brake'];

const isCalm = (mood: string) => mood === 'chill' || mood === 'romantic';

/**
 * From a pool in order of preference: the move used longest ago, never the last one again, and
 * no hard landing right after another.
 */
function leastRecent(pool: ExitFx[], recent: ExitFx[]): ExitFx {
  const hardJustUsed = recent.slice(0, 2).some((fx) => HARD.includes(fx));
  const allowed = pool.filter((fx) => fx !== recent[0] && !(hardJustUsed && HARD.includes(fx)));
  const age = (fx: ExitFx) => (recent.includes(fx) ? recent.indexOf(fx) : Infinity);
  return [...(allowed.length ? allowed : pool)].sort((a, b) => age(b) - age(a))[0];
}

/**
 * The DJ move for two songs that can't be beatmatched (a plain fade is what a beginner does).
 * Calm moods and quiet parts get the soft moves (reverb, echo, filter sweep); a dance floor gets
 * all five. The filter sweep takes the old song's kick and bass away first, so the two beats
 * barely clash while they overlap. The move used longest ago comes next, so the set doesn't
 * repeat itself.
 * @param recent the latest moves, newest first
 */
export function pickSignatureFx(situation: { mood: string; inLowPart: boolean; recent: ExitFx[] }): ExitFx {
  const { mood, inLowPart, recent } = situation;
  const soft = inLowPart || isCalm(mood);
  return leastRecent(soft ? ['reverb', 'echo', 'filter'] : ['echo', 'filter', 'roll', 'reverb', 'brake'], recent);
}

/**
 * The move for two beatmatched songs: mostly a filter sweep blend (the old song thins out
 * through a rising high-pass while the bass swaps on the beat), with a loop roll or an echo
 * out now and then on a dance floor. Calm moods get the sweep or the echo.
 * @param recent the latest moves, newest first
 */
export function pickBlendFx(situation: { mood: string; recent: ExitFx[] }): ExitFx {
  const { mood, recent } = situation;
  return leastRecent(isCalm(mood) ? ['filter', 'echo'] : ['filter', 'roll', 'echo'], recent);
}
