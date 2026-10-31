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
 * Decided from the audio alone (no AI); the result is applied in AudioEngine.analyzeTrack.
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

import { FRAME_RATE, WINDOW_SECONDS, measureBeatPresence, quantile, speechAt as speechKind } from './beatPresence';

const SUSTAIN_SECONDS = 8; // the beat must hold this long to count as "music started"
const MAX_SCAN_SECONDS = 150;

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

    // --- Beat presence per second (envelopes, low-end onsets, pulse strength; see beatPresence.ts) ---
    const presence = measureBeatPresence(data, sampleRate, 0, refSeconds);
    const { onset, beatStrength, lowLevel, seconds, peakFull } = presence;
    if (peakFull < 0.005) return NO_INTRO('Very quiet audio', 0.5);
    const win = WINDOW_SECONDS * FRAME_RATE;
    if (seconds < SUSTAIN_SECONDS + 2) return NO_INTRO('Not enough audio to analyse', 0.5);

    // "Normal" beat strength / bass level for this song: upper quartile of the analysed stretch
    const refBeat = Math.max(0.05, quantile(beatStrength, 0.75));
    const refLow = Math.max(1e-6, quantile(lowLevel, 0.75));
    const hasBeat = (s: number) => beatStrength[s] >= 0.45 * refBeat && lowLevel[s] >= 0.3 * refLow;

    /** One second of audio: 1 = talking-like (choppy voice band with pauses), 0 = not, -1 = silent. */
    const speechAt = (s: number) => speechKind(presence, s);

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

    const hasSpokenPreamble =
      speechFraction >= 0.20 ||
      mostlySilent ||
      (rawStart >= 5 && speechFraction >= 0.10) ||
      rawStart >= 8;

    if (hasSpokenPreamble) {
      return {
        hasConversationPreamble: true,
        suggestedMusicStart: musicStart,
        candidates,
        confidence: Math.min(0.95, 0.6 + speechFraction * 0.4),
        reason: mostlySilent
          ? `Silence before the music; starting at ${at}`
          : `Talking/dialogue preamble before the music (${Math.round(speechFraction * 100)}% speech); skipping dialogue to ${at}`,
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
