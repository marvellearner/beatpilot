/**
 * Real-time vocal isolation by signal processing (no AI model), for the "Music" fader. Works
 * frequency by frequency, 172 times a second, and keeps only what behaves like a lead voice:
 *
 *   - in the centre of the stereo image (the two channels agree): drops anything panned
 *   - not a hit (dhol, tabla, snare: energy spread across many frequencies in one instant)
 *   - not held steady (harmonium, strings, pads: the same pitch for a long time). A voice glides
 *     and wavers, so its energy keeps moving between frequencies
 *   - inside the voice range: drops the bass, kick and cymbals
 *
 * Written as one self-contained function: VocalFocus sends its source text to the audio thread
 * (a worklet can't import), and the tests run the very same code on known stems.
 */

/** Delay of the isolated output, in samples: the dry song is delayed by this to stay aligned. */
export const VOCAL_ISOLATOR_LATENCY = 1023;

export function createVocalIsolator(sampleRate: number, onFrame?: (mask: Float32Array) => void) {
  const N = 1024;
  const HOP = 256;
  const BINS = N / 2 + 1;
  const hzPerBin = sampleRate / N;
  const LOW_BIN = Math.max(1, Math.floor(150 / hzPerBin));
  const HIGH_BIN = Math.min(BINS - 1, Math.ceil(7000 / hzPerBin));
  const hopsPerSecond = sampleRate / HOP;

  const CENTRE_POWER = 3; // the centre test, cubed twice over (c^6): only a tight centre passes
  const HIT_WEIGHT = 2.2; // how hard hits are pushed down
  const STEADY_WEIGHT = 1.2; // how hard held notes are pushed down
  const STEADY_FLOOR = 0.1; // a held note never disappears altogether (a singer holds notes too)
  const MASK_FLOOR = 0.02; // keeps a trace, so the mask doesn't sound watery
  const RELEASE = 0.25; // per hop: opens at once, closes over ~20 ms
  const OUTPUT_GAIN = 2.7; // makes up what the mask takes from the voice (with VocalFocus's level: about unity)

  // Recent spectra: a short history (every 2nd hop, 120 ms) and a long one (every 4th, 600 ms)
  const SHORT_LEN = Math.max(3, Math.round((0.12 * hopsPerSecond) / 2));
  const LONG_LEN = Math.max(5, Math.round((0.6 * hopsPerSecond) / 4));
  const NEAR_BINS = Math.max(2, Math.round(300 / hzPerBin));
  const short = new Float32Array(BINS * SHORT_LEN);
  const long = new Float32Array(BINS * LONG_LEN);
  let shortAt = 0;
  let longAt = 0;
  let hops = 0;
  let longFilled = 0;
  let shortFilled = 0;

  const win = new Float32Array(N);
  const hann = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    win[i] = Math.sqrt(hann[i]);
  }
  const bandGain = new Float32Array(BINS);
  for (let k = 1; k < BINS; k++) {
    const hz = k * hzPerBin;
    bandGain[k] = (1 / Math.sqrt(1 + (180 / hz) ** 8)) * (1 / Math.sqrt(1 + (hz / 5500) ** 8));
  }

  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const mag = new Float32Array(BINS);
  const peak = new Float32Array(BINS);
  const centre = new Float32Array(BINS);
  const mask = new Float32Array(BINS);
  const midRe = new Float32Array(BINS);
  const midIm = new Float32Array(BINS);
  const scratch = new Float32Array(Math.max(SHORT_LEN, LONG_LEN, 2 * NEAR_BINS + 1));

  const inL = new Float32Array(N);
  const inR = new Float32Array(N);
  let filled = 0;
  const overlap = new Float32Array(N);
  const fifo = new Float32Array(N * 2);
  let fifoRead = 0;
  let fifoWrite = 0;
  let fifoCount = 0;

  function fft() {
    for (let i = 1, j = 0; i < N; i++) {
      let bit = N >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let len = 2; len <= N; len <<= 1) {
      const step = (-2 * Math.PI) / len;
      const wr = Math.cos(step);
      const wi = Math.sin(step);
      for (let i = 0; i < N; i += len) {
        let cr = 1;
        let ci = 0;
        for (let j = 0; j < len / 2; j++) {
          const a = i + j;
          const b = a + len / 2;
          const xr = re[b] * cr - im[b] * ci;
          const xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
          const t = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = t;
        }
      }
    }
  }

  /** Median of the first n values of scratch (insertion sort: the lists are short). */
  function median(n: number) {
    for (let i = 1; i < n; i++) {
      const v = scratch[i];
      let j = i - 1;
      while (j >= 0 && scratch[j] > v) {
        scratch[j + 1] = scratch[j];
        j--;
      }
      scratch[j + 1] = v;
    }
    return scratch[n >> 1];
  }

  function processFrame() {
    for (let i = 0; i < N; i++) {
      re[i] = inL[i] * win[i];
      im[i] = inR[i] * win[i];
    }
    fft();
    // The FFT of (L + iR): pull the two channels' spectra apart, then the mid and the centre test
    let prevCross = 0;
    let prevPower = 0;
    let cross = 0;
    let power = 0;
    for (let k = 0; k < BINS; k++) {
      const m = (N - k) % N;
      const lr = (re[k] + re[m]) / 2;
      const li = (im[k] - im[m]) / 2;
      const rr = (im[k] + im[m]) / 2;
      const ri = (re[m] - re[k]) / 2;
      midRe[k] = (lr + rr) / 2;
      midIm[k] = (li + ri) / 2;
      mag[k] = Math.sqrt(midRe[k] * midRe[k] + midIm[k] * midIm[k]);
      const c = lr * rr + li * ri;
      const p = lr * lr + li * li + rr * rr + ri * ri;
      if (k > 0) centre[k - 1] = Math.max(0, (2 * (prevCross + cross + c)) / (prevPower + power + p + 1e-12));
      prevCross = cross;
      prevPower = power;
      cross = c;
      power = p;
    }
    centre[BINS - 1] = 0;

    for (let k = 0; k < BINS; k++) peak[k] = Math.max(mag[k], mag[k - 1] || 0, mag[k + 1] || 0);
    if (hops % 2 === 0) {
      short.set(peak, shortAt * BINS);
      shortAt = (shortAt + 1) % SHORT_LEN;
      shortFilled = Math.min(SHORT_LEN, shortFilled + 1);
    }
    if (hops % 4 === 0) {
      long.set(mag, longAt * BINS);
      longAt = (longAt + 1) % LONG_LEN;
      longFilled = Math.min(LONG_LEN, longFilled + 1);
    }
    hops++;

    mask.fill(0, 0, LOW_BIN);
    for (let k = LOW_BIN; k < HIGH_BIN; k++) {
      const c2 = centre[k] * centre[k];
      let gain = 1;
      for (let i = 0; i < CENTRE_POWER; i++) gain *= c2;

      // A hit: this frequency is about as loud as its neighbours right now, but wasn't just before
      for (let i = 0; i < shortFilled; i++) scratch[i] = short[i * BINS + k];
      const sustained = shortFilled ? median(shortFilled) : mag[k];
      let n = 0;
      for (let j = Math.max(LOW_BIN, k - NEAR_BINS); j <= Math.min(HIGH_BIN - 1, k + NEAR_BINS); j++) scratch[n++] = mag[j];
      const spread = median(n) * HIT_WEIGHT;
      gain *= (sustained * sustained) / (sustained * sustained + spread * spread + 1e-12);

      // Held steady: its level now is what it has been for the last 600 ms
      if (longFilled > LONG_LEN / 2) {
        for (let i = 0; i < longFilled; i++) scratch[i] = long[i * BINS + k];
        const steady = median(longFilled) * STEADY_WEIGHT;
        gain *= Math.max(STEADY_FLOOR, 1 - (steady * steady) / (mag[k] * mag[k] + 1e-12));
      }

      gain = Math.max(MASK_FLOOR, gain) * bandGain[k];
      mask[k] = gain > mask[k] ? gain : mask[k] + (gain - mask[k]) * RELEASE;
    }
    mask.fill(0, HIGH_BIN);
    if (onFrame) onFrame(mask);

    // Back to the time domain (mono: a lead vocal sits in the middle)
    for (let k = 0; k < BINS; k++) {
      const xr = midRe[k] * mask[k];
      const xi = midIm[k] * mask[k];
      re[k] = xr;
      im[k] = -xi;
      if (k > 0 && k < N / 2) {
        re[N - k] = xr;
        im[N - k] = xi;
      }
    }
    fft();
    // sqrt-Hann in and out at a quarter-window hop adds up to 2
    for (let i = 0; i < N; i++) overlap[i] += (re[i] / N) * win[i] * 0.5 * OUTPUT_GAIN;
    for (let i = 0; i < HOP; i++) {
      fifo[fifoWrite] = overlap[i];
      fifoWrite = (fifoWrite + 1) % fifo.length;
    }
    fifoCount += HOP;
    overlap.copyWithin(0, HOP);
    overlap.fill(0, N - HOP);
  }

  return {
    /** Feeds one block of stereo samples and writes the isolated voice to `out`. */
    process(left: Float32Array, right: Float32Array, out: Float32Array) {
      for (let i = 0; i < out.length; i++) {
        inL[filled] = left[i];
        inR[filled] = right[i];
        filled++;
        if (filled === N) {
          processFrame();
          inL.copyWithin(0, HOP);
          inR.copyWithin(0, HOP);
          filled = N - HOP;
        }
        if (fifoCount > 0) {
          out[i] = fifo[fifoRead];
          fifoRead = (fifoRead + 1) % fifo.length;
          fifoCount--;
        } else {
          out[i] = 0;
        }
      }
    },
  };
}
