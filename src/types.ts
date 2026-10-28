export type DeckId = 'A' | 'B';

export interface TrackMetadata {
  id: string;
  title: string;
  artist: string;
  duration: number;
  bpm: number;
  bpmConfidence?: number;
  key?: string;
  audioBuffer?: AudioBuffer;
  waveformPeaks?: number[];
  sourceType: 'local' | 'demo' | 'download';
  url?: string;
  thumbnail?: string;
  highlightTime?: number;          // Timestamp (seconds) of the world's most replayed / liked part
  cueInTime?: number;              // Phrase-aligned start point (e.g. 16 beats before the hook)
  highlightSource?: 'youtube_heatmap' | 'energy_peak' | 'musical_structure' | 'manual';
  highlightIntensity?: number;     // 0.0 - 1.0 engagement / energy score
  firstDownbeatTime?: number;      // Exact downbeat grid phase offset in seconds
}

export interface DeckState {
  deckId: DeckId;
  track: TrackMetadata | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;        // 0.0 - 1.0
  playbackRate: number;  // 0.85 - 1.15 (1.0 = normal)
  effectiveBpm: number;
  lowGain: number;       // dB: -40 to +6
  midGain: number;       // dB: -40 to +6
  highGain: number;      // dB: -40 to +6
  isCue: boolean;
}

export type PercussionCategory = 'punjabi_dhol' | 'bhangra' | 'electronic' | 'afrobeat';

export interface PercussionPattern {
  id: string;
  name: string;
  category: PercussionCategory;
  defaultBpm: number;
  description: string;
  bars: number;
}

export interface PercussionState {
  isPlaying: boolean;
  activePatternId: string;
  volume: number;       // 0.0 - 1.0
  intensity: number;    // 0.5 - 1.5
  currentBpm: number;
  syncToDeck: DeckId | 'manual';
  isMuted: boolean;
}

export interface TransitionConfig {
  sourceDeck: DeckId;
  targetDeck: DeckId;
  durationSeconds: number;
  style: 'smooth_crossfade' | 'bass_swap' | 'drop_cut' | 'tempo_ramp';
  syncPercussion: boolean;
}

export interface QueuedTrack {
  id: string;
  title: string;
  artist: string;
  duration: number;
  url: string;
  thumbnail?: string;
  status: 'queued' | 'downloading' | 'decoding' | 'ready' | 'failed';
  audioBuffer?: AudioBuffer;
  isAiRecommended?: boolean;
  highlightTime?: number;
  cueInTime?: number;
  bpm?: number;
  bpmConfidence?: number;
  firstDownbeatTime?: number;
}

export interface HostSyncState {
  type: 'SYNC_STATE';
  activeDeck: DeckId;
  currentTrack: TrackMetadata | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  bpm: number;
  crossfader: number;
  percussion: PercussionState;
  queue: QueuedTrack[];
  isTransitioning: boolean;
  transitionProgress: number;
  percussionDecisionReason: string;
  autoCurationEnabled: boolean;
  autoPercussionEnabled: boolean;
  autoCueViralHook: boolean;
  mostPlayedSongs?: SongHistoryItem[];
}

export interface SongHistoryItem {
  id: string;
  title: string;
  artist: string;
  playCount: number;
  lastPlayed: number; // timestamp
  url?: string;
  thumbnail?: string;
  duration?: number;
  highlightTime?: number;
}

export type MobileAction =
  | { type: 'CMD_PLAY' }
  | { type: 'CMD_PAUSE' }
  | { type: 'CMD_STOP' }
  | { type: 'CMD_SEEK'; deltaSeconds: number }
  | { type: 'CMD_SEEK_TO'; targetSeconds: number }
  | { type: 'CMD_PREV' }
  | { type: 'CMD_NEXT' }
  | { type: 'CMD_PERCUSSION_TOGGLE' }
  | { type: 'CMD_PERCUSSION_PATTERN'; patternId: string }
  | { type: 'CMD_PERCUSSION_VOLUME'; volume: number }
  | { type: 'CMD_PERCUSSION_MUTE' }
  | { type: 'CMD_ADD_QUEUE'; query: string }
  | { type: 'CMD_MIX_NOW'; query: string }
  | { type: 'CMD_TOGGLE_AUTOCURATION' }
  | { type: 'CMD_AUTO_PERCUSSION' }
  | { type: 'CMD_JUMP_TO_HOOK'; deckId?: DeckId }
  | { type: 'CMD_TOGGLE_AUTO_CUE_HOOK' }
  | { type: 'CMD_LOAD_MY_SONGS' }
  | { type: 'CMD_PLAY_STARTER_SONG'; songId: string };
