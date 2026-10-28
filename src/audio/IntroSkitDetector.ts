/**
 * IntroSkitDetector — finds where the music really starts when a song (usually its music
 * video audio) opens with spoken dialogue, a movie scene or a skit.
 *
 * 1. Beat presence over time: for each second, how strongly low-end attacks (kick, dhol,
 *    bass) repeat at the song's own beat period, compared with the rest of the song.
 *    The music start is the first point where the beat is clearly there and stays for 8 s.
 * 2. What comes before it: speech has syllables and pauses (a choppy 300 Hz–3 kHz envelope)
 *    and no beat; a musical intro (pads, piano, vocals over strings) is smooth and sustained.
 *
 * Scans up to 150 s (music video intros can run past a minute, e.g. "Morni" starts at 1:07).
 * The AI DJ (Ollama) is consulted for unclear cases; see AudioEngine.analyzeIntro.
 */

export interface IntroAnalysisResult {
  hasConversationPreamble: boolean;
  suggestedMusicStart: number; // seconds, on the beat grid (0 = play from the start)
  candidates: number[]; // possible music start points in seconds (always includes 0)
  confidence: number; // 0.0 to 1.0
  reason: string;
  speechFraction: number; // share of the pre-music seconds that sound like talking (0–1)
  beatStart: number; // first time the beat is clearly present (before snapping)
  // Per-second diagnostics of the scanned opening, for tuning on real songs:
  // beat = pulse strength vs this song's normal (1 = typical), bass = low-end level vs normal,
  // speech = 1 talking-like, 0 not, -1 silent
  profile?: { beat: number[]; bass: number[]; speech: number[] };
}

const FRAME_RATE = 100; // 10 ms frames
const WINDOW_SECONDS = 6; // beat-strength window
const SUSTAIN_SECONDS = 8; // the beat must hold this long to count as "music started"
const MAX_SCAN_SECONDS = 150;
const MIN_LAG = 30; // 0.3 s = 200 BPM
const MAX_LAG = 100; // 1.0 s = 60 BPM

const NO_INTRO = (reason: string, confidence = 0.9, profile?: IntroAnalysisResult['profile']): IntroAnalysisResult => ({
  hasConversationPreamble: false,
  suggestedMusicStart: 0,
  candidates: [0],
  confidence,
  reason,
  speechFraction: 0,
  beatStart: 0,
  profile,
});

