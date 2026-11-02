// Beat alignment of two songs playing together, from each deck's own loudness envelope: each
// song's beat phase is found on its own (onsets folded over the beat period, the peak of that
// histogram is where its beats land), and the difference of the two phases is how far apart
// their beats are. Comparing the two songs' onset patterns directly was too noisy: different
// songs put hats and snares in different places, so a plain fade measured as "off" as a blend.

/** Rises in log loudness (where notes and drums start), one value per envelope frame. */
function onsets(env) {
  let peak = 1e-9;
  for (const v of env) peak = Math.max(peak, v);
  const out = new Float64Array(env.length);
  for (let f = 1; f < env.length; f++) out[f] = Math.max(0, Math.log1p((100 * env[f]) / peak) - Math.log1p((100 * env[f - 1]) / peak));
  return out;
}

/**
 * Where in the beat a song's onsets land (seconds after a beat-grid line at t = 0) and how clearly
 * (the histogram peak over its mean: 1 = no beat at all, 2+ = a clear beat).
 */
export function beatPhase(env, hopSec, beatSec, bins = 100) {
  const o = onsets(env);
  const hist = new Float64Array(bins);
  for (let f = 1; f < o.length; f++) {
    if (o[f] <= 0) continue;
    const t = (f - 0.5) * hopSec; // the rise happened between frames f-1 and f
    hist[Math.floor(((t % beatSec) / beatSec) * bins) % bins] += o[f];
  }
  const at = (i) => hist[(i + bins) % bins];
  const smooth = (i) => at(i - 1) + 2 * at(i) + at(i + 1);
  let peak = 0;
  for (let i = 1; i < bins; i++) if (smooth(i) > smooth(peak)) peak = i;
  const a = smooth(peak - 1);
  const b = smooth(peak);
  const c = smooth(peak + 1);
  const d = a - 2 * b + c;
  const frac = d < 0 ? (0.5 * (a - c)) / d : 0;
  const mean = hist.reduce((s, x) => s + x, 0) / bins || 1e-9;
  return { phase: (((peak + 0.5 + frac) / bins) * beatSec + beatSec) % beatSec, clarity: b / 4 / mean };
}

/**
 * How far deck B's beats are from deck A's (ms, within half a beat; + = B late) over the same
 * stretch, and how clearly both have a beat there (the weaker of the two clarities).
 */
export function beatOffset(envA, envB, hopSec, beatSec) {
  const pa = beatPhase(envA, hopSec, beatSec);
  const pb = beatPhase(envB, hopSec, beatSec);
  let d = pb.phase - pa.phase;
  if (d > beatSec / 2) d -= beatSec;
  if (d <= -beatSec / 2) d += beatSec;
  return { offsetMs: Math.round(d * 1000), clarity: Math.round(Math.min(pa.clarity, pb.clarity) * 100) / 100 };
}
