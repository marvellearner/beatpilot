import type { AudioEngine } from '../AudioEngine';
import type { QueuedTrack, TrackMetadata } from '../../types';
import type {
  EngineQueueState,
  EngineTrackState,
  EngineSystemState,
  EngineMoodState,
  EngineBangersState,
  EnginePlaybackState,
  DeckStatusBadge,
} from './storeTypes';
import { isPendingMixEqual } from './storeTypes';

export function computeQueueSnapshot(engine: AudioEngine, prev: EngineQueueState | null): EngineQueueState {
  const queue = engine.queue;
  const queueLength = queue.length;
  const diskCacheCount = engine.diskCacheCount;
  const mixLoadingId = engine.mixLoadingId;
  const pendingMix = engine.getPendingMixInfo();
  const contentSig = queue
    .map((q) => `${q.id}:${q.status}:${q.bpm ?? ''}:${q.key ?? ''}:${q.isDiskCached ? 1 : 0}:${q.duration ?? ''}`)
    .join(',');

  if (
    prev &&
    prev.queue === queue &&
    prev.contentSig === contentSig &&
    prev.diskCacheCount === diskCacheCount &&
    prev.mixLoadingId === mixLoadingId &&
    isPendingMixEqual(prev.pendingMix, pendingMix)
  ) {
    return prev;
  }

  const readyCount = queue.filter((q) => q.status === 'ready').length;
  const totalSec = queue.reduce((acc, q) => acc + (q.duration || 210), 0);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.round((totalSec % 3600) / 60);
  const queueDurationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  return {
    queue,
    contentSig,
    queueLength,
    readyCount,
    diskCacheCount,
    queueDurationStr,
    mixLoadingId,
    pendingMix: prev && isPendingMixEqual(prev.pendingMix, pendingMix) ? prev.pendingMix : pendingMix,
  };
}

export function computeTrackSnapshot(engine: AudioEngine, prev: EngineTrackState | null): EngineTrackState {
  const deck = engine.activeDeck === 'A' ? engine.deckA : engine.deckB;
  const state = deck.getPlaybackState();
  const playbackRate = Math.round(state.playbackRate * 200) / 200;
  const pendingMix = engine.getPendingMixInfo();

  if (
    prev &&
    prev.activeDeckId === engine.activeDeck &&
    prev.currentTrack === state.track &&
    prev.playbackRate === playbackRate &&
    prev.mixLoadingId === engine.mixLoadingId &&
    isPendingMixEqual(prev.pendingMix, pendingMix)
  ) {
    return prev;
  }

  return {
    activeDeckId: engine.activeDeck,
    currentTrack: state.track,
    playbackRate,
    pendingMix,
    mixLoadingId: engine.mixLoadingId,
  };
}

export function computeSystemSnapshot(engine: AudioEngine, prev: EngineSystemState | null): EngineSystemState {
  const currentInstructions = engine.hasAiInstructions ? engine.describeAiInstructions().join(' · ') : '';

  if (
    prev &&
    prev.aiStatus === engine.aiStatus &&
    prev.lastAiDecision === engine.lastAiDecision &&
    prev.aiBackends === engine.aiBackends &&
    prev.hasAiInstructions === engine.hasAiInstructions &&
    prev.aiInstructionsText === currentInstructions &&
    prev.mixNotice === engine.mixNotice
  ) {
    return prev;
  }

  return {
    aiStatus: engine.aiStatus,
    lastAiDecision: engine.lastAiDecision,
    aiBackends: engine.aiBackends,
    hasAiInstructions: engine.hasAiInstructions,
    aiInstructionsText: currentInstructions,
    mixNotice: engine.mixNotice,
  };
}

export function computeMoodSnapshot(engine: AudioEngine, prev: EngineMoodState | null): EngineMoodState {
  if (
    prev &&
    prev.mood === engine.mood &&
    prev.eqGains === engine.eqGains &&
    prev.masterVolume === engine.masterVolume &&
    prev.offlineOnly === engine.offlineOnly &&
    prev.autoCurationEnabled === engine.autoCurationEnabled &&
    prev.bestPartsMode === engine.bestPartsMode &&
    prev.keyLock === engine.keyLock
  ) {
    return prev;
  }

  return {
    mood: engine.mood,
    eqGains: engine.eqGains,
    masterVolume: engine.masterVolume,
    offlineOnly: engine.offlineOnly,
    autoCurationEnabled: engine.autoCurationEnabled,
    bestPartsMode: engine.bestPartsMode,
    keyLock: engine.keyLock,
  };
}

export function computeBangersSnapshot(engine: AudioEngine, prev: EngineBangersState | null): EngineBangersState {
  const favorites = engine.favorites;
  const mostPlayed = engine.mostPlayedSongs;
  const banned = engine.bannedSongs;

  if (
    prev &&
    prev.favorites === favorites &&
    prev.mostPlayed === mostPlayed &&
    prev.banned === banned
  ) {
    return prev;
  }

  return {
    favorites,
    mostPlayed,
    banned,
  };
}

