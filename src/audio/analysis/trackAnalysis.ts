/**
 * A song's audio analysis (BPM, beat grid, hooks, where the music starts and ends, key,
 * loudness) as one pure function, so it can run in a Web Worker (analyzeInWorker.ts) instead
 * of freezing the UI for ~1.5 s per song, or on the main thread when a result is needed at once.
 * Results are also saved per song (analysisCache.ts), so a song played before is ready instantly.
 */

import type { SongHook, TrackMetadata } from '../../types';
import { detectBpmFromBuffer } from '../BpmDetector';
import { HighlightDetector } from '../HighlightDetector';
import { HookDetector } from '../HookDetector';
import { IntroSkitDetector, IntroAnalysisResult } from '../IntroSkitDetector';
import { detectKey } from '../KeyDetector';
import { measureLoudnessDb } from '../Loudness';
import { computeEnergyProfile, EnergyProfile } from '../MixPointPlanner';
import { OutroDetector } from '../OutroDetector';

/** The fields the analysis fills in; anything already set (e.g. a known BPM) is kept. */
export interface AnalysisFields {
  bpm?: number;
  bpmConfidence?: number;
  firstDownbeatTime?: number;
  highlightTime?: number;
  cueInTime?: number;
  highlightSource?: TrackMetadata['highlightSource'];
  highlightIntensity?: number;
  musicStartTime?: number;
  introSkipReason?: string;
  musicEndTime?: number;
  outroReason?: string;
  hooks?: SongHook[];
  key?: string;
  keyConfidence?: number;
  loudnessDb?: number;
  energyProfile?: EnergyProfile;
}

export const ANALYSIS_FIELDS = [
  'bpm', 'bpmConfidence', 'firstDownbeatTime', 'highlightTime', 'cueInTime', 'highlightSource',
  'highlightIntensity', 'musicStartTime', 'introSkipReason', 'musicEndTime', 'outroReason', 'hooks',
  'key', 'keyConfidence', 'loudnessDb', 'energyProfile',
] as const satisfies readonly (keyof AnalysisFields)[];

/** True when nothing is left to analyse (the cheap per-deck steps aside). */
export function analysisComplete(f: AnalysisFields): boolean {
  return (
    !!f.energyProfile && !!f.bpm && f.bpmConfidence !== undefined && f.highlightTime !== undefined && f.cueInTime !== undefined &&
    f.musicStartTime !== undefined && f.musicEndTime !== undefined && f.hooks !== undefined && f.keyConfidence !== undefined && f.loudnessDb !== undefined
  );
}

/**
 * Fills in whatever `f` is missing from the audio. `strict` = a song that must start at 0:00
 * (no intro skip, no pre-roll cue). Returns the intro analysis when it ran (for inspection).
 */
export function runAnalysis(buffer: AudioBuffer, f: AnalysisFields, strict: boolean): { intro?: IntroAnalysisResult } {
  let intro: IntroAnalysisResult | undefined;
  if (!f.energyProfile) f.energyProfile = computeEnergyProfile(buffer);

  if (f.bpmConfidence === undefined || !f.bpm) {
    const bpmResult = detectBpmFromBuffer(buffer);
    f.bpm = bpmResult.bpm;
    f.bpmConfidence = bpmResult.confidence;
    f.firstDownbeatTime = bpmResult.firstDownbeatTime;
  }
  const bpm = f.bpm;
  const firstDownbeatTime = f.firstDownbeatTime ?? 0;

  // Detect the world's most liked part (highlight) & optimal pre-roll cue-in
  if (f.highlightTime === undefined || f.cueInTime === undefined) {
    const highlight = HighlightDetector.detectHighlight(
      buffer,
      bpm,
      f.highlightTime ? { peakSeconds: f.highlightTime, intensity: f.highlightIntensity || 0.95 } : undefined,
      firstDownbeatTime
    );
    f.highlightTime = highlight.highlightTime;
    f.cueInTime = highlight.cueInTime;
    f.highlightSource = highlight.source;
    f.highlightIntensity = highlight.intensity;
  }

  // Skip a spoken intro (dialogue, movie scene, skit) and start where the music begins.
  // Decided from the audio: a talking opening (speech-like, no beat) is skipped, a musical one is kept.
  // Exception: Ping Pong Tremor (and related festival anthems) strictly plays from 0:00 starting timestamp.
  if (strict) {
    f.musicStartTime = 0;
    f.cueInTime = 0;
    f.introSkipReason = undefined;
  } else if (f.musicStartTime === undefined) {
    intro = IntroSkitDetector.detectMusicStart(buffer, bpm, firstDownbeatTime);
    f.musicStartTime = intro.suggestedMusicStart;
    f.introSkipReason = intro.reason;
  }

  // Where the music ends: a closing scene, dialogue, fade or silence after it is never waited for
  if (f.musicEndTime === undefined) {
    const outro = OutroDetector.detectMusicEnd(buffer, bpm, firstDownbeatTime);
    f.musicEndTime = outro.musicEnd;
    f.outroReason = outro.cut ? outro.reason : undefined;
  }

  // Every hook (each chorus, a drop), not only the loudest moment. The first chorus is the song's
  // hook for Best Parts and the pre-roll cue; "Best part" moves through all of them.
  if (f.hooks === undefined) {
    f.hooks = HookDetector.detectHooks(buffer, bpm, firstDownbeatTime, f.musicStartTime ?? 0, f.musicEndTime ?? buffer.duration);
    const first = f.hooks.find((h) => h.kind === 'chorus') ?? f.hooks[0];
    if (first && !strict) {
      f.highlightTime = first.time;
      f.cueInTime = HighlightDetector.calculatePhraseAlignedCueIn(first.time, 60 / bpm, firstDownbeatTime);
    }
  }

  // Key (for harmonic mixing) and loudness (for level matching)
  if (f.keyConfidence === undefined) {
    const key = detectKey(buffer);
    f.key = key.camelot;
    f.keyConfidence = key.confidence;
  }
  if (f.loudnessDb === undefined) f.loudnessDb = measureLoudnessDb(f.energyProfile);
  return { intro };
}
