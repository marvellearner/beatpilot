import type { ExitFx } from '../../types';

/** Moves that end in a hard landing: strong, so never two close together. */
const HARD: ExitFx[] = ['roll', 'brake'];

/**
 * The DJ move for two songs that can't be beatmatched (a plain fade is what a beginner does).
 * Calm moods and quiet parts get the soft moves; a dance floor gets all four. The move used
 * longest ago comes next, so the set doesn't repeat itself.
 * @param recent the latest moves, newest first
 */
export function pickSignatureFx(situation: { mood: string; inLowPart: boolean; recent: ExitFx[] }): ExitFx {
  const { mood, inLowPart, recent } = situation;
  const soft = inLowPart || mood === 'chill' || mood === 'romantic';
  const pool: ExitFx[] = soft ? ['reverb', 'echo'] : ['echo', 'roll', 'reverb', 'brake'];
  const hardJustUsed = recent.slice(0, 2).some((fx) => HARD.includes(fx));
  const allowed = pool.filter((fx) => fx !== recent[0] && !(hardJustUsed && HARD.includes(fx)));
  const age = (fx: ExitFx) => (recent.includes(fx) ? recent.indexOf(fx) : Infinity);
  return [...(allowed.length ? allowed : pool)].sort((a, b) => age(b) - age(a))[0];
}