export function computeDeckStatus(
  isPlaying: boolean,
  isBuffering: boolean,
  isStreaming: boolean,
  isTransitioning: boolean,
  pendingMix: any,
  mixLoadingItem: QueuedTrack | null | undefined,
  currentTrack: TrackMetadata | null
): DeckStatusBadge {
  if (isTransitioning) {
    return { label: 'MIXING', className: 'text-cyan-200 bg-cyan-500/10 border-cyan-500/30', dotClassName: 'bg-cyan-400 animate-pulse' };
  }
  if (pendingMix) {
    return {
      label: `MIX IN ${Math.ceil(pendingMix.startsInSeconds)}s`,
      className: 'text-cyan-200 bg-cyan-500/10 border-cyan-500/30',
      dotClassName: 'bg-cyan-400',
    };
  }
  if (mixLoadingItem) {
    return {
      label: 'LOADING NEXT MIX…',
      className: 'text-amber-200 bg-amber-500/10 border-amber-500/30',
      dotClassName: 'bg-amber-400 animate-pulse',
    };
  }
  if (isPlaying && isBuffering) {
    return { label: 'BUFFERING…', className: 'text-amber-200 bg-amber-500/10 border-amber-500/30', dotClassName: 'bg-amber-400 animate-pulse' };
  }
  if (isPlaying && isStreaming) {
    return { label: 'ON AIR · STREAMING', className: 'text-rose-200 bg-rose-500/10 border-rose-500/30', dotClassName: 'bg-rose-500 animate-pulse' };
  }
  if (isPlaying) {
    return { label: 'ON AIR', className: 'text-rose-200 bg-rose-500/10 border-rose-500/30', dotClassName: 'bg-rose-500 animate-pulse' };
  }
  if (currentTrack) {
    return { label: 'PAUSED', className: 'text-amber-200 bg-amber-500/10 border-amber-500/30', dotClassName: 'bg-amber-400' };
  }
  return { label: 'IDLE', className: 'text-slate-400 bg-white/5 border-white/10', dotClassName: 'bg-slate-500' };
}

export function computePlaybackSnapshot(engine: AudioEngine, prev: EnginePlaybackState | null): EnginePlaybackState {
  const activeDeck = engine.activeDeck === 'A' ? engine.deckA : engine.deckB;
  const playbackState = activeDeck.getPlaybackState();
  const currentTrack = playbackState.track;
  const isPlaying = playbackState.isPlaying;
  const currentTime = playbackState.currentTime;
  const duration = playbackState.duration || 0;
  const remaining = Math.max(0, duration - currentTime);
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const pendingMix = engine.getPendingMixInfo();
  const mixLoadingItem = engine.mixLoadingId ? engine.queue.find((q) => q.id === engine.mixLoadingId) : null;
  const isTransitioning = engine.isTransitioning;
  const transitionProgress = engine.transitionProgress;

  const markerRatio = (time?: number) =>
    duration > 0 && time !== undefined && time > 0 && time < duration ? time / duration : null;
  const hookTimes = currentTrack?.hooks?.length
    ? currentTrack.hooks.map((h) => h.time)
    : currentTrack?.highlightTime !== undefined
      ? [currentTrack.highlightTime]
      : [];
  const hookRatios = hookTimes.map(markerRatio).filter((r): r is number => r !== null);
  const cueRatio = markerRatio(currentTrack?.cueInTime);

  if (
    prev &&
    prev.activeDeckId === engine.activeDeck &&
    prev.currentTrack === currentTrack &&
    prev.isPlaying === isPlaying &&
    Math.abs(prev.currentTime - currentTime) < 0.05 &&
    prev.duration === duration &&
    prev.playbackRate === playbackState.playbackRate &&
    prev.loop === playbackState.loop &&
    prev.loopInTime === playbackState.loopInTime &&
    prev.hasLastLoop === playbackState.hasLastLoop &&
    prev.isBuffering === playbackState.isBuffering &&
    prev.isStreaming === playbackState.isStreaming &&
    prev.isTransitioning === isTransitioning &&
    Math.abs(prev.transitionProgress - transitionProgress) < 0.01 &&
    isPendingMixEqual(prev.pendingMix, pendingMix) &&
    prev.mixLoadingId === engine.mixLoadingId
  ) {
    return prev;
  }

  const deckStatus = computeDeckStatus(
    isPlaying,
    playbackState.isBuffering,
    playbackState.isStreaming,
    isTransitioning,
    pendingMix,
    mixLoadingItem,
    currentTrack
  );

  return {
    activeDeckId: engine.activeDeck,
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    remaining,
    progress,
    playbackRate: playbackState.playbackRate,
    loop: playbackState.loop,
    loopInTime: playbackState.loopInTime,
    hasLastLoop: playbackState.hasLastLoop,
    isBuffering: playbackState.isBuffering,
    isStreaming: playbackState.isStreaming,
    isTransitioning,
    transitionProgress,
    pendingMix,
    mixLoadingId: engine.mixLoadingId,
    cueRatio,
    hookRatios,
    hookTimes,
    originalBpm: currentTrack ? currentTrack.original?.bpm ?? currentTrack.bpm : undefined,
    effectiveBpm: playbackState.effectiveBpm,
    peaks: currentTrack?.waveformPeaks?.length ? currentTrack.waveformPeaks : null,
    deckStatus,
  };
}

