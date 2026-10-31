/**
 * HookDetector — finds a song's hooks: every chorus (a loud section that comes back with the same
 * harmony) and a one-off drop, not just its single loudest moment.
 *
 * 1. Per bar (from the beat grid): loudness, and a 12-note harmony profile (chroma).
 * 2. Each 8-bar stretch is compared with every later one: a chorus is a stretch that returns
 *    (similar harmony bar by bar) and is louder than the song's average.
 * 3. The best such pair gives the chorus; every repeat of it is a hook (2–3 of them usually).
 * 4. A drop: an equally loud, one-off stretch away from the choruses.
 * Falls back to the loudest stretch when nothing repeats. Times are bar starts (song seconds).
 * Decided from the audio alone; applied in AudioEngine.analyzeTrack. Rules: MIXING_RULES.md "Hooks".
 */
import { fft } from './KeyDetector';

import type { SongHook } from '../types';

/** time: where the hook starts, on a bar; kind 'peak': the loudest stretch, when nothing repeats. */
export type Hook = SongHook;

const FFT_SIZE = 4096;
const SECTION_BARS = 8; // a chorus is compared 8 bars at a time
const MIN_REPEAT_SIMILARITY = 0.8; // average bar-by-bar harmony similarity for "the same section"
const MAX_HOOKS = 4;
const CHORUS_MIN_LOUDNESS = 1.05; // a chorus is at least this loud vs the song's average bar

export class HookDetector {
  /**
   * @param from / to the stretch of the song with music (skip a talking intro / closing scene)
   */
  public static detectHooks(buffer: AudioBuffer, bpm: number, downbeat: number, from = 0, to = buffer.duration): Hook[] {
    const bar = (4 * 60) / (bpm > 60 && bpm < 200 ? bpm : 120);
    const first = Math.ceil((Math.max(0, from) - downbeat) / bar);
    const starts: number[] = [];
    for (let k = Math.max(0, first); downbeat + (k + 1) * bar <= Math.min(to, buffer.duration); k++) starts.push(downbeat + k * bar);
    if (starts.length < SECTION_BARS * 3) return [];

    const { energy, chroma } = barFeatures(buffer, starts, bar);
    const n = starts.length;
    const mean = energy.reduce((a, v) => a + v, 0) / n;
    const sectionEnergy = (i: number) => {
      let s = 0;
      for (let k = 0; k < SECTION_BARS; k++) s += energy[i + k];
      return s / SECTION_BARS;
    };
    const similarity = (i: number, j: number) => {
      let s = 0;
      for (let k = 0; k < SECTION_BARS; k++) s += cosine(chroma[i + k], chroma[j + k]);
      return s / SECTION_BARS;
    };

    // The best repeating, loud section: harmony similarity times loudness (vs the song's average)
    let best = { i: -1, j: -1, score: 0 };
    // (loudness counts a lot: verses and intro riffs repeat too, but a chorus is the loud part;
    // repeats less than two sections apart are one chorus's two halves, not two choruses)
    for (let i = 0; i + SECTION_BARS <= n; i++) {
      const ei = sectionEnergy(i);
      if (ei < CHORUS_MIN_LOUDNESS * mean) continue;
      for (let j = i + 2 * SECTION_BARS; j + SECTION_BARS <= n; j++) {
        const sim = similarity(i, j);
        if (sim < MIN_REPEAT_SIMILARITY) continue;
        const score = sim * (Math.min(ei, sectionEnergy(j)) / mean) ** 3;
        if (score > best.score) best = { i, j, score };
      }
    }

    const hooks: Hook[] = [];
    const taken: number[] = []; // bar indexes of the hooks found
    // Two hooks closer than two sections are one chorus (its halves repeat inside it)
    const farFrom = (i: number) => taken.every((t) => Math.abs(t - i) >= 2 * SECTION_BARS);
    if (best.i >= 0) {
      // Every repeat of that chorus: sections as similar to it and about as loud
      const ref = best.i;
      const threshold = Math.max(MIN_REPEAT_SIMILARITY, similarity(ref, best.j) - 0.06);
      const candidates: Array<{ i: number; sim: number }> = [{ i: ref, sim: 1 }];
      for (let j = 0; j + SECTION_BARS <= n; j++) {
        if (j === ref) continue;
        const sim = similarity(ref, j);
        if (sim >= threshold && sectionEnergy(j) >= 0.85 * mean) candidates.push({ i: j, sim });
      }
      // The best-matching bar of each repeat (repeats overlap bar by bar near their start)
      candidates.sort((a, b) => b.sim - a.sim);
      for (const c of candidates) {
        if (taken.length >= MAX_HOOKS - 1) break;
        if (farFrom(c.i)) taken.push(c.i);
      }
      taken.sort((a, b) => a - b);
      for (const i of taken) hooks.push({ time: round1(starts[i]), kind: 'chorus' });
    }

    // A drop: the loudest section that isn't one of the choruses, if it's about as loud as them
    let loudest = { i: -1, e: 0 };
    for (let i = 0; i + SECTION_BARS <= n; i++) {
      const e = sectionEnergy(i);
      if (e > loudest.e && farFrom(i)) loudest = { i, e };
    }
    const chorusEnergy = taken.length ? Math.max(...taken.map(sectionEnergy)) : 0;
    if (loudest.i >= 0 && (taken.length === 0 || loudest.e >= 0.95 * chorusEnergy)) {
      hooks.push({ time: round1(starts[loudest.i]), kind: taken.length ? 'drop' : 'peak' });
    }
    return hooks.sort((a, b) => a.time - b.time).slice(0, MAX_HOOKS);
  }
}

