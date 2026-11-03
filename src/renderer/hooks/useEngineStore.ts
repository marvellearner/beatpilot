import { useSyncExternalStore, useRef, useCallback } from 'react';
import type { AudioEngine } from '../../audio/AudioEngine';
import type { DeckId, PendingMixInfo, QueuedTrack, TrackMetadata } from '../../types';
import type { MoodId, EqGains } from '../../audio/Moods';

// ==========================================
// 1. System & AI Store Slice
// ==========================================

export interface EngineSystemState {
  aiStatus: 'offline' | 'online' | 'checking';
  lastAiDecision: string | null;
  aiBackends: AudioEngine['aiBackends'];
  hasAiInstructions: boolean;
  aiInstructionsText: string;
  mixNotice: { text: string; at: number } | null;
}

export function useEngineSystem(engine: AudioEngine): EngineSystemState {
  const cacheRef = useRef<EngineSystemState>({
    aiStatus: engine.aiStatus,
    lastAiDecision: engine.lastAiDecision,
    aiBackends: engine.aiBackends,
    hasAiInstructions: engine.hasAiInstructions,
    aiInstructionsText: engine.hasAiInstructions ? engine.describeAiInstructions().join(' · ') : '',
    mixNotice: engine.mixNotice,
  });

  const getSnapshot = useCallback((): EngineSystemState => {
    const prev = cacheRef.current;
    const currentInstructions = engine.hasAiInstructions ? engine.describeAiInstructions().join(' · ') : '';
    if (
      prev.aiStatus === engine.aiStatus &&
      prev.lastAiDecision === engine.lastAiDecision &&
      prev.aiBackends === engine.aiBackends &&
      prev.hasAiInstructions === engine.hasAiInstructions &&
      prev.aiInstructionsText === currentInstructions &&
      prev.mixNotice === engine.mixNotice
    ) {
      return prev;
    }

    const next: EngineSystemState = {
      aiStatus: engine.aiStatus,
      lastAiDecision: engine.lastAiDecision,
      aiBackends: engine.aiBackends,
      hasAiInstructions: engine.hasAiInstructions,
      aiInstructionsText: currentInstructions,
      mixNotice: engine.mixNotice,
    };
    cacheRef.current = next;
    return next;
  }, [engine]);

  return useSyncExternalStore(
    (onStoreChange) => engine.subscribe(onStoreChange),
    getSnapshot,
    getSnapshot
  );
}

// ==========================================
// 2. Playback & Scrubber Store Slice
// ==========================================

