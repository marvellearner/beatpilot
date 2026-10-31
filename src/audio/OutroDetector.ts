/**
 * OutroDetector — finds where the music really ends when a song (usually its music video audio)
 * closes with a movie scene, dialogue, credits, a long fade-out or silence.
 *
 * The mirror of IntroSkitDetector: over the last part of the song it measures beat presence
 * (beatPresence.ts), finds the last point where the beat is clearly there and holds for 8 s,
 * and looks at what follows. Talking, silence or a quiet fade is cut: the auto-mix treats the
 * music end as the song's end. A beat-less but musical outro (pads, a sung ending) keeps
 * OUTRO_TAIL_SECONDS of it for the blend. Decided from the audio alone; applied in
 * AudioEngine.analyzeTrack. Rules: MIXING_RULES.md "Music End (Outro) Rules".
 */
import { FRAME_RATE, WINDOW_SECONDS, measureBeatPresence, quantile, speechAt } from './beatPresence';
import { IntroSkitDetector } from './IntroSkitDetector';

export interface OutroAnalysisResult {
  musicEnd: number; // seconds: where the song is treated as over (the file's end when nothing is cut)
  cut: boolean; // something after the music is skipped
  reason: string;
}

const SUSTAIN_SECONDS = 8; // the beat must hold this long to count as music
const MAX_SCAN_SECONDS = 150; // the last 2.5 minutes
const REF_SECONDS = 60; // plus a minute before it, so "normal for this song" is known
const MIN_TAIL_SECONDS = 10; // less than this after the beat isn't worth cutting
const OUTRO_TAIL_SECONDS = 16; // of a beat-less musical outro, kept for the blend

const NONE = (duration: number, reason: string): OutroAnalysisResult => ({ musicEnd: duration, cut: false, reason });