/** Per bar: RMS loudness and a normalised 12-note harmony profile (two FFT frames per bar). */
function barFeatures(buffer: AudioBuffer, starts: number[], bar: number) {
  const factor = Math.max(1, Math.round(buffer.sampleRate / 11025));
  const rate = buffer.sampleRate / factor;
  const data = buffer.getChannelData(0);
  const binClass = new Int8Array(FFT_SIZE / 2).fill(-1);
  for (let k = 1; k < FFT_SIZE / 2; k++) {
    const f = (k * rate) / FFT_SIZE;
    if (f < 65 || f > 2000) continue;
    binClass[k] = ((Math.round(69 + 12 * Math.log2(f / 440)) % 12) + 12) % 12;
  }
  const win = new Float64Array(FFT_SIZE).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const energy: number[] = [];
  const chroma: number[][] = [];
  for (const start of starts) {
    // Loudness over the bar
    const a = Math.floor(start * buffer.sampleRate);
    const b = Math.min(data.length, Math.floor((start + bar) * buffer.sampleRate));
    let sum = 0;
    let count = 0;
    for (let i = a; i < b; i += 16) {
      sum += data[i] * data[i];
      count++;
    }
    energy.push(Math.sqrt(sum / Math.max(1, count)));
    // Harmony: two frames, at a quarter and three quarters of the bar
    const c = new Array(12).fill(0);
    for (const at of [0.25, 0.75]) {
      const center = Math.floor(((start + bar * at) * buffer.sampleRate) / factor) - FFT_SIZE / 2;
      for (let i = 0; i < FFT_SIZE; i++) {
        let v = 0;
        const base = (center + i) * factor;
        for (let d = 0; d < factor; d++) v += data[base + d] ?? 0;
        re[i] = (v / factor) * win[i];
        im[i] = 0;
      }
      fft(re, im);
      for (let k = 1; k < FFT_SIZE / 2; k++) {
        const pc = binClass[k];
        if (pc >= 0) c[pc] += Math.sqrt(Math.hypot(re[k], im[k]));
      }
    }
    const total = c.reduce((s, v) => s + v, 0) || 1;
    chroma.push(c.map((v) => v / total));
  }
  return { energy, chroma };
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const round1 = (v: number) => Math.round(v * 10) / 10;
