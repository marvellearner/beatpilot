/**
 * Beat presence over time, shared by IntroSkitDetector (where the music starts) and
 * OutroDetector (where it ends): for each second, how strongly low-end attacks (kick, dhol,
 * bass) repeat at a steady beat period, plus the bass level and the voice-band envelope used
 * to tell talking from music.
 */

export const FRAME_RATE = 100; // 10 ms frames
export const WINDOW_SECONDS = 6; // beat-strength window
export const MIN_LAG = 30; // 0.3 s = 200 BPM
export const MAX_LAG = 100; // 1.0 s = 60 BPM

export interface BeatPresence {
  low: Float32Array; // 10 ms envelopes: low band (≤150 Hz)
  mid: Float32Array; // 300 Hz–3 kHz (voice)
  full: Float32Array; // full band
  onset: Float32Array; // low-end onset strength (rise in log energy), the "beat" signal
  beatStrength: Float32Array; // per second: pulse strength over the WINDOW_SECONDS starting there
  lowLevel: Float32Array; // per second: average bass level over that window
  seconds: number; // how many seconds have a beat strength
  peakFull: number;
}

/**
 * Measures `lengthSeconds` of audio from `fromSeconds`. Beat strength is computed for every
 * second that has a full window after it, so the last ~7 s of the stretch have none.
 */
export function measureBeatPresence(data: Float32Array, sampleRate: number, fromSeconds: number, lengthSeconds: number): BeatPresence {
  const hop = Math.floor(sampleRate / FRAME_RATE);
  const offset = Math.floor(fromSeconds * sampleRate);
  const frames = Math.max(0, Math.min(Math.floor((lengthSeconds * sampleRate) / hop), Math.floor((data.length - offset) / hop)));
  const low = new Float32Array(frames);
  const mid = new Float32Array(frames);
  const full = new Float32Array(frames);
  const lpLow = 1 - Math.exp((-2 * Math.PI * 150) / sampleRate);
  const hpMid = Math.exp((-2 * Math.PI * 300) / sampleRate);
  const lpMid = 1 - Math.exp((-2 * Math.PI * 3000) / sampleRate);
  let lowState = 0;
  let hpPrevIn = 0;
  let hpOut = 0;
  let midState = 0;
  for (let f = 0; f < frames; f++) {
    let sLow = 0;
    let sMid = 0;
    let sFull = 0;
    const base = offset + f * hop;
    for (let i = 0; i < hop; i++) {
      const x = data[base + i];
      lowState += lpLow * (x - lowState);
      hpOut = hpMid * (hpOut + x - hpPrevIn);
      hpPrevIn = x;
      midState += lpMid * (hpOut - midState);
      sLow += lowState * lowState;
      sMid += midState * midState;
      sFull += x * x;
    }
    low[f] = Math.sqrt(sLow / hop);
    mid[f] = Math.sqrt(sMid / hop);
    full[f] = Math.sqrt(sFull / hop);
  }
  const peakFull = full.reduce((m, v) => Math.max(m, v), 0);

  const peakLow = low.reduce((m, v) => Math.max(m, v), 1e-9);
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    const d = Math.log1p((100 * low[f]) / peakLow) - Math.log1p((100 * low[f - 1]) / peakLow);
    onset[f] = d > 0 ? d : 0;
  }

  // Pulse strength = best normalised autocorrelation over every plausible beat period
  // (0.3–1.0 s = 60–200 BPM), so it doesn't depend on the BPM reading being right.
  const win = WINDOW_SECONDS * FRAME_RATE;
  const seconds = Math.max(0, Math.floor((frames - win - MAX_LAG - 2) / FRAME_RATE));
  const beatStrength = new Float32Array(seconds);
  const lowLevel = new Float32Array(seconds);
  const centered = new Float32Array(win + MAX_LAG + 2);
  for (let s = 0; s < seconds; s++) {
    const start = s * FRAME_RATE;
    let mean = 0;
    for (let f = start; f < start + win; f++) mean += onset[f];
    mean /= win;
    for (let i = 0; i < centered.length; i++) centered[i] = onset[start + i] - mean;
    let energy = 0;
    for (let i = 0; i < win; i++) energy += centered[i] * centered[i];
    let best = 0;
    if (energy > 0) {
      for (let lag = MIN_LAG; lag <= MAX_LAG; lag++) {
        let sum = 0;
        for (let i = 0; i < win; i++) {
          // ±1 frame tolerance: real beats wobble a little
          const c = centered[i + lag];
          const n = centered[i + lag + 1];
          const p = centered[i + lag - 1];
          sum += centered[i] * (c > n ? (c > p ? c : p) : n > p ? n : p);
        }
        if (sum / energy > best) best = sum / energy;
      }
    }
    beatStrength[s] = best;
    let lowSum = 0;
    for (let f = start; f < start + win; f++) lowSum += low[f];
    lowLevel[s] = lowSum / win;
  }
  return { low, mid, full, onset, beatStrength, lowLevel, seconds, peakFull };
}

/** Upper-quantile value of a series ("normal for this song"). */
export function quantile(arr: Float32Array, q: number): number {
  const sorted = Array.from(arr).sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/** One second of audio (index into the measured stretch): 1 = talking-like (choppy voice band with pauses), 0 = not, -1 = silent. */
export function speechAt(p: BeatPresence, s: number): number {
  const a = s * FRAME_RATE;
  if (a + FRAME_RATE > p.mid.length) return -1;
  let sum = 0;
  let max = 0;
  for (let f = a; f < a + FRAME_RATE; f++) {
    sum += p.mid[f];
    if (p.mid[f] > max) max = p.mid[f];
  }
  const meanMid = sum / FRAME_RATE;
  if (max < 0.02 * p.peakFull) return -1;
  let variance = 0;
  let pauses = 0;
  for (let f = a; f < a + FRAME_RATE; f++) {
    variance += (p.mid[f] - meanMid) ** 2;
    if (p.mid[f] < 0.15 * max) pauses++;
  }
  const choppiness = Math.sqrt(variance / FRAME_RATE) / (meanMid || 1);
  return choppiness > 0.5 && pauses >= 8 ? 1 : 0;
}
