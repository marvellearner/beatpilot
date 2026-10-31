/**
 * KeyDetector — the song's musical key, for harmonic mixing.
 *
 * 1. Chroma: about 120 spectra (FFT, 4096 points at ~11–12 kHz) spread over the middle 80 %
 *    of the song, each bin from 65 Hz to 2 kHz added to its pitch class (C, C#, … B),
 *    compressed (sqrt) so a loud bass note doesn't outweigh the harmony.
 * 2. Key: the chroma is correlated with the Krumhansl–Kessler major and minor key profiles in
 *    all 12 transpositions; the best of the 24 wins. Confidence is how far it beats the
 *    best key that isn't its relative major/minor (which shares the same notes).
 *
 * Keys are reported in Camelot notation (8A = A minor, 8B = C major): neighbours on the wheel
 * (same number, ±1, or A <-> B) mix without clashing.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
// Key profiles from KeyFinder (Sha'ath 2011), tuned on popular and electronic music, starting at the tonic
const MAJOR = [7.24, 3.5, 3.58, 2.85, 5.82, 4.56, 2.45, 6.99, 3.39, 4.56, 4.07, 4.46];
const MINOR = [7.0, 3.14, 4.36, 5.4, 3.67, 4.09, 3.91, 6.2, 3.63, 5.16, 3.41, 3.49];
// Camelot number for each tonic pitch class (index = pitch class)
const CAMELOT_MAJOR = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
const CAMELOT_MINOR = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];

export interface KeyResult {
  camelot: string; // e.g. "8A"
  name: string; // e.g. "A minor"
  tonic: number; // pitch class 0–11 (C = 0)
  minor: boolean;
  confidence: number; // 0–1
}

const FFT_SIZE = 4096;
const FRAMES = 120;

/** In-place radix-2 FFT (re/im arrays of length FFT_SIZE). */
export function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function correlate(a: number[], b: number[]): number {
  const ma = a.reduce((s, v) => s + v, 0) / 12;
  const mb = b.reduce((s, v) => s + v, 0) / 12;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

export function keyFromTonic(tonic: number, minor: boolean, confidence = 1): KeyResult {
  const t = ((tonic % 12) + 12) % 12;
  return {
    camelot: `${(minor ? CAMELOT_MINOR : CAMELOT_MAJOR)[t]}${minor ? 'A' : 'B'}`,
    name: `${NOTE_NAMES[t]} ${minor ? 'minor' : 'major'}`,
    tonic: t,
    minor,
    confidence,
  };
}

/** Pitch-class profile of the song (12 values, C first). Exposed for testing. */
export function computeChroma(buffer: AudioBuffer): number[] {
  // Mix to mono and decimate to ~11–12 kHz (averaging is enough of a low-pass below 2 kHz)
  const factor = Math.max(1, Math.round(buffer.sampleRate / 11025));
  const rate = buffer.sampleRate / factor;
  const chans = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const len = Math.floor(buffer.length / factor);

  const window = new Float64Array(FFT_SIZE).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  // Pitch class of each FFT bin in the analysed range (-1 = ignored)
  const binClass = new Int8Array(FFT_SIZE / 2).fill(-1);
  for (let k = 1; k < FFT_SIZE / 2; k++) {
    const f = (k * rate) / FFT_SIZE;
    if (f < 65 || f > 2000) continue;
    const midi = 69 + 12 * Math.log2(f / 440);
    binClass[k] = ((Math.round(midi) % 12) + 12) % 12;
  }

  const chroma = new Array(12).fill(0);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const first = Math.floor(len * 0.1);
  const span = Math.max(0, Math.floor(len * 0.8) - FFT_SIZE);
  for (let fr = 0; fr < FRAMES; fr++) {
    const start = first + Math.floor((span * fr) / (FRAMES - 1 || 1));
    for (let i = 0; i < FFT_SIZE; i++) {
      let v = 0;
      const base = (start + i) * factor;
      for (const ch of chans) for (let d = 0; d < factor; d++) v += ch[base + d] ?? 0;
      re[i] = (v / (factor * chans.length)) * window[i];
      im[i] = 0;
    }
    fft(re, im);
    // Each frame counts equally (normalised), so loud choruses don't outvote the rest of the song
    const frame = new Array(12).fill(0);
    for (let k = 1; k < FFT_SIZE / 2; k++) {
      const pc = binClass[k];
      if (pc >= 0) frame[pc] += Math.sqrt(Math.hypot(re[k], im[k]));
    }
    const total = frame.reduce((a, v) => a + v, 0);
    if (total > 0) for (let p = 0; p < 12; p++) chroma[p] += frame[p] / total;
  }
  return chroma;
}

/** The song's key (about 40 ms for a 4-minute song). */
export function detectKey(buffer: AudioBuffer): KeyResult {
  const chroma = computeChroma(buffer);
  const scores: Array<{ tonic: number; minor: boolean; r: number }> = [];
  for (let t = 0; t < 12; t++) {
    const rotated = chroma.slice(t).concat(chroma.slice(0, t)); // chroma from the tonic upwards
    scores.push({ tonic: t, minor: false, r: correlate(rotated, MAJOR) });
    scores.push({ tonic: t, minor: true, r: correlate(rotated, MINOR) });
  }
  scores.sort((a, b) => b.r - a.r);
  const best = scores[0];
  // Relative major/minor shares the same notes: compare against the best *other* key instead
  const relative = (s: { tonic: number; minor: boolean }) =>
    s.minor !== best.minor && s.tonic === (best.minor ? (best.tonic + 3) % 12 : (best.tonic + 9) % 12);
  const rival = scores.slice(1).find((s) => !relative(s)) ?? scores[1];
  const confidence = Math.max(0, Math.min(1, (best.r - rival.r) * 4 + (best.r - 0.5)));
  return keyFromTonic(best.tonic, best.minor, confidence);
}

/** The key heard when a song plays at `rate` without key lock (vinyl): 6 % faster ≈ 1 semitone up. */
export function shiftKey(camelot: string, rate: number): string {
  const semis = Math.round(12 * Math.log2(rate));
  if (!semis) return camelot;
  const parsed = parseCamelot(camelot);
  if (!parsed) return camelot;
  const tonic = (parsed.minor ? CAMELOT_MINOR : CAMELOT_MAJOR).indexOf(parsed.num);
  return keyFromTonic(tonic + semis, parsed.minor).camelot;
}

function parseCamelot(c: string): { num: number; minor: boolean } | null {
  const m = /^(\d{1,2})([AB])$/.exec(c);
  return m ? { num: Number(m[1]), minor: m[2] === 'A' } : null;
}

export interface CamelotDetails {
  camelot: string;           // e.g. "8A"
  musicalKey: string;        // e.g. "A minor"
  shortName: string;         // e.g. "Am"
  number: number;            // 1-12
  mode: 'A' | 'B';           // 'A' = minor, 'B' = major
  tonic: number;             // 0-11 pitch class (C=0)
}

/**
 * Returns the musical key details for a Camelot code (e.g. "8A" -> "A minor / Am").
 */
export function getCamelotDetails(camelot: string | undefined): CamelotDetails {
  if (!camelot) {
    return {
      camelot: '—',
      musicalKey: 'Unknown Key',
      shortName: '—',
      number: 0,
      mode: 'A',
      tonic: 0,
    };
  }

  const parsed = parseCamelot(camelot);
  if (!parsed) {
    return {
      camelot,
      musicalKey: camelot,
      shortName: camelot,
      number: 0,
      mode: 'A',
      tonic: 0,
    };
  }

  const tonic = (parsed.minor ? CAMELOT_MINOR : CAMELOT_MAJOR).indexOf(parsed.num);
  const noteName = NOTE_NAMES[tonic] ?? 'C';
  const shortName = parsed.minor ? `${noteName}m` : noteName;
  const musicalKey = `${noteName} ${parsed.minor ? 'minor' : 'major'}`;

  return {
    camelot,
    musicalKey,
    shortName,
    number: parsed.num,
    mode: parsed.minor ? 'A' : 'B',
    tonic,
  };
}

export type HarmonicRelationType =
  | 'exact'         // 8A -> 8A (Same key)
  | 'relative'      // 8A -> 8B (Relative Major/Minor)
  | 'energy_boost'  // 8A -> 9A (+1 Camelot step: Energy lift)
  | 'deep_drop'     // 8A -> 7A (-1 Camelot step: Chill/Deep)
  | 'diagonal'      // 8A -> 9B or 7B (Diagonal neighbor)
  | 'semitone_jump' // +1 semitone (e.g. 8A to 3A)
  | 'usable'        // ±2 steps
  | 'clash';        // 3+ steps (dissonant)

export interface HarmonicCompatibility {
  score: number;             // 0.0 to 1.0 (for sorting & weighting)
  relation: HarmonicRelationType;
  label: string;             // e.g. "Harmonic Match", "Energy Boost +1", "Relative Major"
  badgeText: string;         // e.g. "±0", "+1 ⚡", "-1 🌊", "⚠️ Clash"
  color: 'emerald' | 'amber' | 'cyan' | 'teal' | 'purple' | 'slate' | 'rose';
  description: string;       // detailed tooltip explaining the musical relationship
  energyDiff: number;        // -1, 0, +1, etc.
}

/**
 * Evaluates harmonic compatibility and energy shift between two Camelot keys.
 * Used for color-coding the Up Next queue, tagging transitions, and sorting harmonic flow.
 */
export function getHarmonicCompatibility(
  currentKey: string | undefined,
  candidateKey: string | undefined
): HarmonicCompatibility {
  const pa = currentKey ? parseCamelot(currentKey) : null;
  const pb = candidateKey ? parseCamelot(candidateKey) : null;

  if (!pa || !pb) {
    return {
      score: 0.5,
      relation: 'usable',
      label: 'Key Pending',
      badgeText: '—',
      color: 'slate',
      description: 'Key analysis in progress',
      energyDiff: 0,
    };
  }

  const tonicA = (pa.minor ? CAMELOT_MINOR : CAMELOT_MAJOR).indexOf(pa.num);
  const tonicB = (pb.minor ? CAMELOT_MINOR : CAMELOT_MAJOR).indexOf(pb.num);
  const semitoneShift = (((tonicB - tonicA) % 12) + 12) % 12;

  const diffNum = (((pb.num - pa.num) % 12) + 12) % 12;
  const wheelDist = Math.min(diffNum, (12 - diffNum) % 12);
  const sameMode = pa.minor === pb.minor;

  // 1. Exact Key Match (e.g. 8A -> 8A, 8B -> 8B)
  if (sameMode && wheelDist === 0) {
    return {
      score: 1.0,
      relation: 'exact',
      label: 'Harmonic Match',
      badgeText: 'Harmonic ±0',
      color: 'emerald',
      description: `Exact harmonic match (${currentKey}): seamless blend with zero tonal clash`,
      energyDiff: 0,
    };
  }

  // 2. Relative Major/Minor (e.g. 8A Am <-> 8B C)
  if (!sameMode && wheelDist === 0) {
    const isMajorLift = !pb.minor;
    return {
      score: 0.98,
      relation: 'relative',
      label: isMajorLift ? 'Major Lift ✨' : 'Minor Mood 🌙',
      badgeText: isMajorLift ? 'To Major ✨' : 'To Minor 🌙',
      color: 'emerald',
      description: isMajorLift
        ? `Relative Major (${currentKey} → ${candidateKey}): brightens the room with identical scale notes`
        : `Relative Minor (${currentKey} → ${candidateKey}): deepens the mood with identical scale notes`,
      energyDiff: 0,
    };
  }

  // 3. Energy Boost: +1 Camelot Step (e.g. 8A -> 9A, 8B -> 9B)
  if (sameMode && diffNum === 1) {
    return {
      score: 0.95,
      relation: 'energy_boost',
      label: 'Energy Boost +1',
      badgeText: 'Energy +1 ⚡',
      color: 'amber',
      description: `+1 Camelot Step (${currentKey} → ${candidateKey}): raises room energy smoothly (adds 1 sharp)`,
      energyDiff: 1,
    };
  }

  // 4. Deep / Chill Drop: -1 Camelot Step (e.g. 8A -> 7A, 8B -> 7B)
  if (sameMode && diffNum === 11) {
    return {
      score: 0.92,
      relation: 'deep_drop',
      label: 'Deep / Chill -1',
      badgeText: 'Deep -1 🌊',
      color: 'cyan',
      description: `-1 Camelot Step (${currentKey} → ${candidateKey}): smooth wind-down for a deeper groove (adds 1 flat)`,
      energyDiff: -1,
    };
  }

  // 5. Diagonal Blend (e.g. 8A -> 9B or 8A -> 7B)
  if (!sameMode && wheelDist === 1) {
    return {
      score: 0.85,
      relation: 'diagonal',
      label: 'Diagonal Blend',
      badgeText: 'Blend ~',
      color: 'teal',
      description: `Diagonal neighbor (${currentKey} → ${candidateKey}): compatible mood shift sharing 5/7 notes`,
      energyDiff: diffNum === 1 ? 1 : -1,
    };
  }

  // 6. Semitone Energy Modulation (+1 semitone pitch jump, e.g. 8A Am -> 3A Bbm)
  if (semitoneShift === 1) {
    return {
      score: 0.8,
      relation: 'semitone_jump',
      label: 'Semitone Lift +1',
      badgeText: 'Drop Jump 🚀',
      color: 'purple',
      description: `+1 Semitone Jump (${currentKey} → ${candidateKey}): explosive drop transition for dramatic climax`,
      energyDiff: 2,
    };
  }

  // 7. Usable (±2 Camelot Steps)
  if (wheelDist === 2) {
    return {
      score: 0.5,
      relation: 'usable',
      label: 'Compatible (±2)',
      badgeText: 'Usable ±2',
      color: 'slate',
      description: `2 steps apart (${currentKey} → ${candidateKey}): best with a bass cut or quick swap`,
      energyDiff: diffNum === 2 ? 2 : -2,
    };
  }

  // 8. Key Clash (3+ steps apart)
  return {
    score: 0.1,
    relation: 'clash',
    label: 'Key Clash',
    badgeText: 'Clash ⚠️',
    color: 'rose',
    description: `Dissonant keys (${currentKey} → ${candidateKey}): recommend drop cut or echo out rather than long blend`,
    energyDiff: 0,
  };
}

/**
 * How well two keys mix: 1 = same, ±1 on the wheel, or relative major/minor; 0.5 = two steps
 * apart (usable in a short blend); 0 = clash.
 */
export function keyCompatibility(a: string | undefined, b: string | undefined): number | null {
  const pa = a ? parseCamelot(a) : null;
  const pb = b ? parseCamelot(b) : null;
  if (!pa || !pb) return null;
  const d = Math.min((pa.num - pb.num + 12) % 12, (pb.num - pa.num + 12) % 12);
  if (pa.minor === pb.minor) return d <= 1 ? 1 : d === 2 ? 0.5 : 0;
  return d === 0 ? 1 : 0;
}
