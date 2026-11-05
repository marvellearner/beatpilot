import { useSyncExternalStore, useRef, useCallback } from 'react';
import type { AudioEngine } from '../../audio/AudioEngine';
export type {
  DeckStatusBadge,
  EngineSystemState,
  EnginePlaybackState,
  EngineTrackState,
  EngineQueueState,
  EngineMoodState,
  EngineBangersState,
} from '../../audio/engine/storeTypes';
export { isPendingMixEqual } from '../../audio/engine/storeTypes';
import type {
  EngineSystemState,
  EnginePlaybackState,
  EngineTrackState,
  EngineQueueState,
  EngineMoodState,
  EngineBangersState,
} from '../../audio/engine/storeTypes';

// ==========================================
// 1. System & AI Store Slice
// ==========================================

export function useEngineSystem(engine: AudioEngine): EngineSystemState {
  const getSnapshot = useCallback((): EngineSystemState => {
    return engine.getSystemSnapshot();
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

export function useEnginePlayback(engine: AudioEngine): EnginePlaybackState {
  const cacheRef = useRef<EnginePlaybackState | null>(null);
  if (!cacheRef.current) {
    cacheRef.current = engine.getPlaybackSnapshot();
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
        const next = engine.getPlaybackSnapshot();
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

// ==========================================
// 3. Track Store Slice (On-Air without clock)
// ==========================================

export function useEngineTrack(engine: AudioEngine): EngineTrackState {
  const getSnapshot = useCallback((): EngineTrackState => {
    return engine.getTrackSnapshot();
  }, [engine]);

  return useSyncExternalStore(
    (onStoreChange) => engine.subscribe(onStoreChange),
    getSnapshot,
    getSnapshot
  );
}

// ==========================================
// 4. Pro Decks / Mixer Direct Refresh Slice
// ==========================================

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
// 5. Queue Store Slice
// ==========================================

export function useEngineQueue(engine: AudioEngine): EngineQueueState {
  const getSnapshot = useCallback((): EngineQueueState => {
    return engine.getQueueSnapshot();
  }, [engine]);

  return useSyncExternalStore(
    (onStoreChange) => engine.subscribe(onStoreChange),
    getSnapshot,
    getSnapshot
  );
}

// ==========================================
// 6. Mood & Mixer Store Slice
// ==========================================

export function useEngineMood(engine: AudioEngine): EngineMoodState {
  const getSnapshot = useCallback((): EngineMoodState => {
    return engine.getMoodSnapshot();
  }, [engine]);

  return useSyncExternalStore(
    (onStoreChange) => engine.subscribe(onStoreChange),
    getSnapshot,
    getSnapshot
  );
}

// ==========================================
// 7. Bangers, Favorites & Banned Songs Slice
// ==========================================

export function useEngineBangers(engine: AudioEngine): EngineBangersState {
  const getSnapshot = useCallback((): EngineBangersState => {
    return engine.getBangersSnapshot();
  }, [engine]);

  return useSyncExternalStore(
    (onStoreChange) => engine.subscribe(onStoreChange),
    getSnapshot,
    getSnapshot
  );
}
