import type { EnergyProfile } from './audio/MixPointPlanner';
import type { EqBandId, EqGains, MoodId } from './audio/Moods';
import type { IntroAnalysisResult } from './audio/IntroSkitDetector';
import type { RhythmState, RhythmCommand } from './audio/rhythm/RhythmEnhancer';

export type DeckId = 'A' | 'B';

export interface TrackMetadata {
  id: string;
  title: string;
  artist: string;
  duration: number;
  bpm: number;
  bpmConfidence?: number;
  key?: string;                    // Camelot key, e.g. "8A" (see KeyDetector)
  keyConfidence?: number;          // 0-1; the key is only used from MIN_KEY_CONFIDENCE up
  loudnessDb?: number;             // RMS level of the loud parts (see Loudness.ts)
  audioBuffer?: AudioBuffer;
  waveformPeaks?: number[];
  sourceType: 'local' | 'demo' | 'download';
  url?: string;
  thumbnail?: string;
  highlightTime?: number;          // Timestamp (seconds) of the world's most replayed / liked part
  cueInTime?: number;              // Phrase-aligned start point (e.g. 16 beats before the hook)
  highlightSource?: 'youtube_heatmap' | 'energy_peak' | 'musical_structure' | 'manual';
  highlightIntensity?: number;     // 0.0 - 1.0 engagement / energy score
  firstDownbeatTime?: number;      // Estimated bar downbeat ("1") within the first bar, in seconds
  musicStartTime?: number;         // Timestamp (seconds) where music/beat begins, skipping initial conversation/skits
  introSkipReason?: string;        // Explanation of initial conversation skip (Ollama AI / Audio MIR)
  musicEndTime?: number;           // Where the music ends, before a closing scene / dialogue / fade / silence (OutroDetector)
  outroReason?: string;            // Why (shown in the mix status)
  energyProfile?: EnergyProfile;   // Loudness / vocal-band envelopes used to plan mix points
  // Key-locked tempo: the song as downloaded, and the tempo multiple its current audio is stretched to
  originalBuffer?: AudioBuffer;
  original?: OriginalTiming;
  tempoRatio?: number;
}

/** A song's natural timing, kept so key-locked tempo changes can always start from the original audio. */
export interface OriginalTiming {
  bpm: number;
  duration: number;
  firstDownbeatTime?: number;
  highlightTime?: number;
  cueInTime?: number;
  musicStartTime?: number;
  musicEndTime?: number;
}