export class IntroSkitDetector {
  /**
   * @param buffer Decoded PCM AudioBuffer
   * @param bpm Track BPM (from BpmDetector, measured past the intro)
   * @param firstDownbeatTime A bar downbeat ("1") of the beat grid, in seconds
   */
  public static detectMusicStart(buffer: AudioBuffer, bpm: number = 128, firstDownbeatTime: number = 0): IntroAnalysisResult {
    const duration = buffer.duration;
    if (duration < 30) return NO_INTRO('Short track, plays from the start');

    const sampleRate = buffer.sampleRate;
    const data = buffer.getChannelData(0);
    const beatSeconds = 60 / (bpm > 50 && bpm < 220 ? bpm : 128);
    const scanSeconds = Math.min(MAX_SCAN_SECONDS, duration * 0.5);
    // Also analyse a stretch past the scan so "normal for this song" levels are known
    const refSeconds = Math.min(duration, scanSeconds + 60);

    // --- 10 ms envelopes: low band (≤150 Hz), mid band (300 Hz–3 kHz, voice), full band ---
    const hop = Math.floor(sampleRate / FRAME_RATE);
    const frames = Math.floor((refSeconds * sampleRate) / hop);
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
      const base = f * hop;
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
    if (peakFull < 0.005) return NO_INTRO('Very quiet audio', 0.5);

    // --- Low-end onset strength (rise in log energy), the "beat" signal ---
    const peakLow = low.reduce((m, v) => Math.max(m, v), 1e-9);
    const onset = new Float32Array(frames);
    for (let f = 1; f < frames; f++) {
      const d = Math.log1p((100 * low[f]) / peakLow) - Math.log1p((100 * low[f - 1]) / peakLow);
      onset[f] = d > 0 ? d : 0;
    }

    // --- Beat strength per second ---
    const win = WINDOW_SECONDS * FRAME_RATE;
    const seconds = Math.floor((frames - win - MAX_LAG - 2) / FRAME_RATE);
    if (seconds < SUSTAIN_SECONDS + 2) return NO_INTRO('Not enough audio to analyse', 0.5);

    // Pulse strength = best normalised autocorrelation over every plausible beat period
    // (0.3–1.0 s = 60–200 BPM), so it doesn't depend on the BPM reading being right.
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

    // "Normal" beat strength / bass level for this song: upper quartile of the analysed stretch
    const quantile = (arr: Float32Array, q: number) => {
      const sorted = Array.from(arr).sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    };
    const refBeat = Math.max(0.05, quantile(beatStrength, 0.75));
    const refLow = Math.max(1e-6, quantile(lowLevel, 0.75));
    const hasBeat = (s: number) => beatStrength[s] >= 0.45 * refBeat && lowLevel[s] >= 0.3 * refLow;

    /** One second of audio: 1 = talking-like (choppy voice band with pauses), 0 = not, -1 = silent. */
    const speechAt = (s: number): number => {
      const a = s * FRAME_RATE;
      let sum = 0;
      let max = 0;
      for (let f = a; f < a + FRAME_RATE; f++) {
        sum += mid[f];
        if (mid[f] > max) max = mid[f];
      }
      const meanMid = sum / FRAME_RATE;
      if (max < 0.02 * peakFull) return -1;
      let variance = 0;
      let pauses = 0;
      for (let f = a; f < a + FRAME_RATE; f++) {
        variance += (mid[f] - meanMid) ** 2;
        if (mid[f] < 0.15 * max) pauses++;
      }
      const choppiness = Math.sqrt(variance / FRAME_RATE) / (meanMid || 1);
      return choppiness > 0.5 && pauses >= 8 ? 1 : 0;
    };

    const round2 = (v: number) => Math.round(v * 100) / 100;
    const profileSeconds = Math.min(seconds, Math.floor(scanSeconds) + SUSTAIN_SECONDS);
    const profile = {
      beat: Array.from(beatStrength.subarray(0, profileSeconds), (v) => round2(v / refBeat)),
      bass: Array.from(lowLevel.subarray(0, profileSeconds), (v) => round2(v / refLow)),
      speech: Array.from({ length: profileSeconds }, (_, s) => speechAt(s)),
    };

    // --- Music start: first second where the beat is there and holds for SUSTAIN_SECONDS ---
    const scanEnd = Math.min(seconds - SUSTAIN_SECONDS, Math.floor(scanSeconds));
    let beatStart = -1;
    for (let s = 0; s <= scanEnd; s++) {
      let held = 0;
      for (let k = 0; k < SUSTAIN_SECONDS; k++) if (hasBeat(s + k)) held++;
      if (held >= SUSTAIN_SECONDS - 1) {
        beatStart = s;
        break;
      }
    }
    if (beatStart < 0) return NO_INTRO('No clear beat found early in the song; playing from the start', 0.6, profile);

    // Refine inside the first beat window: the first strong low-end attack
    const refineFrom = beatStart * FRAME_RATE;
    const onsetPeak = onset.subarray(refineFrom, refineFrom + win).reduce((m, v) => Math.max(m, v), 0);
    let firstHit = refineFrom;
    for (let f = refineFrom; f < refineFrom + win; f++) {
      if (onset[f] >= 0.5 * onsetPeak) {
        firstHit = f;
        break;
      }
    }
    const rawStart = firstHit / FRAME_RATE;
    if (rawStart <= 3) return NO_INTRO('Music starts at the beginning', 0.9, profile);

    // --- What is before the beat: speech (choppy voice band, pauses) or a musical intro? ---
    let speechSeconds = 0;
    let audibleSeconds = 0;
    const preSeconds = Math.floor(rawStart);
    for (let s = 0; s < preSeconds; s++) {
      const kind = speechAt(s);
      if (kind < 0) continue; // silence
      audibleSeconds++;
      if (kind === 1) speechSeconds++;
    }
    const speechFraction = audibleSeconds ? speechSeconds / audibleSeconds : 0;
    const mostlySilent = audibleSeconds < preSeconds * 0.3;

    // Start on the beat grid, preferring the bar downbeat ("1") at or just before the first hit
    const musicStart = this.snapToBar(rawStart, beatSeconds, firstDownbeatTime);
    const candidates = Array.from(new Set([0, musicStart, this.snapToBeatGrid(rawStart, beatSeconds, firstDownbeatTime)])).sort(
      (x, y) => x - y
    );
    const at = `${Math.floor(musicStart / 60)}:${String(Math.round(musicStart % 60)).padStart(2, '0')}`;

    if (speechFraction >= 0.35 || mostlySilent) {
      return {
        hasConversationPreamble: true,
        suggestedMusicStart: musicStart,
        candidates,
        confidence: Math.min(0.95, 0.6 + speechFraction * 0.4),
        reason: mostlySilent
          ? `Silence before the music; starting at ${at}`
          : `Talking/dialogue before the music (${Math.round(speechFraction * 100)}% speech); starting at ${at}`,
        speechFraction,
        beatStart: rawStart,
        profile,
      };
    }
    // Beat-less but musical intro (pads, piano, sung intro): not a conversation, keep it
    return {
      hasConversationPreamble: false,
      suggestedMusicStart: 0,
      candidates,
      confidence: 0.4 + (0.35 - speechFraction),
      reason: `Musical intro before the beat at ${at} (${Math.round(speechFraction * 100)}% speech-like); playing it`,
      speechFraction,
      beatStart: rawStart,
      profile,
    };
  }

  /** Bar downbeat at or before the time if within a bar, else the nearest beat. */
  public static snapToBar(timeSeconds: number, beatSeconds: number, firstDownbeatTime: number): number {
    const bar = beatSeconds * 4;
    const barsFromGrid = Math.floor((timeSeconds + 0.15 * beatSeconds - firstDownbeatTime) / bar);
    const barStart = firstDownbeatTime + barsFromGrid * bar;
    if (timeSeconds - barStart <= beatSeconds * 1.1 && barStart >= 0) return Math.round(barStart * 10) / 10;
    return this.snapToBeatGrid(timeSeconds, beatSeconds, firstDownbeatTime);
  }

  /**
   * Snaps a timestamp to the closest beat grid point.
   */
  public static snapToBeatGrid(timeSeconds: number, beatSeconds: number, firstDownbeatTime: number): number {
    if (beatSeconds <= 0) return Math.max(0, Math.round(timeSeconds * 10) / 10);
    const offset = (timeSeconds - firstDownbeatTime) / beatSeconds;
    const nearestBeat = Math.round(offset);
    const snapped = firstDownbeatTime + nearestBeat * beatSeconds;
    return Math.max(0, Math.round(snapped * 10) / 10);
  }
}