export class OutroDetector {
  /**
   * @param buffer Decoded PCM AudioBuffer
   * @param bpm Track BPM
   * @param firstDownbeatTime A bar downbeat ("1") of the beat grid, in seconds
   */
  public static detectMusicEnd(buffer: AudioBuffer, bpm: number = 128, firstDownbeatTime: number = 0): OutroAnalysisResult {
    const duration = buffer.duration;
    if (duration < 60) return NONE(duration, 'Short track, plays to the end');

    const scan = Math.min(MAX_SCAN_SECONDS, duration * 0.5);
    const from = Math.max(0, duration - scan - REF_SECONDS);
    const presence = measureBeatPresence(buffer.getChannelData(0), buffer.sampleRate, from, duration - from);
    const { onset, full, beatStrength, lowLevel, seconds, peakFull } = presence;
    if (peakFull < 0.005 || seconds < SUSTAIN_SECONDS + 2) return NONE(duration, 'Not enough audio to analyse the ending');

    const refBeat = Math.max(0.05, quantile(beatStrength, 0.75));
    const refLow = Math.max(1e-6, quantile(lowLevel, 0.75));
    const hasBeat = (s: number) => beatStrength[s] >= 0.45 * refBeat && lowLevel[s] >= 0.3 * refLow;

    // --- Last second where the beat holds for SUSTAIN_SECONDS (searching back from the end) ---
    let lastHeld = -1;
    for (let s = seconds - SUSTAIN_SECONDS; s >= 0; s--) {
      let held = 0;
      for (let k = 0; k < SUSTAIN_SECONDS; k++) if (hasBeat(s + k)) held++;
      if (held >= SUSTAIN_SECONDS - 1) {
        lastHeld = s + SUSTAIN_SECONDS - 1;
        break;
      }
    }
    if (lastHeld < 0) return NONE(duration, 'No clear beat near the end; playing to the end');

    // The window of the last beat second runs WINDOW_SECONDS on: the last strong low-end attack in it
    const win = WINDOW_SECONDS * FRAME_RATE;
    const a = lastHeld * FRAME_RATE;
    const b = Math.min(onset.length, a + win + FRAME_RATE);
    let onsetPeak = 0;
    for (let f = a; f < b; f++) if (onset[f] > onsetPeak) onsetPeak = onset[f];
    // A hit must also be loud in the bass (a kick or dhol): a syllable of talking makes a small
    // onset there too, which would stretch the music past its end
    const kickLevel = quantile(presence.low, 0.98);
    const loudLow = (f: number) => {
      let m = 0;
      for (let k = f; k < f + 6 && k < presence.low.length; k++) if (presence.low[k] > m) m = presence.low[k];
      return m >= 0.3 * kickLevel;
    };
    let lastHit = a;
    for (let f = b - 1; f >= a; f--) {
      if (onset[f] >= 0.5 * onsetPeak && loudLow(f)) {
        lastHit = f;
        break;
      }
    }
    const beatSeconds = 60 / (bpm > 50 && bpm < 220 ? bpm : 128);
    const rawEnd = from + lastHit / FRAME_RATE + beatSeconds; // the last hit rings for a beat
    const tail = duration - rawEnd;
    if (tail < MIN_TAIL_SECONDS) return NONE(duration, 'Music runs to the end');

    // --- What follows the beat: talking, silence, a quiet fade, or a musical outro? ---
    const fullAt = (s: number) => {
      let sum = 0;
      for (let f = s * FRAME_RATE; f < (s + 1) * FRAME_RATE && f < full.length; f++) sum += full[f];
      return sum / FRAME_RATE;
    };
    let refFull = 0;
    for (let s = Math.max(0, lastHeld - 30); s <= lastHeld; s++) refFull += fullAt(s);
    refFull /= Math.min(31, lastHeld + 1);

    const startSec = Math.ceil(rawEnd - from);
    const endSec = Math.floor(full.length / FRAME_RATE) - 1;
    let audible = 0;
    let speech = 0;
    let quiet = 0;
    let total = 0;
    for (let s = startSec; s <= endSec; s++) {
      total++;
      const kind = speechAt(presence, s);
      if (kind >= 0) audible++;
      if (kind === 1) speech++;
      if (fullAt(s) < 0.25 * refFull) quiet++;
    }
    if (total === 0) return NONE(duration, 'Music runs to the end');
    const speechFraction = audible ? speech / audible : 0;
    const quietFraction = quiet / total;
    const mostlySilent = audible < total * 0.3;

    // End on the bar line after the last hit (the phrase finishes, nothing is cut mid-bar)
    const bar = beatSeconds * 4;
    const barEnd = firstDownbeatTime + Math.ceil((rawEnd - 0.15 * beatSeconds - firstDownbeatTime) / bar) * bar;
    const end = Math.min(duration, Math.max(rawEnd, barEnd));
    const at = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;

    if (mostlySilent || speechFraction >= 0.2 || quietFraction >= 0.6) {
      const what = mostlySilent ? 'silence' : speechFraction >= 0.2 ? `talking/dialogue (${Math.round(speechFraction * 100)}% speech)` : 'a quiet fade-out';
      return { musicEnd: round1(end), cut: true, reason: `Music ends at ${at(end)}; skipping ${Math.round(duration - end)} s of ${what}` };
    }
    // A musical outro without the beat: keep a little of it to blend over, skip the rest
    if (tail > OUTRO_TAIL_SECONDS + MIN_TAIL_SECONDS) {
      const kept = IntroSkitDetector.snapToBeatGrid(rawEnd + OUTRO_TAIL_SECONDS, beatSeconds, firstDownbeatTime);
      return { musicEnd: round1(Math.min(duration, kept)), cut: true, reason: `Long outro without the beat from ${at(rawEnd)}; keeping ${OUTRO_TAIL_SECONDS} s of it` };
    }
    return NONE(duration, `Musical outro after ${at(rawEnd)}; playing it`);
  }
}

const round1 = (v: number) => Math.round(v * 10) / 10;
