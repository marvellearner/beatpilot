/**
 * Where a song's beats land, from its loudness envelope (one value per `hopSec` frame starting
 * at time `t0`): onsets (rises in log loudness) folded over the beat period, the histogram's
 * peak is the beat phase. Used live to lock two songs' beats together during a blend
 * (PhaseLock.ts) and by the QA harness to measure it (qa/transitions.mjs). Each song's phase is
 * found on its own: comparing two songs' onset patterns directly is too noisy, since different
 * songs put hats and snares in different places.
 */

/** Rises in log loudness (where notes and drums start), one value per frame. */
function onsets(env: ArrayLike<number>): Float64Array {
  let peak = 1e-9;
  for (let i = 0; i < env.length; i++) peak = Math.max(peak, env[i]);
  const out = new Float64Array(env.length);
  for (let f = 1; f < env.length; f++) out[f] = Math.max(0, Math.log1p((100 * env[f]) / peak) - Math.log1p((100 * env[f - 1]) / peak));
  return out;
}

/**
 * The time within a beat (seconds after a multiple of `beatSec` on the clock `t0` is on) where
 * the onsets land, and how clearly: the histogram peak over its mean (about 1 with no beat,
 * 2 or more for a clear one).
 */
export function beatPhase(env: ArrayLike<number>, t0: number, hopSec: number, beatSec: number, bins = 100): { phase: number; clarity: number } {
  const o = onsets(env);
  const hist = new Float64Array(bins);
  for (let f = 1; f < o.length; f++) {
    if (o[f] <= 0) continue;
    const t = t0 + (f - 0.5) * hopSec; // the rise happened between frames f-1 and f
    hist[Math.floor(((((t % beatSec) + beatSec) % beatSec) / beatSec) * bins) % bins] += o[f];
  }
  const at = (i: number) => hist[(i + bins) % bins];
  const smooth = (i: number) => at(i - 1) + 2 * at(i) + at(i + 1);
  let peak = 0;
  for (let i = 1; i < bins; i++) if (smooth(i) > smooth(peak)) peak = i;
  const a = smooth(peak - 1);
  const b = smooth(peak);
  const c = smooth(peak + 1);
  const d = a - 2 * b + c;
  const frac = d < 0 ? (0.5 * (a - c)) / d : 0;
  const mean = hist.reduce((s, x) => s + x, 0) / bins || 1e-9;
  return { phase: ((((peak + 0.5 + frac) / bins) * beatSec) % beatSec + beatSec) % beatSec, clarity: b / 4 / mean };
}

/**
 * How far song B's beats are from song A's over the same stretch (seconds, within half a beat;
 * positive = B's beats come later), and how clearly both have a beat (the weaker clarity).
 */
export function beatOffset(envA: ArrayLike<number>, envB: ArrayLike<number>, t0: number, hopSec: number, beatSec: number): { offsetSec: number; clarity: number } {
  const pa = beatPhase(envA, t0, hopSec, beatSec);
  const pb = beatPhase(envB, t0, hopSec, beatSec);
  let d = pb.phase - pa.phase;
  if (d > beatSec / 2) d -= beatSec;
  if (d <= -beatSec / 2) d += beatSec;
  return { offsetSec: d, clarity: Math.min(pa.clarity, pb.clarity) };
}