export interface DeckStatusBadge {
  label: string;
  className: string;
  dotClassName: string;
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

function computeDeckStatus(
  isPlaying: boolean,
  isBuffering: boolean,
  isStreaming: boolean,
  isTransitioning: boolean,
  pendingMix: PendingMixInfo | null,
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

function computePlaybackSnapshot(engine: AudioEngine, prev: EnginePlaybackState | null): EnginePlaybackState {
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

export function useEnginePlayback(engine: AudioEngine): EnginePlaybackState {
  const cacheRef = useRef<EnginePlaybackState | null>(null);
  if (!cacheRef.current) {
    cacheRef.current = computePlaybackSnapshot(engine, null);
  }

  // Pure, idempotent snapshot reader: returns identical cached object reference across
  // all React StrictMode / concurrent render passes until an explicit store notification occurs.
  const getSnapshot = useCallback((): EnginePlaybackState => {
    return cacheRef.current!;
  }, []);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      let tickerId: number | null = null;

      const refreshAndNotify = () => {
        const next = computePlaybackSnapshot(engine, cacheRef.current);
        if (next !== cacheRef.current) {
          cacheRef.current = next;
          onStoreChange();
        }
      };

      const updateTicker = () => {
        const playing = engine.isAnyDeckPlaying();
        if (playing && tickerId === null) {
          tickerId = window.setInterval(refreshAndNotify, 180);
        } else if (!playing && tickerId !== null) {
          window.clearInterval(tickerId);
          tickerId = null;
        }
      };

      const unsubscribe = engine.subscribe(() => {
        updateTicker();
        refreshAndNotify();
      });

      updateTicker();

      return () => {
        unsubscribe();
        if (tickerId !== null) {
          window.clearInterval(tickerId);
          tickerId = null;
        }
      };
    },
    [engine]
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export interface EngineTrackState {
  activeDeckId: DeckId;
  currentTrack: TrackMetadata | null;
  playbackRate: number; // rounded: only for the key the song is heard in
  pendingMix: PendingMixInfo | null;
  mixLoadingId: string | null;
}

/**
 * What's on air, without the clock: for parts that only need the song, the lined-up mix and the
 * song loading (the page layout, Up Next). useEnginePlayback changes every 180 ms while a song
 * plays, which redrew the whole console and all 50 Up Next rows several times a second.
 */
export function useEngineTrack(engine: AudioEngine): EngineTrackState {
  const cacheRef = useRef<EngineTrackState | null>(null);
  const getSnapshot = useCallback((): EngineTrackState => {
    const deck = engine.activeDeck === 'A' ? engine.deckA : engine.deckB;
    const state = deck.getPlaybackState();
    const playbackRate = Math.round(state.playbackRate * 200) / 200;
    const pendingMix = engine.getPendingMixInfo();
    const prev = cacheRef.current;
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
    const next: EngineTrackState = {
      activeDeckId: engine.activeDeck,
      currentTrack: state.track,
      playbackRate,
      pendingMix,
      mixLoadingId: engine.mixLoadingId,
    };
    cacheRef.current = next;
    return next;
  }, [engine]);
  return useSyncExternalStore((onStoreChange) => engine.subscribe(onStoreChange), getSnapshot, getSnapshot);
}

/**
 * For components that read the engine directly (Pro decks, mixer): redraws them on engine changes,
 * at most every `everyMs`, and keeps ticking while a song plays so clocks and meters move.
 * Returns a counter that changes on each redraw.
 */
export function useEngineRefresh(engine: AudioEngine, everyMs = 200): number {
  const versionRef = useRef(0);
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      let last = 0;
      let timer: number | undefined;
      const bump = () => {
        versionRef.current++;
        last = performance.now();
        onStoreChange();
      };
      const throttled = () => {
        if (timer !== undefined) return;
        const wait = everyMs - (performance.now() - last);
        if (wait <= 0) bump();
        else
          timer = window.setTimeout(() => {
            timer = undefined;
            bump();
          }, wait);
      };
      const unsubscribe = engine.subscribe(throttled);
      const ticker = window.setInterval(() => {
        if (engine.isAnyDeckPlaying()) throttled();
      }, everyMs);
      return () => {
        unsubscribe();
        window.clearInterval(ticker);
        window.clearTimeout(timer);
      };
    },
    [engine, everyMs]
  );
  const getSnapshot = useCallback(() => versionRef.current, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ==========================================
// 3. Queue Store Slice
// ==========================================

export interface EngineQueueState {
  queue: QueuedTrack[];
  contentSig: string; // what the songs show, so in-place changes redraw the list
  queueLength: number;
  readyCount: number;
  diskCacheCount: number;
  queueDurationStr: string;
  mixLoadingId: string | null;
  pendingMix: PendingMixInfo | null;
}

export function useEngineQueue(engine: AudioEngine): EngineQueueState {
  const cacheRef = useRef<EngineQueueState | null>(null);

  const getSnapshot = useCallback((): EngineQueueState => {
    const queue = engine.queue;
    const queueLength = queue.length;
    const diskCacheCount = engine.diskCacheCount;
    const mixLoadingId = engine.mixLoadingId;
    const pendingMix = engine.getPendingMixInfo();
    // The engine updates songs in place (downloading → ready, BPM, key found), keeping the same
    // array, so the list's content is compared too or Up Next keeps showing old statuses
    const contentSig = queue
      .map((q) => `${q.id}:${q.status}:${q.bpm ?? ''}:${q.key ?? ''}:${q.isDiskCached ? 1 : 0}:${q.duration ?? ''}`)
      .join(',');

    const prev = cacheRef.current;
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

    const next: EngineQueueState = {
      queue,
      contentSig,
      queueLength,
      readyCount,
      diskCacheCount,
      queueDurationStr,
      mixLoadingId,
      // Keep the previous object when nothing about the lined-up mix changed (there is no previous
      // snapshot on the first draw)
      pendingMix: prev && isPendingMixEqual(prev.pendingMix, pendingMix) ? prev.pendingMix : pendingMix,
    };
    cacheRef.current = next;
    return next;
  }, [engine]);

  return useSyncExternalStore(
    (onStoreChange) => engine.subscribe(onStoreChange),
    getSnapshot,
    getSnapshot
  );
}

// ==========================================
// 4. Mood & Mixer Store Slice
// ==========================================

export interface EngineMoodState {
  mood: MoodId;
  eqGains: EqGains;
  masterVolume: number;
  offlineOnly: boolean;
  autoCurationEnabled: boolean;
  bestPartsMode: boolean;
  keyLock: boolean;
}

export function useEngineMood(engine: AudioEngine): EngineMoodState {
  const cacheRef = useRef<EngineMoodState>({
    mood: engine.mood,
    eqGains: engine.eqGains,
    masterVolume: engine.masterVolume,
    offlineOnly: engine.offlineOnly,
    autoCurationEnabled: engine.autoCurationEnabled,
    bestPartsMode: engine.bestPartsMode,
    keyLock: engine.keyLock,
  });

  const getSnapshot = useCallback((): EngineMoodState => {
    const prev = cacheRef.current;
    if (
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

    const next: EngineMoodState = {
      mood: engine.mood,
      eqGains: engine.eqGains,
      masterVolume: engine.masterVolume,
      offlineOnly: engine.offlineOnly,
      autoCurationEnabled: engine.autoCurationEnabled,
      bestPartsMode: engine.bestPartsMode,
      keyLock: engine.keyLock,
    };
    cacheRef.current = next;
    return next;
  }, [engine]);

  return useSyncExternalStore(
    (onStoreChange) => engine.subscribe(onStoreChange),
    getSnapshot,
    getSnapshot
  );
}

// ==========================================
// 5. Bangers, Favorites & Banned Songs Slice
// ==========================================

export interface EngineBangersState {
  favorites: AudioEngine['favorites'];
  mostPlayed: AudioEngine['mostPlayedSongs'];
  banned: AudioEngine['bannedSongs'];
}

export function useEngineBangers(engine: AudioEngine): EngineBangersState {
  const cacheRef = useRef<EngineBangersState>({
    favorites: engine.favorites,
    mostPlayed: engine.mostPlayedSongs,
    banned: engine.bannedSongs,
  });
  const versionRef = useRef(engine.storeVersion);

  const getSnapshot = useCallback((): EngineBangersState => {
    const prev = cacheRef.current;
    if (
      versionRef.current === engine.storeVersion &&
      prev.favorites === engine.favorites &&
      prev.mostPlayed === engine.mostPlayedSongs &&
      prev.banned === engine.bannedSongs
    ) {
      return prev;
    }

    versionRef.current = engine.storeVersion;
    const next: EngineBangersState = {
      favorites: engine.favorites,
      mostPlayed: engine.mostPlayedSongs,
      banned: engine.bannedSongs,
    };
    cacheRef.current = next;
    return next;
  }, [engine]);

  return useSyncExternalStore(
    (onStoreChange) => engine.subscribe(onStoreChange),
    getSnapshot,
    getSnapshot
  );
}