/** On-air tempo for the Tempo control. */
export interface TempoInfo {
  naturalBpm: number;
  currentBpm: number;
  ratio: number; // current / natural
  keyLock: boolean;
  busy: boolean; // key-locked re-timing in progress
  setLocked: boolean; // whole set kept at this tempo
  playOriginal: boolean; // songs play at their original BPM, overriding the set tempo
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

export interface TransitionConfig {
  sourceDeck: DeckId;
  targetDeck: DeckId;
  durationSeconds?: number; // omitted: engine picks 8 bars when beatmatched, a short cut when not
  style: 'smooth_crossfade' | 'bass_swap' | 'drop_cut' | 'tempo_ramp';
  sourceExitTime?: number; // planned outgoing position to start the blend at (otherwise the next beat)
  targetEntryTime?: number; // planned incoming start position (otherwise hook cue / first beat)
}

/** A mix that has been planned for a good moment but hasn't started yet. */
export interface PendingMixInfo {
  id?: string;
  title: string;
  artist?: string;
  thumbnail?: string;
  startsInSeconds: number;
  entryTime: number;
  reason: string;
  targetKey?: string;
  keyFit?: 'good' | 'ok' | 'clash' | 'unknown';
  harmonicShift?: string;
}

export interface QueuedTrack {
  id: string;
  title: string;
  artist: string;
  duration: number;
  url: string;
  thumbnail?: string;
  status: 'queued' | 'downloading' | 'decoding' | 'tuning' | 'ready' | 'failed';
  audioBuffer?: AudioBuffer;
  isDiskCached?: boolean;
  waveformPeaks?: number[]; // cached overview, computed once (see AudioEngine.queuedItemPeaks)
  key?: string;
  keyConfidence?: number;
  loudnessDb?: number;
  isAiRecommended?: boolean;
  // Where the song came from: automatic sources ('ai', 'playlist') skip songs played in the
  // last hour; a song the user asked for ('request') is allowed but flagged
  source?: 'ai' | 'playlist' | 'request';
  lastPlayedAt?: number; // set when a requested song was played within the last hour
  queuedAt?: number; // when it joined Up Next (new picks expire after 30 min unplayed, see queueRules.ts)
  highlightTime?: number;
  cueInTime?: number;
  bpm?: number;
  bpmConfidence?: number;
  firstDownbeatTime?: number;
  musicStartTime?: number;
  introSkipReason?: string;
  musicEndTime?: number;
  outroReason?: string;
  energyProfile?: EnergyProfile;
  // Key-locked tempo lock (Party mood): the song as downloaded, and the tempo it was stretched to
  originalBuffer?: AudioBuffer;
  original?: OriginalTiming;
  tempoLockedTo?: number;
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
  rhythm: RhythmState;
  queue: QueuedTrack[];
  isTransitioning: boolean;
  transitionProgress: number;
  autoCurationEnabled: boolean;
  bestPartsMode: boolean;
  mostPlayedSongs?: SongHistoryItem[];
  favorites?: FavoriteSong[];
  bannedSongs?: BannedSong[];
  acquisitionStatus: string;
  pendingMix: PendingMixInfo | null;
  recentlyPlayed: PlayLogEntry[]; // newest first
  introAnalysis: IntroAnalysisResult | null; // how the on-air song's intro was analysed (diagnostics)
  mood: MoodId;
  eqGains: EqGains;
  sessionBpm: number | null; // set tempo when a mood locks it (Party)
  aiStatus: 'checking' | 'online' | 'offline';
  lastAiDecision: string;
  tempo: TempoInfo | null;
  masterVolume: number;
  laptopVolume?: number; // 0.0 to 1.0 (Windows laptop master volume)
  laptopMuted?: boolean;
  aiProvider?: 'gemini' | 'ollama' | 'none';
  aiModelName?: string | null;
  isAiThinking?: boolean;
  aiResult?: { explanation: string; source: string; latencyMs: number } | null;
}

/** The big, slowly changing parts of HostSyncState: sent only when they change. */
export type SlowSyncKey = 'currentTrack' | 'queue' | 'mostPlayedSongs' | 'favorites' | 'bannedSongs' | 'recentlyPlayed' | 'introAnalysis';

/** The rest, sent to the phone several times a second; the phone merges it into its last full state. */
export type LiveSyncState = Omit<HostSyncState, 'type' | SlowSyncKey> & { type: 'SYNC_LIVE' };

/** One play of a song, for "Previously played" and the no-repeat-within-an-hour rule. */
export interface PlayLogEntry {
  id: string;
  title: string;
  artist: string;
  url?: string;
  thumbnail?: string;
  playedAt: number; // ms timestamp
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

export interface FavoriteSong {
  id: string;
  title: string;
  artist: string;
  url?: string;
  thumbnail?: string;
  duration?: number;
  bpm?: number;
  highlightTime?: number;
  addedAt: number; // timestamp
}

export interface BannedSong {
  id: string;
  title: string;
  artist: string;
  url?: string;
  thumbnail?: string;
  duration?: number;
  bannedAt: number; // timestamp
}

export interface SearchResult {
  title: string;
  url: string;
  author: string;
  duration: number; // in seconds
  thumbnail: string;
  timestamp: string;
  highlightTime?: number;
  highlightIntensity?: number;
}

export type MobileAction =
  | { type: 'CMD_PLAY' }
  | { type: 'CMD_PAUSE' }
  | { type: 'CMD_STOP' }
  | { type: 'CMD_SEEK'; deltaSeconds: number }
  | { type: 'CMD_SEEK_TO'; targetSeconds: number }
  | { type: 'CMD_PREV' }
  | { type: 'CMD_NEXT' }
  | { type: 'CMD_RHYTHM'; cmd: RhythmCommand }
  | { type: 'CMD_ADD_QUEUE'; query: string }
  | { type: 'CMD_MIX_NOW'; query: string }
  | { type: 'CMD_TOGGLE_AUTOCURATION' }
  | { type: 'CMD_REFRESH_QUEUE' }
  | { type: 'CMD_JUMP_TO_HOOK'; deckId?: DeckId }
  | { type: 'CMD_TOGGLE_BEST_PARTS' }
  | { type: 'CMD_MIX_QUEUED'; itemId: string }
  | { type: 'CMD_REMOVE_QUEUED'; itemId: string }
  | { type: 'CMD_CANCEL_PENDING_MIX' }
  | { type: 'CMD_SET_MOOD'; mood: MoodId }
  | { type: 'CMD_SET_EQ'; band: EqBandId; gainDb: number }
  | { type: 'CMD_RESET_EQ' }
  | { type: 'CMD_SET_TEMPO'; ratio: number }
  | { type: 'CMD_SET_BPM'; bpm: number }
  | { type: 'CMD_SET_MASTER_VOLUME'; volume: number }
  | { type: 'CMD_SET_LAPTOP_VOLUME'; volume: number }
  | { type: 'CMD_MUTE_LAPTOP'; muted?: boolean }
  | { type: 'CMD_TOGGLE_LAPTOP_MUTE' }
  | { type: 'CMD_AI_INSTRUCT'; command: string }
  | { type: 'CMD_TOGGLE_KEY_LOCK' }
  | { type: 'CMD_TOGGLE_SET_TEMPO_LOCK' }
  | { type: 'CMD_TOGGLE_PLAY_ORIGINAL' }
  | { type: 'CMD_LOAD_MY_SONGS' }
  | { type: 'CMD_PLAY_STARTER_SONG'; songId: string }
  | {
      type: 'CMD_TOGGLE_FAVORITE';
      song?: {
        id?: string;
        title?: string;
        artist?: string;
        url?: string;
        thumbnail?: string;
        duration?: number;
        bpm?: number;
        highlightTime?: number;
      };
    }
  | {
      type: 'CMD_TOGGLE_DONT_PLAY_AGAIN';
      song?: {
        id?: string;
        title?: string;
        artist?: string;
        url?: string;
        thumbnail?: string;
        duration?: number;
      };
    }
  | { type: 'CMD_SORT_QUEUE_HARMONICALLY' }
  | { type: 'CMD_MOVE_QUEUED'; itemId: string; direction: 'up' | 'down' | 'top' };
