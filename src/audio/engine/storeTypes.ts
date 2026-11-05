import type { DeckId, PendingMixInfo, QueuedTrack, TrackMetadata } from '../../types';
import type { MoodId, EqGains } from '../Moods';

export interface DeckStatusBadge {
  label: string;
  className: string;
  dotClassName: string;
}

export interface EngineSystemState {
  aiStatus: 'offline' | 'online' | 'checking';
  lastAiDecision: string | null;
  aiBackends: {
    ollama: { online: boolean; model: string | null };
    gemini: { configured: boolean; online: boolean; model: string | null; error: string | null };
  } | null;
  hasAiInstructions: boolean;
  aiInstructionsText: string;
  mixNotice: { text: string; at: number } | null;
}

export interface EnginePlaybackState {
  activeDeckId: DeckId;
  currentTrack: TrackMetadata | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  remaining: number;
  progress: number;
  playbackRate: number;
  loop: { start: number; end: number } | null;
  loopInTime: number | null;
  hasLastLoop: boolean;
  isBuffering: boolean;
  isStreaming: boolean;
  isTransitioning: boolean;
  transitionProgress: number;
  pendingMix: PendingMixInfo | null;
  mixLoadingId: string | null;
  cueRatio: number | null;
  hookRatios: number[];
  hookTimes: number[];
  originalBpm: number | undefined;
  effectiveBpm: number | undefined;
  peaks: number[] | null;
  deckStatus: DeckStatusBadge;
}

export interface EngineTrackState {
  activeDeckId: DeckId;
  currentTrack: TrackMetadata | null;
  playbackRate: number;
  pendingMix: PendingMixInfo | null;
  mixLoadingId: string | null;
}

export interface EngineQueueState {
  queue: QueuedTrack[];
  contentSig: string;
  queueLength: number;
  readyCount: number;
  diskCacheCount: number;
  queueDurationStr: string;
  mixLoadingId: string | null;
  pendingMix: PendingMixInfo | null;
}

export interface EngineMoodState {
  mood: MoodId;
  eqGains: EqGains;
  masterVolume: number;
  offlineOnly: boolean;
  autoCurationEnabled: boolean;
  bestPartsMode: boolean;
  keyLock: boolean;
}

export interface EngineBangersState {
  favorites: any[];
  mostPlayed: any[];
  banned: any[];
}

export function isPendingMixEqual(a: PendingMixInfo | null, b: PendingMixInfo | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    Math.ceil(a.startsInSeconds) === Math.ceil(b.startsInSeconds) &&
    a.harmonicShift === b.harmonicShift &&
    a.keyFit === b.keyFit
  );
}
