import { BpmAnalysisResult } from '../audio/BpmDetector';
import { TrackMetadata } from '../types';

export interface PercussionDecision {
  shouldPlay: boolean;
  patternId: 'punjabi_dhol' | 'bhangra_groove' | 'electronic_drums' | 'afrobeat';
  targetBpm: number;
  reason: string;
  confidence: number;
}

export function evaluatePercussionForTrack(
  track: TrackMetadata | null,
  bpmAnalysis: BpmAnalysisResult
): PercussionDecision {
  if (!track) {
    return {
      shouldPlay: false,
      patternId: 'punjabi_dhol',
      targetBpm: 128,
      reason: 'No active track on air.',
      confidence: 1.0,
    };
  }

  // 1. Core Rule: Must be properly synced (confidence >= 0.60) else DO NOT PLAY
  if (!bpmAnalysis.isRegularBeat || bpmAnalysis.confidence < 0.6) {
    return {
      shouldPlay: false,
      patternId: 'punjabi_dhol',
      targetBpm: bpmAnalysis.bpm,
      reason: `Rhythmic sync confidence low (${Math.round(bpmAnalysis.confidence * 100)}%) — holding percussion to prevent clashing.`,
      confidence: bpmAnalysis.confidence,
    };
  }

  const title = (track.title + ' ' + track.artist).toLowerCase();

  // 2. Identify Acoustic / Slow / Lo-fi songs where drums would ruin the mood
  const quietKeywords = [
    'acoustic',
    'lofi',
    'lo-fi',
    'unplugged',
    'piano',
    'sad',
    'slowed',
    'ambient',
    'lullaby',
    'meditation',
  ];
  if (quietKeywords.some((w) => title.includes(w)) || bpmAnalysis.bpm < 82) {
    return {
      shouldPlay: false,
      patternId: 'punjabi_dhol',
      targetBpm: bpmAnalysis.bpm,
      reason: 'Acoustic / mellow track detected — keeping percussion muted to preserve musical intimacy.',
      confidence: 0.95,
    };
  }

  // 3. Match Genre to Ideal Percussion Pattern

  // A. Punjabi / Desi / Bhangra Hits
  const punjabiKeywords = [
    'punjabi',
    'bhangra',
    'dhol',
    'moose',
    'sidhu',
    'diljit',
    'singh',
    'dhillon',
    'aujla',
    'karan',
    'shubh',
    'badshah',
    'honey',
    'raftaar',
    'desi',
    'kalakaar',
    'ap dhillon',
    'gurdas',
    'amrit',
    'channi',
  ];
  if (punjabiKeywords.some((w) => title.includes(w))) {
    // If fast club tempo (>=126 BPM), engage heavy Punjabi Dhol Chaap; if groove tempo (<126), engage Bhangra Dholak
    const pattern = bpmAnalysis.bpm >= 126 ? 'punjabi_dhol' : 'bhangra_groove';
    return {
      shouldPlay: true,
      patternId: pattern,
      targetBpm: bpmAnalysis.bpm,
      reason: `Punjabi track detected — auto-engaging ${pattern === 'punjabi_dhol' ? 'Authentic Live Dhol' : 'Bhangra Dholak & Chimta'} locked precisely at ${bpmAnalysis.bpm} BPM.`,
      confidence: 0.95,
    };
  }

  // B. Electronic / House / Club / EDM
  const edmKeywords = [
    'club',
    'house',
    'remix',
    'edm',
    'dance',
    'electro',
    'techno',
    'bass',
    'festival',
    'extended mix',
    'tiesto',
    'david guetta',
    'calvin harris',
  ];
  if (edmKeywords.some((w) => title.includes(w)) || (bpmAnalysis.bpm >= 124 && bpmAnalysis.bpm <= 132)) {
    return {
      shouldPlay: true,
      patternId: 'electronic_drums',
      targetBpm: bpmAnalysis.bpm,
      reason: `Club/Dance groove detected — auto-engaging 4-on-the-Floor Electronic Drums synced at ${bpmAnalysis.bpm} BPM.`,
      confidence: 0.9,
    };
  }

  // C. Afrobeat / Amapiano / Latin / Reggaeton
  const afroKeywords = [
    'afro',
    'amapiano',
    'burna',
    'rema',
    'wizkid',
    'latin',
    'reggaeton',
    'asake',
    'davido',
    'shaker',
  ];
  if (afroKeywords.some((w) => title.includes(w)) || (bpmAnalysis.bpm >= 98 && bpmAnalysis.bpm <= 118)) {
    return {
      shouldPlay: true,
      patternId: 'afrobeat',
      targetBpm: bpmAnalysis.bpm,
      reason: `Afrobeat/Amapiano groove detected — auto-engaging syncopated shakers & congas at ${bpmAnalysis.bpm} BPM.`,
      confidence: 0.88,
    };
  }

  // Default: If beat confidence is high, choose the best tempo-matching groove
  const defaultPattern = bpmAnalysis.bpm > 125 ? 'punjabi_dhol' : 'bhangra_groove';
  return {
    shouldPlay: true,
    patternId: defaultPattern,
    targetBpm: bpmAnalysis.bpm,
    reason: `Rhythm detected with ${Math.round(bpmAnalysis.confidence * 100)}% beat confidence — adding ${defaultPattern} at ${bpmAnalysis.bpm} BPM.`,
    confidence: bpmAnalysis.confidence,
  };
}
