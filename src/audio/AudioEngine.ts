import { VirtualDeck } from './VirtualDeck';
import { RhythmEnhancer, type SongClock, type RhythmCommand } from './rhythm/RhythmEnhancer';
import { SongLibrary } from './engine/SongLibrary';
import { buildLiveSyncState, buildSyncState, syncSignature } from './engine/syncState';
import { SongRhythmPlans } from './engine/SongRhythmPlans';
import {
  DeckId,
  TransitionConfig,
  QueuedTrack,
  HostSyncState,
  LiveSyncState,
  PendingMixInfo,
  TrackMetadata,
  SongHistoryItem,
  FavoriteSong,
  BannedSong,
  TempoInfo,
  PlayLogEntry,
} from '../types';
import { detectBpmFromBuffer } from './BpmDetector';
import {
  detectKey,
  keyCompatibility,
  shiftKey,
  getHarmonicCompatibility,
} from './KeyDetector';
import { measureLoudnessDb, loudnessGainDb } from './Loudness';
import { DeckCues } from './engine/DeckCues';
import { HighlightDetector } from './HighlightDetector';
import { computeEnergyProfile, planMix, MixPlan, MixSongInfo } from './MixPointPlanner';
import { EQ_BANDS, EQ_MAX_DB, EQ_MIN_DB, EqBandId, EqGains, MoodId, getMood } from './Moods';
import { stretchAudioBuffer } from './stretchInWorker';
import { songKeys, isSameSong, cleanCoreTitle, isStrictStartSong, is8dOrMashupSong, type SongRef } from './songMatch';
import {
  KEEP_AT_TOP,
  MAX_QUEUE_TARGET,
  activeCount,
  dedupeQueue,
  isChosen,
  isNewPick,
  isQueueFull,
  mixFamiliarAndNew,
  sameSongAs,
  staleSongs,
  type SongLike,
} from './engine/queueRules';
import { DJAgent } from '../ai/DJAgent';
import { artistKey, buildTaste, songArtists, tasteForPrompt, type TasteProfile } from '../../shared/taste';
import { IntroSkitDetector, type IntroAnalysisResult } from './IntroSkitDetector';
import { OutroDetector } from './OutroDetector';

const SOUND_SETTINGS_KEY = 'ai_dj_sound_settings';
const DOUBLE_CLICK_MS = 1500; // a second Mix click on the same song within this is the same click
const CURRENT_TRACK_KEY = 'ai_dj_current_track';
const TOP_SONG_AVOID_KEY = 'ai_dj_top_song_avoid';
// Up Next never auto-adds a song played within the last hour
const NO_REPEAT_WINDOW_MS = 60 * 60 * 1000;
// ...nor one played in the last 3 hours (older plays come back: they're the songs people know)
const REPLAY_GAP_MS = 3 * 60 * 60 * 1000;
// About 70 % of automatically picked songs come from the listener's own songs, the rest are new
const FAMILIAR_SHARE = 0.7;
// A new pick that expired or was refreshed away isn't suggested again for this long
const EXPIRED_MEMORY_MS = 2 * 60 * 60 * 1000;
// Removing this many songs by one artist from Up Next tonight makes them picked less
const REMOVALS_TO_AVOID_ARTIST = 2;
// Decoded songs kept in memory for instant replay (~90 MB each); older ones reload in ~30ms from the disk cache
const MAX_DECODED_IN_MEMORY = 3;

// Tempo changes also shift pitch (no key lock): ~5.95% = 1 semitone, and a sudden jump
// becomes noticeable from ~2-3%. Gradual ramps are much less noticeable than jumps.
// See DJ_KNOWLEDGE_AND_MIXING_RULES.md §21.
const MAX_INCOMING_SHIFT = 0.04; // sudden speed change applied to the incoming song
const MAX_OUTGOING_RAMP = 0.08; // gradual ramp of the outgoing song before an auto-mix
const MIN_BEATMATCH_CONFIDENCE = 0.6;
const UNMATCHED_TRANSITION_SECONDS = 2; // tempos too far apart: short cut on the beat, no long flam
const MANUAL_MIX_LOOKAHEAD_SECONDS = 45; // Mix / Next: find the best blend point within the next 45 s per MIXING_RULES.md
const OUTRO_PLAN_SECONDS = 45; // auto-mix: plan the blend point within the last 45 s
// Ask the AI DJ this much earlier than that: on a CPU model the next-song pick plus the mix
// choice can take ~20 s, which used to eat most of the outro window and come back too late
const AI_PREP_LEAD_SECONDS = 45;

/** An AI DJ mix choice: which exit/entry point to use (song seconds), and blend vs cut. */
interface AiMixChoice {
  exitTime: number;
  entryTime: number;
  style: 'blend' | 'cut';
  bars: number;
  reason: string;
}

/** The AI DJ's answers for the coming end-of-song mix, worked out before the outro window. */
interface AiOutroPrep {
  trackId: string;
  candidateIds: string[]; // ready songs the pick was made from; a changed queue makes it stale
  pick?: { itemId: string; reason: string };
  mix?: AiMixChoice & { itemId: string; key: string };
}
// Below this, the detected key is too unsure to act on (on 40 cached songs, keys from 0.3 up
// were stable between the two halves of every song; below it, about half were not)
const MIN_KEY_CONFIDENCE = 0.3;
const OFFLINE_ONLY_KEY = 'ai_dj_offline_only';
// Best Parts mode (dance floor): each song plays its build-up and hook, then mixes out.
// Rules: MIXING_RULES.md "Best Parts Mode".
const BEST_PARTS_KEY = 'ai_dj_best_parts';
const BEST_PART_HOOK_BARS = 16; // play at least this much from the hook (a full chorus) before leaving
const BEST_PART_EXIT_BARS = 16; // ...then mix out at the best phrase within the next 16 bars
const BEST_PART_BUILD_BARS = 16; // incoming songs enter up to 16 bars before their hook
const BEST_PART_MIN_BUILD_BARS = 4; // ...and never later than 4 bars before it
const BEST_PART_MIN_SONG_SECONDS = 120; // shorter songs play whole
const PLAN_STABLE_SECONDS = 2.5; // stop ramping tempo this close to a planned mix so timing is exact
// Tempo glide speed for both the pre-mix ramp and the return to natural pitch (0.4% per second)
const PITCH_RETURN_PER_SECOND = 0.004;
// BPM adjustment limits for dancing and DJ mixing per MIXING_RULES.md
export const BPM_LIMITS = {
  PREFERRED_PCT: 0.03, // 0–3%: routine DJ mixing, preserves natural groove
  DEFAULT_PCT: 0.05,   // 3–5%: moderate adjustments, dance energy matching
  EXTENDED_PCT: 0.08,  // 5–8%: strong adjustments, energetic feel / close match
  MAX_PERMITTED_PCT: 0.16, // ±16%: absolute hard limit from original BPM
  MIN_RATIO: 0.84,     // 1 - 0.16 = 0.84 (-16% minimum BPM)
  MAX_RATIO: 1.16,     // 1 + 0.16 = 1.16 (+16% maximum BPM)
} as const;

// Tempo control range for the on-air song
const MIN_TEMPO = 0.5;
const MAX_TEMPO = 1.5;
const MIN_QUEUE_TARGET = 45; // Maintain ~50 songs in queue at all times
// RULE: Never add any song longer than 5 minutes (300s) on your own in up next queue.
// If the user explicitly searches and plays then it is fine (source === 'request').
export const MAX_AUTO_QUEUE_SONG_DURATION = 300;

export class AudioEngine {
  public ctx: AudioContext;

  // Decks
  public deckA: VirtualDeck;
  public deckB: VirtualDeck;
  // Live Rhythm Enhancer (Deck P): sample-based dhol/percussion locked to the on-air song
  public rhythm: RhythmEnhancer;

  // Master Nodes: decks + drums -> masterBus -> EQ bands -> eqHeadroom -> limiter -> masterGain
  private masterBus: GainNode;
  private eqFilters = new Map<EqBandId, BiquadFilterNode>();
  private eqHeadroom: GainNode;
  public eqGains: EqGains = { ...getMood('normal').eq };
  public mood: MoodId = 'normal';
  private limiter: DynamicsCompressorNode;
  private masterGain: GainNode;
  public masterAnalyser: AnalyserNode;
  public masterAnalyserL: AnalyserNode;
  public masterAnalyserR: AnalyserNode;
  private channelSplitter: ChannelSplitterNode;

  // Crossfader Nodes
  private crossfaderGainA: GainNode;
  private crossfaderGainB: GainNode;
  private crossfaderPosition: number = -1; // Default to Deck A playing

  // Active On-Air Deck
  public activeDeck: DeckId = 'A';

  // Queue & Auto-Curation
  public queue: QueuedTrack[] = [];
  public acquisitionStatus: string = '';
  // What a Mix click did, for a toast (the UI shows it whenever `at` changes)
  public mixNotice: { text: string; at: number } | null = null;
  // A Mix click waiting for its song to load
  public mixLoadingId: string | null = null;
  private lastMixClick: { id: string; at: number } | null = null;
  public autoCurationEnabled: boolean = true;
  // Up Next only from the songs on this laptop (the server also switches by itself when offline)
  public offlineOnly: boolean = (() => {
    try {
      return window.localStorage.getItem(OFFLINE_ONLY_KEY) === '1';
    } catch {
      return false;
    }
  })();
  // Best Parts mode: only the best stretch of each song plays (see bestPartExitWindow). Remembered.
  public bestPartsMode: boolean = (() => {
    try {
      return window.localStorage.getItem(BEST_PARTS_KEY) === '1';
    } catch {
      return false;
    }
  })();
  private isFetchingRecommendations: boolean = false;
  // Songs dropped by expiry, Refresh or a failed load, so the same songs don't come straight back
  private droppedPicks: Array<{ song: SongLike; at: number }> = [];
  public refreshingQueue = false; // Refresh is rebuilding Up Next
  // "Play only / more <artist>" from the AI chat: Up Next follows it until cleared (this session)
  public artistFocus: { artists: string[]; only: boolean } | null = null;
  private stopRefill = false; // set by Refresh: a running fill stops at once
  private refillRequest: AbortController | null = null; // the fill's recommendation request in flight
  // Songs removed from Up Next by hand tonight, per artist (see sessionAvoidArtists)
  private removedArtists = new Map<string, { name: string; count: number }>();
  private lastRefillAttemptAt: number = 0;
  private isPreloadingNext: boolean = false;
  private isPopulatingQueue: boolean = false;
  // Songs already played this session, so auto-curation doesn't repeat them
  private playedUrls = new Set<string>();
  // Recent intro-skip analyses by track id, for diagnosing songs on real audio
  private introAnalyses = new Map<string, IntroAnalysisResult>();
  // Avoidance tracking for the first song in Up Next queue (remove after avoiding 7 times)
  public topSongAvoidKey: string | null = null;
  public topSongAvoidCount: number = 0;
  private lastAvoidanceCheckedTrackId: string | null = null;

  // In-memory audio buffer cache (avoids re-downloading or re-rendering songs)
  private audioBufferCache = new Map<string, { buffer: AudioBuffer; metadata: TrackMetadata }>();

  // Favourites, banned songs, play history and the play log (see engine/SongLibrary.ts)
  public readonly library = new SongLibrary(() => this.notify());

  /** Every play with its time (kept across reloads): "Previously played" + the 1-hour no-repeat rule */
  public get playLog(): PlayLogEntry[] {
    return this.library.playLog;
  }
  public get favorites(): FavoriteSong[] {
    return this.library.favorites;
  }
  public get bannedSongs(): BannedSong[] {
    return this.library.bannedSongs;
  }

  /**
   * Top Bangers (Most Played Songs) — strictly excludes any song that is currently
   * in the Up Next queue, currently on-air, or present in Previously Played history.
   */
  public get mostPlayedSongs(): SongHistoryItem[] {
    return this.getTopBangers();
  }

  public get rawMostPlayedSongsList(): SongHistoryItem[] {
    return this.library.history;
  }
  private lastRecordedTrackId: string | null = null;
  private topBangersCache: { key: string; raw: SongHistoryItem[]; list: SongHistoryItem[] } | null = null;

  // A mix waiting for its planned blend point (the song is out of the queue meanwhile)
  private pendingMix: {
    item: QueuedTrack;
    plan: MixPlan;
    durationSeconds?: number;
    timer: number;
    style?: 'blend' | 'cut'; // set by the AI DJ
    blendBars?: number; // set by the AI DJ (or 4 when the keys clash)
    keyFit?: 'good' | 'ok' | 'clash' | 'unknown';
    harmonicShift?: string;
  } | null = null;

  // AI DJ brain: local Ollama first, Gemini cloud as backup, built-in rules if both fail (see server/apiPlugin.ts)
  public djAgent = new DJAgent();
  public aiStatus: 'checking' | 'online' | 'offline' = 'checking';
  public aiProvider: 'gemini' | 'ollama' | 'none' = 'none';
  public aiModelName: string = '';
  // Each AI backend's availability, for the header lights (refreshed every minute)
  public aiBackends: {
    ollama: { online: boolean; model: string | null };
    gemini: { configured: boolean; online: boolean; model: string | null; error: string | null };
  } | null = null;
  public lastAiDecision: string = '';
  // Disk Cache stats (cache/audio directory on disk)
  public diskCacheCount: number = 0;
  public diskCacheMb: number = 0;
  private choosingNextSong = false;
  private aiOutroPrep: AiOutroPrep | null = null;
  // AI mix and next-song questions in flight; rhythm questions wait for them (they're time-critical)
  private aiMixCalls = 0;
  // Live Rhythm Enhancer decisions per song (see engine/SongRhythmPlans.ts)
  private cues = new DeckCues({
    deck: (id) => (id === 'A' ? this.deckA : this.deckB),
    isOnAir: (deck) => deck === this.onAirDeck(),
    isTransitioning: () => this.isTransitioning,
    onAirJumped: () => {
      this.afterSeek();
      this.saveCurrentTrackToStorage();
    },
    onAirLoopStarted: (bars, title) => {
      this.cancelPendingMix('Loop on: planned mix cancelled. Leave the loop to carry on.');
      this.acquisitionStatus = `Looping ${bars} bar${bars > 1 ? 's' : ''} of "${title}". Press the loop again to carry on.`;
    },
    // The clock jumped back by the loop's repeats: re-lock the drums now rather than wait for the song
    onAirLoopEnded: () => this.rhythm.silence(),
    onChange: () => this.notify(),
  });
  private rhythmPlans = new SongRhythmPlans({
    agent: this.djAgent,
    mood: () => this.mood,
    aiOnline: () => this.aiStatus === 'online',
    aiBusy: () => this.aiMixCalls > 0,
    onChange: () => this.notify(),
  });
  private recentTitles: string[] = [];
  private loopTicks = 0;

  // Party tempo lock: every queued song is key-lock stretched to this tempo
  public sessionBpm: number | null = null;
  private isTuningTempo = false;

  // Tempo control for the on-air song
  public keyLock = true; // tempo changes keep the pitch (re-timed audio) vs vinyl-style
  public tempoBusy = false;
  private tempoJob = 0; // latest request wins when buttons are pressed quickly
  private lastSetTempoAttempt = '';
  public playOriginal = false; // "Original" toggle: songs play at their own BPM

  // Auto-Transition State
  private transitionTimer: number | null = null;
  public isTransitioning: boolean = false;
  public transitionProgress: number = 0; // 0 to 1

  public onEngineUpdate?: () => void;

  constructor() {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AudioContextClass();

    // Limiter to prevent clipping during multi-deck summing
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1.5;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.15;

    // Master Gain
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.9;

    // Master Analyser & Stereo Channel Splitter for Live VU Meters
    this.masterAnalyser = this.ctx.createAnalyser();
    this.masterAnalyser.fftSize = 512;

    this.channelSplitter = this.ctx.createChannelSplitter(2);
    this.masterAnalyserL = this.ctx.createAnalyser();
    this.masterAnalyserR = this.ctx.createAnalyser();
    this.masterAnalyserL.fftSize = 256;
    this.masterAnalyserR.fftSize = 256;

    // Chain: Limiter -> Master Gain -> Master Analyser -> Output
    this.limiter.connect(this.masterGain);
    this.masterGain.connect(this.masterAnalyser);
    this.masterAnalyser.connect(this.channelSplitter);
    this.channelSplitter.connect(this.masterAnalyserL, 0);
    this.channelSplitter.connect(this.masterAnalyserR, 1);
    this.masterAnalyser.connect(this.ctx.destination);

    // Master equalizer on the whole mix (songs + drums), before the limiter
    this.masterBus = this.ctx.createGain();
    this.eqHeadroom = this.ctx.createGain();
    let eqChainEnd: AudioNode = this.masterBus;
    for (const band of EQ_BANDS) {
      const filter = this.ctx.createBiquadFilter();
      filter.type = band.type;
      filter.frequency.value = band.frequency;
      if (band.q) filter.Q.value = band.q;
      filter.gain.value = 0;
      eqChainEnd.connect(filter);
      eqChainEnd = filter;
      this.eqFilters.set(band.id, filter);
    }
    eqChainEnd.connect(this.eqHeadroom);
    this.eqHeadroom.connect(this.limiter);

    // Crossfader Gains for Deck A & Deck B
    this.crossfaderGainA = this.ctx.createGain();
    this.crossfaderGainB = this.ctx.createGain();

    this.crossfaderGainA.connect(this.masterBus);
    this.crossfaderGainB.connect(this.masterBus);

    // Initialize Decks
    // Each deck's echo FX goes straight to the master bus, so it rings on after a crossfader cut
    this.deckA = new VirtualDeck('A', this.ctx, this.crossfaderGainA, this.masterBus);
    this.deckB = new VirtualDeck('B', this.ctx, this.crossfaderGainB, this.masterBus);

    // The rhythm layer joins the master bus directly (independent of the crossfader) and
    // follows whichever song is on air
    this.rhythm = new RhythmEnhancer(this.ctx, this.masterBus, () => this.rhythmClock(), () => this.notify());

    // Set initial crossfader to 100% Deck A
    this.applyCrossfader(-1);

    // Forward deck updates
    this.deckA.onStateUpdate = () => this.handleDeckUpdate('A');
    this.deckB.onStateUpdate = () => this.handleDeckUpdate('B');

    // Restore the last mood and EQ the user chose
    this.loadSoundSettings();

    // Load persisted most played song history
    void this.library.fetchHistory();

    // Load persisted favorites (localStorage + sync with server)
    void this.library.loadFavorites();
    void this.library.loadBanned();

    // What played recently (before the queue is restored, so it can skip those songs)
    this.library.loadPlayLog();
    this.loadTopSongAvoid();

    // Restore retained on-air playing song from localStorage if page was refreshed (retained in paused state)
    this.restoreCurrentTrackFromStorage();

    // Restore persisted queue from localStorage or seed from my_songs.txt
    this.restoreOrSeedQueue();

    // Save on-air track and scrubber position right before page refresh/unload
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.saveCurrentTrackToStorage();
      });
    }

    // Start background watcher loop for auto-queue curation and outro mixing
    this.startAutoDjLoop();

    // Find out whether the local AI DJ (Ollama) is available; this also warms the model up
    this.refreshAiStatus();
    // Query initial audio files stored in cache/audio on disk
    this.refreshCacheStatus();
  }

  public async refreshCacheStatus() {
    try {
      const res = await fetch('/api/cache/status');
      if (res.ok) {
        const data = await res.json();
        this.diskCacheCount = data.count || 0;
        this.diskCacheMb = data.totalMb || 0;
        this.notify();
      }
    } catch {
      // ignore
    }
  }

  private async refreshAiStatus() {
    const health = await this.djAgent.getHealth();
    this.aiStatus = health.online ? 'online' : 'offline';
    this.aiProvider = health.provider || (health.online ? 'ollama' : 'none');
    this.aiModelName = health.model || (health.provider === 'gemini' ? 'Gemini Flash' : 'Qwen 2.5 1.5B');
    this.aiBackends = {
      ollama: { online: Boolean(health.ollama?.online), model: health.ollama?.model ?? null },
      gemini: {
        configured: Boolean(health.gemini?.configured),
        online: Boolean(health.gemini?.online),
        model: health.gemini?.model ?? null,
        error: health.gemini?.error ?? null,
      },
    };
    this.notify();
  }

  // --- Mood & Master Equalizer ---

  /** Sets one EQ band (dB). Boosts are offset by lowering the input so the mix stays out of the red. */
  public setEqBand(band: EqBandId, gainDb: number, save: boolean = true) {
    const value = Math.max(EQ_MIN_DB, Math.min(EQ_MAX_DB, gainDb));
    this.eqGains = { ...this.eqGains, [band]: value };
    this.eqFilters.get(band)?.gain.setTargetAtTime(value, this.ctx.currentTime, 0.03);

    // Headroom: pull the level down by ~60% of the biggest boost, so boosting bass
    // makes it fuller rather than just louder and clipping the limiter
    const maxBoost = Math.max(0, ...Object.values(this.eqGains));
    const headroom = Math.pow(10, (-0.6 * maxBoost) / 20);
    this.eqHeadroom.gain.setTargetAtTime(headroom, this.ctx.currentTime, 0.03);

    if (save) this.saveSoundSettings();
    this.notify();
  }

  /** Back to the current mood's EQ preset. */
  public resetEq() {
    this.applyEq(getMood(this.mood).eq);
  }

  private applyEq(gains: EqGains) {
    for (const band of EQ_BANDS) this.setEqBand(band.id, gains[band.id], false);
    this.saveSoundSettings();
  }

  /**
   * One-tap party mood: sets the EQ preset, blend length and (for Bhangra)
   * the AI dhol, and steers auto-curation toward the mood.
   */
  public setMood(moodId: MoodId) {
    const mood = getMood(moodId);
    this.mood = mood.id;
    this.applyEq(mood.eq);
    if (mood.autoDrums) this.rhythm.setEnabled(true);
    // Rhythm plans are per mood: decide again for the song on air first, then the ready songs
    const onAir = this.onAirDeck().getTrack();
    if (onAir) this.rhythmPlans.planFor(onAir, true);
    for (const q of this.queue) if (q.status === 'ready' && q.audioBuffer) this.rhythmPlans.planFor(this.queuedItemToTrack(q));
    this.sessionBpm = this.pickSessionBpm();

    // Re-curate: drop AI picks that haven't started downloading, and search again for this mood
    this.queue = this.queue.filter((q) => !(q.isAiRecommended && q.status === 'queued'));
    this.lastRefillAttemptAt = 0;

    this.acquisitionStatus = this.sessionBpm
      ? `${mood.emoji} ${mood.label} mood: every song is tuned to ${this.sessionBpm} BPM (key-locked, pitch unchanged).`
      : `${mood.emoji} ${mood.label} mood: ${mood.description}.`;
    this.saveSoundSettings();
    this.notify();
  }

  private blendBars(): number {
    return getMood(this.mood).blendBars;
  }

  /**
   * Set tempo for a tempo-locked mood: the song on air's tempo if it already falls in the
   * range (half/double time counts), so the set continues without a jump; else the preferred tempo.
   */
  private pickSessionBpm(): number | null {
    const lock = getMood(this.mood).tempoLock;
    if (!lock) return null;
    const track = this.onAirDeck().getTrack();
    if (track && (track.bpmConfidence ?? 0) >= MIN_BEATMATCH_CONFIDENCE) {
      // In Party mood: never decrease BPM of current song!
      if (this.mood === 'party' && track.bpm >= lock.preferred) {
        return Math.round(track.bpm * 10) / 10;
      }
      const inRange = [0.5, 1, 2]
        .map((m) => track.bpm * m)
        .filter((bpm) => bpm >= lock.min && bpm <= lock.max)
        .sort((a, b) => Math.abs(a - lock.preferred) - Math.abs(b - lock.preferred));
      if (inRange.length) {
        const chosen = inRange[0];
        if (this.mood === 'party' && chosen < track.bpm) {
          return Math.round(track.bpm * 10) / 10;
        }
        return Math.round(chosen * 10) / 10;
      }
      if (this.mood === 'party') {
        return Math.max(lock.preferred, Math.round(track.bpm * 10) / 10);
      }
    }
    return lock.preferred;
  }

  // --- Tempo control (on-air song): speed presets, exact BPM, key lock ---

  /** On-air song tempo for the Tempo control, or null when nothing is loaded. */
  public getTempoInfo(): TempoInfo | null {
    const state = this.onAirDeck().getPlaybackState();
    const track = state.track;
    if (!track) {
      if (this.sessionBpm !== null) {
        return {
          naturalBpm: this.sessionBpm,
          currentBpm: this.sessionBpm,
          ratio: 1,
          keyLock: this.keyLock,
          busy: this.tempoBusy,
          setLocked: true,
          playOriginal: this.playOriginal,
        };
      }
      return null;
    }
    const naturalBpm = track.original?.bpm ?? track.bpm;
    return {
      naturalBpm,
      currentBpm: state.effectiveBpm,
      ratio: naturalBpm ? state.effectiveBpm / naturalBpm : 1,
      keyLock: this.keyLock,
      busy: this.tempoBusy,
      setLocked: this.sessionBpm !== null,
      playOriginal: this.playOriginal,
    };
  }

  /**
   * "Original" toggle: songs play at their original BPM (key-locked set tempo and speed
   * changes are undone for the song on air and every song after it). Off: the set tempo,
   * if any, applies again.
   */
  public togglePlayOriginal() {
    this.playOriginal = !this.playOriginal;
    this.lastSetTempoAttempt = '';
    if (this.playOriginal) {
      this.acquisitionStatus = 'Original tempo: songs play at their own BPM.';
      void this.setTempo(1, { fromOriginalToggle: true });
    } else {
      this.acquisitionStatus = this.sessionBpm
        ? `Original tempo off: back to the set tempo of ${this.sessionBpm} BPM.`
        : 'Original tempo off.';
      this.notify(); // the auto-DJ loop re-applies the set tempo within a second
    }
  }

  /** Sets the on-air song to an exact BPM (e.g. typed in, clicked, or nudged by the user). */
  public setBpm(bpm: number) {
    if (bpm <= 0) return;
    const cleanBpm = Math.round(bpm * 10) / 10;
    const deck = this.onAirDeck();
    const track = deck.getTrack();
    const info = this.getTempoInfo();
    const naturalBpm = track?.original?.bpm ?? track?.bpm ?? info?.naturalBpm ?? this.sessionBpm ?? cleanBpm;

    // A manual BPM set updates the whole-set / session BPM if active
    if (this.sessionBpm !== null) {
      this.sessionBpm = cleanBpm;
    }

    if (track) {
      void this.setTempo(cleanBpm / naturalBpm, { userInitiated: true });
    } else {
      this.sessionBpm = cleanBpm;
      this.acquisitionStatus = `Set tempo changed to ${cleanBpm} BPM.`;
      this.notify();
    }
  }

  /**
   * Plays the on-air song at `ratio` × its natural tempo (0.5x – 1.5x).
   * Key lock on: the audio is re-timed so the pitch stays the same (takes ~1 s, swapped in
   * seamlessly at the same musical position). Key lock off: vinyl style, pitch follows speed.
   */
  public async setTempo(
    ratio: number,
    options: { fromSetTempo?: boolean; fromOriginalToggle?: boolean; userInitiated?: boolean } = {}
  ) {
    const isUserAction = options.userInitiated || (!options.fromSetTempo && !options.fromOriginalToggle);
    // Picking a speed by hand means the user no longer wants the original tempo
    if (isUserAction) this.playOriginal = false;
    const deck = this.onAirDeck();
    const track = deck.getTrack();

    let target = Math.max(MIN_TEMPO, Math.min(MAX_TEMPO, Math.round(ratio * 1000) / 1000));

    // When the whole set is locked to a BPM, a manual tempo update sets the session BPM too
    if (this.sessionBpm !== null && isUserAction) {
      const baseBpm = track?.original?.bpm ?? track?.bpm ?? this.sessionBpm;
      this.sessionBpm = Math.round(baseBpm * target * 10) / 10;
    }

    if (!track) {
      this.notify();
      return;
    }

    if (this.isTransitioning) {
      this.acquisitionStatus = 'Tempo can be changed once the current mix finishes.';
      this.notify();
      return;
    }

    this.rememberOriginal(track);
    const job = ++this.tempoJob;

    // Apply immediate playbackRate to deck & mediaEl for INSTANT 0ms click responsiveness
    deck.setPlaybackRate(target, false);

    if (!this.keyLock || !track.audioBuffer) {
      // Vinyl mode or streaming without full buffer: instant playbackRate only
      if ((track.tempoRatio ?? 1) !== 1 && track.originalBuffer) {
        this.swapDeckAudio(deck, track, track.originalBuffer, 1);
      }
      track.tempoRatio = target;
      track.bpm = (track.original?.bpm ?? track.bpm) * target;
      const newBpm = Math.round(track.bpm * 10) / 10;
      const pct = (target - 1) * 100;
      this.acquisitionStatus = `Tempo ${target.toFixed(2)}x (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%) = ${newBpm} BPM.`;
      this.replanPendingMix();
      this.notify();
      return;
    }

    // Key Lock ON with audioBuffer: retimed via Web Worker with pitch preservation
    this.tempoBusy = true;
    const naturalBpm = track.original!.bpm;
    const targetBpm = (naturalBpm * target).toFixed(1);
    this.acquisitionStatus = `Tuning to ${targetBpm} BPM (key lock: pitch unchanged)…`;
    this.notify();

    let stretched: AudioBuffer;
    try {
      stretched =
        Math.abs(target - 1) < 0.002
          ? track.originalBuffer!
          : await stretchAudioBuffer(this.ctx, track.originalBuffer!, target);
    } catch (err) {
      console.warn('Key-locked tempo change failed:', err);
      if (job === this.tempoJob) this.tempoBusy = false;
      this.acquisitionStatus = 'Could not change the tempo with key lock. Try again, or turn key lock off.';
      this.notify();
      return;
    }

    if (job !== this.tempoJob) return;
    this.tempoBusy = false;
    if (deck.getTrack() !== track || this.isTransitioning) {
      this.notify();
      return;
    }

    this.swapDeckAudio(deck, track, stretched, target);
    deck.setPlaybackRate(1, false);

    const newBpm = Math.round(naturalBpm * target * 10) / 10;
    const pct = (target - 1) * 100;
    this.acquisitionStatus = options.fromOriginalToggle
      ? `Playing "${track.title}" at its original ${newBpm} BPM.`
      : options.fromSetTempo
      ? `Tuned "${track.title}" to ${newBpm} BPM for the set tempo (key lock, pitch unchanged)${
          Math.abs(newBpm - (this.sessionBpm ?? newBpm)) > 1 ? ` — as close to ${this.sessionBpm} as it can go cleanly` : ''
        }.`
      : `Tempo ${target.toFixed(2)}x (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%) = ${newBpm} BPM, key lock on${
          this.sessionBpm !== null ? ', whole set follows' : ''
        }.`;
    this.replanPendingMix();
    this.notify();
  }

  public toggleKeyLock() {
    this.keyLock = !this.keyLock;
    this.saveSoundSettings();
    // Re-apply the current speed in the new mode
    const info = this.getTempoInfo();
    if (info && Math.abs(info.ratio - 1) > 0.002) {
      void this.setTempo(info.ratio);
    } else {
      this.notify();
    }
  }

  /** Keep every following song at the on-air tempo (key-locked), or let songs play at their own tempo. */
  public toggleSetTempoLock() {
    if (this.sessionBpm !== null) {
      this.sessionBpm = null;
      this.acquisitionStatus = 'Set tempo unlocked: songs play at their own tempo.';
    } else {
      const info = this.getTempoInfo();
      this.sessionBpm = Math.round((info?.currentBpm ?? 124) * 10) / 10;
      this.acquisitionStatus = `Whole set locked to ${this.sessionBpm} BPM: queued songs are being tuned (key lock).`;
    }
    this.notify();
  }

  /**
   * Tempo the on-air song should play at under the set tempo lock, as a multiple of its natural
   * tempo: the closest half/normal/double-time reading, capped at the clean key-lock range
   * (±25%), so e.g. a 95 BPM song under a 132 BPM party goes as far as 119 BPM.
   */
  private onAirSetTempoRatio(track: TrackMetadata): number | null {
    if (!this.sessionBpm || (track.bpmConfidence ?? 0) < MIN_BEATMATCH_CONFIDENCE) return null;
    const natural = track.original?.bpm ?? track.bpm;
    const ratio = this.closestTempoRatio(natural, this.sessionBpm);
    // In Party mood: NEVER decrease BPM of original song!
    if (this.mood === 'party' && ratio < 1.0) {
      return 1.0;
    }
    // Hard limit: never adjust beyond ±16% from the original BPM per MIXING_RULES.md
    return Math.max(BPM_LIMITS.MIN_RATIO, Math.min(BPM_LIMITS.MAX_RATIO, ratio));
  }

  /** Keeps the song on air at the set tempo (Party mood / "Whole set at this BPM"), or at its original tempo. */
  private keepOnAirAtSetTempo() {
    if (this.tempoBusy || this.isTransitioning) return;
    if (this.playOriginal) {
      this.keepOnAirAtOriginalTempo();
      return;
    }
    if (!this.sessionBpm || !this.keyLock) return;
    // Don't re-time the audio right before a planned mix starts
    const startsIn = this.pendingMixStartsIn();
    if (startsIn !== null && startsIn < 10) return;

    const state = this.onAirDeck().getPlaybackState();
    const track = state.track;
    if (!track?.audioBuffer || !state.isPlaying) return;
    const desired = this.onAirSetTempoRatio(track);
    if (desired === null) return;

    // Only the key-locked part counts; a gliding playbackRate is the auto-DJ's tempo ramp
    const current = track.tempoRatio ?? 1;
    const attempt = `${track.id}@${desired.toFixed(3)}`;
    if (Math.abs(current - desired) > 0.005 && this.lastSetTempoAttempt !== attempt) {
      this.lastSetTempoAttempt = attempt; // one attempt per song and target, so a failure can't loop
      void this.setTempo(desired, { fromSetTempo: true });
    }
  }

  /** "Original" mode: a song that arrives tuned (e.g. from the party queue) goes back to its own BPM. */
  private keepOnAirAtOriginalTempo() {
    const state = this.onAirDeck().getPlaybackState();
    const track = state.track;
    if (!track?.audioBuffer || !state.isPlaying || (track.tempoRatio ?? 1) === 1) return;
    const attempt = `${track.id}@original`;
    if (this.lastSetTempoAttempt === attempt) return;
    this.lastSetTempoAttempt = attempt;
    void this.setTempo(1, { fromOriginalToggle: true });
  }

  /** Keeps the downloaded audio and timing so every tempo change starts from the original. */
  private rememberOriginal(track: TrackMetadata) {
    if (track.originalBuffer && track.original) return;
    track.originalBuffer = track.audioBuffer;
    track.original = {
      bpm: track.bpm,
      duration: track.duration,
      firstDownbeatTime: track.firstDownbeatTime,
      highlightTime: track.highlightTime,
      cueInTime: track.cueInTime,
      musicStartTime: track.musicStartTime,
      musicEndTime: track.musicEndTime,
    };
    track.tempoRatio = 1;
  }

  /** Swaps the deck to `buffer` (the original re-timed by `bufferRatio`) at the same musical position. */
  private swapDeckAudio(deck: VirtualDeck, track: TrackMetadata, buffer: AudioBuffer, bufferRatio: number) {
    const original = track.original!;
    // Position on the song's natural timeline, independent of how it is currently stretched
    const naturalPosition = deck.getPlaybackState().currentTime * (track.tempoRatio ?? 1);
    track.audioBuffer = buffer;
    track.tempoRatio = bufferRatio;
    track.duration = buffer.duration;
    track.bpm = original.bpm * bufferRatio;
    track.firstDownbeatTime = original.firstDownbeatTime !== undefined ? original.firstDownbeatTime / bufferRatio : undefined;
    track.highlightTime = original.highlightTime !== undefined ? original.highlightTime / bufferRatio : undefined;
    track.cueInTime = original.cueInTime !== undefined ? original.cueInTime / bufferRatio : undefined;
    track.musicStartTime = original.musicStartTime !== undefined ? original.musicStartTime / bufferRatio : undefined;
    track.musicEndTime = original.musicEndTime !== undefined ? original.musicEndTime / bufferRatio : undefined;
    track.energyProfile = undefined; // recomputed from the new audio when a mix is planned
    deck.replaceAudio(track, naturalPosition / bufferRatio);
  }

  // --- Party tempo lock: key-locked time-stretch of queued songs ---

  /** Tempo the song should be tuned to (null = play at its natural tempo). */
  private tempoLockTarget(item: QueuedTrack): number | null {
    if (this.playOriginal || !this.sessionBpm || (item.bpmConfidence ?? 0) < MIN_BEATMATCH_CONFIDENCE) return null;
    const naturalBpm = item.original?.bpm ?? item.bpm ?? 128;
    const ratio = this.closestTempoRatio(naturalBpm, this.sessionBpm);
    // In Party mood: NEVER decrease BPM of original song!
    if (this.mood === 'party' && naturalBpm >= this.sessionBpm) {
      return naturalBpm;
    }
    // Hard limit: never adjust beyond ±16% from original BPM per MIXING_RULES.md
    return Math.abs(ratio - 1) <= BPM_LIMITS.MAX_PERMITTED_PCT ? this.sessionBpm : null;
  }

  private needsTempoWork(item: QueuedTrack): boolean {
    const target = this.tempoLockTarget(item) ?? undefined;
    if (target !== item.tempoLockedTo) return true;
    // In Party mood: high-energy songs faster than session BPM are kept at natural tempo (never discarded or slowed down)
    if (this.mood === 'party') {
      const naturalBpm = item.original?.bpm ?? item.bpm ?? 128;
      if (naturalBpm >= (this.sessionBpm ?? 124)) {
        return false;
      }
    }
    // An AI pick that can't be tuned to the party tempo gets swapped out
    return (
      target === undefined &&
      !this.playOriginal &&
      !!this.sessionBpm &&
      !!item.isAiRecommended &&
      (item.bpmConfidence ?? 0) >= MIN_BEATMATCH_CONFIDENCE
    );
  }

  /** Tunes one ready song to the session tempo (or back to natural); runs one song at a time. */
  private async tuneQueuedSongTempo(item: QueuedTrack) {
    const target = this.tempoLockTarget(item);
    if (!item.original) {
      item.originalBuffer = item.audioBuffer;
      item.original = {
        bpm: item.bpm ?? 128,
        duration: item.duration,
        firstDownbeatTime: item.firstDownbeatTime,
        highlightTime: item.highlightTime,
        cueInTime: item.cueInTime,
        musicStartTime: item.musicStartTime,
        musicEndTime: item.musicEndTime,
      };
    }
    const original = item.original;

    if (target === null) {
      // Party set but this AI pick is too far from the party tempo: replace it rather than kill the groove
      if (!this.playOriginal && this.sessionBpm && item.isAiRecommended && (item.bpmConfidence ?? 0) >= MIN_BEATMATCH_CONFIDENCE) {
        this.queue = this.queue.filter((q) => q !== item);
        this.lastRefillAttemptAt = 0;
        this.acquisitionStatus = `Skipped "${item.title}": ${Math.round(original.bpm)} BPM is too far from the ${this.sessionBpm} BPM party tempo.`;
      } else {
        // Back to the natural tempo
        item.audioBuffer = item.originalBuffer;
        Object.assign(item, { bpm: original.bpm, duration: original.duration, firstDownbeatTime: original.firstDownbeatTime, highlightTime: original.highlightTime, cueInTime: original.cueInTime, musicStartTime: original.musicStartTime, musicEndTime: original.musicEndTime });
        item.energyProfile = undefined;
        item.tempoLockedTo = undefined;
      }
      this.notify();
      return;
    }

    const ratio = this.closestTempoRatio(original.bpm, target);
    this.isTuningTempo = true;
    item.status = 'tuning';
    this.notify();
    try {
      const stretched =
        Math.abs(ratio - 1) < 0.002 ? item.originalBuffer! : await stretchAudioBuffer(this.ctx, item.originalBuffer!, ratio);
      // Everything on the song's timeline moves by the same factor
      item.audioBuffer = stretched;
      item.duration = stretched.duration;
      item.bpm = original.bpm * ratio;
      item.firstDownbeatTime = original.firstDownbeatTime !== undefined ? original.firstDownbeatTime / ratio : undefined;
      item.highlightTime = original.highlightTime !== undefined ? original.highlightTime / ratio : undefined;
      item.cueInTime = original.cueInTime !== undefined ? original.cueInTime / ratio : undefined;
      item.musicStartTime = original.musicStartTime !== undefined ? original.musicStartTime / ratio : undefined;
      item.musicEndTime = original.musicEndTime !== undefined ? original.musicEndTime / ratio : undefined;
      item.energyProfile = undefined; // recomputed from the tuned audio when needed
      item.tempoLockedTo = target;
    } catch (err) {
      console.warn('Key-locked tempo change failed; song keeps its natural tempo:', err);
      item.tempoLockedTo = undefined;
    } finally {
      item.status = 'ready';
      this.isTuningTempo = false;
      this.notify();
    }
  }

  private saveSoundSettings() {
    try {
      window.localStorage.setItem(
        SOUND_SETTINGS_KEY,
        JSON.stringify({ mood: this.mood, eq: this.eqGains, keyLock: this.keyLock })
      );
    } catch {
      // Storage unavailable (private window etc.): settings just won't persist
    }
  }

  private loadSoundSettings() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(SOUND_SETTINGS_KEY) || 'null');
      if (saved?.mood) this.mood = getMood(saved.mood).id;
      this.sessionBpm = getMood(this.mood).tempoLock?.preferred ?? null;
      if (typeof saved?.keyLock === 'boolean') this.keyLock = saved.keyLock;
      const eq = { ...getMood(this.mood).eq, ...(saved?.eq ?? {}) };
      for (const band of EQ_BANDS) this.setEqBand(band.id, Number(eq[band.id]) || 0, false);
    } catch {
      // Ignore corrupt or unavailable storage
    }
  }

  // --- Autonomous Auto-DJ & Queue Management Loop ---

  private startAutoDjLoop() {
    setInterval(() => {
      this.checkAutoCurationAndOutroMix();
    }, 1000);
  }

  private async checkAutoCurationAndOutroMix() {
    const curDeck = this.activeDeck === 'A' ? this.deckA : this.deckB;
    const curState = curDeck.getPlaybackState();
    const curTrack = curState.track;

    // Periodically update persisted current track state so refresh always has latest playhead position
    this.saveCurrentTrackToStorage();

    // 1. Outro Auto-Mix: in the last stretch, plan the best blend point into the next ready song.
    // Only mix when a queued song is ready; otherwise keep the current song going.
    const nextReady = this.queue.find((q) => q.status === 'ready');
    if (nextReady && !nextReady.audioBuffer) {
      // Re-hydrate the upcoming track's buffer from local disk in ~30ms before mixing
      void this.ensureTrackBuffer(nextReady);
    }
    // Best Parts mode: the mix-out deadline is the end of the song's exit window, not the song's end
    const remaining = curTrack ? this.mixOutWindow(curTrack, curState.currentTime).endsAt - curState.currentTime : 0;
    if (this.pendingMix) {
      // Safety net if the planned-mix timer fired late (background tabs throttle timers)
      const startsIn = this.pendingMixStartsIn();
      if (startsIn !== null && startsIn < PLAN_STABLE_SECONDS) this.executePendingMix();
    } else if (
      curState.isPlaying &&
      curState.duration > 60 &&
      !this.isTransitioning &&
      !this.choosingNextSong &&
      remaining <= OUTRO_PLAN_SECONDS &&
      nextReady &&
      nextReady.audioBuffer
    ) {
      this.planOutroMix(curState.track!);
    } else if (
      curState.isPlaying &&
      curState.duration > 60 &&
      !this.isTransitioning &&
      this.aiStatus === 'online' &&
      remaining <= OUTRO_PLAN_SECONDS + AI_PREP_LEAD_SECONDS &&
      remaining > OUTRO_PLAN_SECONDS + 5 &&
      this.aiOutroPrep?.trackId !== curState.track!.id
    ) {
      void this.prepareAiForOutro(curState.track!);
    }

    // Re-check the AI DJ every minute (Ollama may have been started or stopped)
    if (++this.loopTicks % 60 === 0) this.refreshAiStatus();
    // Update disk cache stats every 30 seconds
    if (this.loopTicks % 30 === 0) this.refreshCacheStatus();
    // Keep browser memory ultra-lean by releasing buffers for songs far down the queue
    if (this.loopTicks % 10 === 0) this.pruneBrowserMemory();
    // Keep Up Next free of songs played in the last hour (history may load after the queue)
    if (this.loopTicks % 15 === 0) this.dropRecentlyPlayedFromQueue();
    // New picks nobody played for 30 minutes make way for fresh ones
    if (this.loopTicks % 30 === 0) this.expireStaleSongs();

    // 2. Autonomous Queue Refill from Internet (failed songs don't count;
    // maintain at least MIN_QUEUE_TARGET (~50) songs in queue at all times;
    // retry at most every 10 s so an unproductive search doesn't hammer YouTube/Ollama)
    const usableQueueLength = activeCount(this.queue);
    if (
      this.autoCurationEnabled &&
      usableQueueLength < MIN_QUEUE_TARGET &&
      !this.isFetchingRecommendations &&
      !this.isPopulatingQueue &&
      !this.refreshingQueue && // Refresh runs its own fill
      Date.now() - this.lastRefillAttemptAt > 10_000
    ) {
      void this.populateQueueTo50();
    }

    // 3. The rhythm layer runs its own scheduler off rhythmClock(); nothing to do here

    // 4. Preload the immediate next queued song so it's decoded and 100% ready
    if (this.queue.length > 0 && !this.isPreloadingNext) {
      const nextToPrep = this.queue.find((q) => q.status === 'queued');
      if (nextToPrep) {
        this.preloadQueuedTrack(nextToPrep);
      }
    }

    // 4b. Party tempo lock: tune ready songs to the set tempo (key-locked), one at a time
    if (!this.isTuningTempo) {
      const toTune = this.queue.find((q) => q.status === 'ready' && q.audioBuffer && this.needsTempoWork(q));
      if (toTune) this.tuneQueuedSongTempo(toTune);
    }

    // 4c. ...and the song on air: under a set tempo it must not keep playing at its own BPM
    this.keepOnAirAtSetTempo();

    // 5. Tempo glide. While a mix is planned, slowly ramp the outgoing song toward the next
    // song's tempo (a DJ "tempo ramp"); otherwise glide an engine-set tempo back to natural speed.
    // Manual pitch fader settings are left alone.
    const canAutoAdjust = curDeck.isRateAutomatic() || curState.playbackRate === 1;
    const startsIn = this.pendingMixStartsIn();
    const holdSteady = startsIn !== null && startsIn < PLAN_STABLE_SECONDS;
    if (!this.isTransitioning && curState.isPlaying && canAutoAdjust && !holdSteady) {
      const targetRate =
        this.pendingMix && curTrack ? this.preMixRampRate(curTrack, this.pendingMix.item) : 1;
      const rate = curState.playbackRate;
      if (Math.abs(targetRate - rate) > 0.0005) {
        const step = Math.min(PITCH_RETURN_PER_SECOND, Math.abs(targetRate - rate));
        curDeck.setPlaybackRate(rate + Math.sign(targetRate - rate) * step, true);
      }
    }
  }

  /** Rate the outgoing song should reach before mixing into `next` (1 = no ramp). */
  private preMixRampRate(current: TrackMetadata, next: QueuedTrack): number {
    if ((current.bpmConfidence ?? 0) < MIN_BEATMATCH_CONFIDENCE || (next.bpmConfidence ?? 0) < MIN_BEATMATCH_CONFIDENCE) {
      return 1;
    }
    const desired = this.closestTempoRatio(current.bpm, next.bpm ?? 128);
    // In Party mood: never decrease BPM of original outgoing song!
    if (this.mood === 'party' && desired < 1.0) {
      return 1;
    }
    // Too far apart to beatmatch even with both sides helping: don't ramp, the mix will be a cut
    if (Math.abs(desired - 1) > MAX_OUTGOING_RAMP + MAX_INCOMING_SHIFT) return 1;
    return Math.max(1 - MAX_OUTGOING_RAMP, Math.min(1 + MAX_OUTGOING_RAMP, desired));
  }

  /** next/current tempo ratio using the closest half / normal / double-time interpretation. */
  private closestTempoRatio(currentBpm: number, nextBpm: number): number {
    return [0.5, 1, 2]
      .map((multiple) => (nextBpm * multiple) / currentBpm)
      .reduce((best, rate) => (Math.abs(rate - 1) < Math.abs(best - 1) ? rate : best));
  }

  private canBeatmatch(out: TrackMetadata, inc: { bpm?: number; bpmConfidence?: number }): boolean {
    if ((out.bpmConfidence ?? 0) < MIN_BEATMATCH_CONFIDENCE || (inc.bpmConfidence ?? 0) < MIN_BEATMATCH_CONFIDENCE) {
      return false;
    }
    const gap = Math.abs(this.closestTempoRatio(out.bpm, inc.bpm ?? 128) - 1);
    // Hard limit: never beatmatch if required shift exceeds ±16% per MIXING_RULES.md
    return gap <= BPM_LIMITS.MAX_PERMITTED_PCT;
  }

  // --- Planned mixes: blend at the best point instead of immediately ---

  public isAnyDeckPlaying(): boolean {
    return this.deckA.getPlaybackState().isPlaying || this.deckB.getPlaybackState().isPlaying;
  }

  private onAirDeck(): VirtualDeck {
    return this.activeDeck === 'A' ? this.deckA : this.deckB;
  }

  /** Real seconds until a planned mix starts, or null if none is planned. */
  private pendingMixStartsIn(): number | null {
    if (!this.pendingMix) return null;
    const state = this.onAirDeck().getPlaybackState();
    return (this.pendingMix.plan.exitTime - state.currentTime) / state.playbackRate;
  }

  private mixSongInfo(track: TrackMetadata): MixSongInfo | null {
    if (!track.energyProfile) return null;
    return {
      profile: track.energyProfile,
      bpm: track.bpm,
      downbeat: track.firstDownbeatTime ?? 0,
      duration: Math.min(track.duration, track.musicEndTime ?? track.duration),
      hookTime: track.highlightTime,
      musicStartTime: track.musicStartTime,
      title: track.title,
      artist: track.artist,
      isStrictStart: isStrictStartSong(track),
    };
  }

  /**
   * Best Parts mode: the stretch of the on-air song to mix out in (song seconds): from a full
   * chorus after its hook to 16 bars later. Null when the mode is off, the song is short, its
   * hook isn't known yet, or the window would run into the song's own outro (then it plays out).
   */
  private bestPartExitWindow(track: TrackMetadata): { from: number; to: number } | null {
    if (!this.bestPartsMode || track.highlightTime === undefined || !track.bpm || track.duration < BEST_PART_MIN_SONG_SECONDS) return null;
    const bar = 240 / track.bpm;
    const from = track.highlightTime + BEST_PART_HOOK_BARS * bar;
    const to = from + BEST_PART_EXIT_BARS * bar;
    return to < this.musicEnd(track) - OUTRO_PLAN_SECONDS / 2 ? { from, to } : null;
  }

  /**
   * Best Parts mode: where an incoming song may enter: a bar in the build-up 16 to 4 bars
   * before its hook. Undefined (enter at the intro as usual) when the hook comes so early that
   * the intro is the build-up.
   * For exception songs (e.g. Ping Pong Tremor), strictly enters from 0:00.
   */
  private bestPartEntryRange(track: TrackMetadata): { from: number; to: number } | undefined {
    if (isStrictStartSong(track)) return { from: 0, to: 0 };
    if (!this.bestPartsMode || track.highlightTime === undefined || !track.bpm || track.duration < BEST_PART_MIN_SONG_SECONDS) return undefined;
    const bar = 240 / track.bpm;
    const start = track.musicStartTime ?? 0;
    const to = track.highlightTime - BEST_PART_MIN_BUILD_BARS * bar;
    if (to <= start + 8 * bar) return undefined;
    return { from: Math.max(start, track.highlightTime - BEST_PART_BUILD_BARS * bar), to };
  }

  /**
   * When the on-air song should be mixed out by (`endsAt`, song seconds) and how early it may be
   * (`earliestExit`). Normally its end; in Best Parts mode its exit window, or, once that has
   * passed without a song ready, the next 16 bars.
   */
  private mixOutWindow(track: TrackMetadata, position: number): { endsAt: number; earliestExit?: number } {
    const best = this.bestPartExitWindow(track);
    if (!best) return { endsAt: this.musicEnd(track) };
    if (position < best.to - 4) return { endsAt: best.to, earliestExit: best.from };
    return { endsAt: Math.min(this.musicEnd(track), position + BEST_PART_EXIT_BARS * (240 / track.bpm)) };
  }

  /** Where the song's music ends (a closing scene, dialogue, fade or silence after it doesn't count). */
  private musicEnd(track: TrackMetadata): number {
    return Math.min(track.duration, track.musicEndTime ?? track.duration);
  }

  /**
   * Looks up to `lookAheadSeconds` into the on-air song for the best bar to start blending,
   * and picks the incoming song's entry point, then waits for that moment.
   * Falls back to an immediate mix when no plan is possible (e.g. too close to the end).
   */
  private planMixInto(itemId: string, lookAheadSeconds: number, durationSeconds?: number, earliestExit?: number): boolean {
    const item = this.queue.find((q) => q.id === itemId);
    if (!item || !item.audioBuffer) return false;

    // RULE: Track avoidance of first song in Up Next queue
    this.checkTopSongAvoidance(item);

    const outState = this.onAirDeck().getPlaybackState();
    const outTrack = outState.track;
    const incoming = this.queuedItemToTrack(item);
    this.analyzeTrack(incoming);
    this.copyAnalysisToQueueItem(incoming, item);
    if (outTrack) this.analyzeTrack(outTrack);

    const outInfo = outTrack ? this.mixSongInfo(outTrack) : null;
    const incInfo = this.mixSongInfo(incoming);
    const keyFit = outTrack ? this.keyFit(outTrack, outState.playbackRate, incoming) : 'unknown';
    // Clashing keys: keep the overlap to 4 bars so the harmonies never sit on top of each other long
    const maxBars = keyFit === 'clash' || keyFit === 'ok' ? 4 : this.blendBars();
    const blendBeats = outTrack && this.canBeatmatch(outTrack, incoming) ? maxBars * 4 : 4;
    const plan =
      outTrack && outInfo && incInfo
        ? planMix({
            out: outInfo,
            inc: incInfo,
            outPosition: outState.currentTime,
            blendBeats,
            lookAheadSeconds,
            minLeadSeconds: 1.5,
            preferIncomingHook: false, // Never start from hook because build up is also important
            earliestExit,
            entryRange: this.bestPartEntryRange(incoming),
          })
        : null;
    if (!plan) return this.startQueuedMixNow(item, durationSeconds);

    this.queue = this.queue.filter((q) => q.id !== itemId);
    const outKey = outTrack?.key
      ? this.keyLock
        ? outTrack.key
        : shiftKey(outTrack.key, outState.playbackRate)
      : undefined;
    const harmonicCompat = outKey && incoming.key ? getHarmonicCompatibility(outKey, incoming.key) : null;
    const harmonicShift = harmonicCompat ? `${harmonicCompat.badgeText} (${harmonicCompat.label})` : undefined;

    this.pendingMix = {
      item,
      plan,
      durationSeconds,
      timer: 0,
      keyFit,
      blendBars: keyFit === 'clash' || keyFit === 'ok' ? 4 : undefined,
      harmonicShift,
    };
    this.schedulePendingMix();
    const startsIn = this.pendingMixStartsIn() ?? 0;
    const shiftTag = harmonicCompat ? ` [${harmonicCompat.badgeText}]` : '';
    // Say when the song's ending (a closing scene, dialogue, fade) is being skipped
    const outroTag = outTrack?.outroReason && outTrack.musicEndTime !== undefined && plan.exitTime < outTrack.duration - 5 ? ` (${outTrack.outroReason})` : '';
    this.acquisitionStatus = `Mixing into "${item.title}" in ${Math.round(startsIn)}s${shiftTag} (following MIXING_RULES.md): ${plan.reason}${outroTag}. Click Mix Now to mix immediately.`;
    this.notify();

    if (!outTrack || durationSeconds) return true;

    // Use the AI DJ's choice made ahead of time, but only if that exact exit and entry are
    // still among the rule-abiding options (the song, tempo or mood may have changed since)
    const prepared = this.aiOutroPrep?.trackId === outTrack.id ? this.aiOutroPrep.mix : undefined;
    if (
      prepared &&
      prepared.itemId === item.id &&
      prepared.key === this.mixPrepKey(outTrack, incoming, blendBeats) &&
      plan.exitOptions.some((o) => Math.abs(o.time - prepared.exitTime) < 0.01) &&
      plan.entryOptions.some((o) => Math.abs(o.time - prepared.entryTime) < 0.01)
    ) {
      this.applyAiMix(this.pendingMix, prepared);
    } else if (this.aiStatus === 'online') {
      // Otherwise ask now, in the background; the analysis' plan stands if it's slow
      void this.askAiToRefineMix(outTrack, incoming);
    }
    return true;
  }

  /** What an ahead-of-time AI mix choice depends on, so a stale one is never applied. */
  private mixPrepKey(out: TrackMetadata, inc: TrackMetadata, blendBeats: number): string {
    return [out.id, out.bpm, out.duration, inc.id, inc.bpm, inc.duration, blendBeats, this.mood].join('|');
  }

  /**
   * Runs before the outro window: the AI DJ picks the next song and the mix points for it,
   * using the same plan the outro will compute OUTRO_PLAN_SECONDS before the end.
   * planOutroMix and planMixInto then apply the answers at once instead of waiting for the model.
   */
  private async prepareAiForOutro(current: TrackMetadata) {
    const ready = this.queue.filter((q) => q.status === 'ready' && q.audioBuffer).slice(0, 3);
    const prep: AiOutroPrep = { trackId: current.id, candidateIds: ready.map((q) => q.id) };
    this.aiOutroPrep = prep;
    if (ready.length === 0) return;

    let choice = ready[0];
    if (ready.length > 1) {
      const decision = await this.askAiForNextSong(current, ready);
      if (this.aiOutroPrep !== prep) return;
      if (decision) {
        choice = ready[decision.pick - 1];
        prep.pick = { itemId: choice.id, reason: decision.reason };
      }
    }

    const state = this.onAirDeck().getPlaybackState();
    const outTrack = state.track;
    if (!outTrack || outTrack.id !== current.id || !this.queue.includes(choice) || !choice.audioBuffer) return;
    const incoming = this.queuedItemToTrack(choice);
    this.analyzeTrack(incoming);
    this.copyAnalysisToQueueItem(incoming, choice);
    this.analyzeTrack(outTrack);
    const outInfo = this.mixSongInfo(outTrack);
    const incInfo = this.mixSongInfo(incoming);
    if (!outInfo || !incInfo) return;

    const canBlend = this.canBeatmatch(outTrack, incoming);
    const blendBeats = canBlend ? this.blendBars() * 4 : 4;
    const mixOut = this.mixOutWindow(outTrack, state.currentTime);
    const plan = planMix({
      out: outInfo,
      inc: incInfo,
      outPosition: mixOut.endsAt - OUTRO_PLAN_SECONDS, // where the outro plan will start looking
      blendBeats,
      lookAheadSeconds: OUTRO_PLAN_SECONDS,
      minLeadSeconds: 1.5,
      preferIncomingHook: false,
      earliestExit: mixOut.earliestExit,
      entryRange: this.bestPartEntryRange(incoming),
    });
    if (!plan) return;

    const decision = await this.askAiForMix(outTrack, incoming, choice, plan, canBlend);
    if (!decision || this.aiOutroPrep !== prep) return;
    prep.mix = {
      itemId: choice.id,
      key: this.mixPrepKey(outTrack, incoming, blendBeats),
      exitTime: plan.exitOptions[decision.exit - 1].time,
      entryTime: plan.entryOptions[decision.entry - 1].time,
      style: decision.style,
      bars: decision.bars,
      reason: decision.reason,
    };
  }

  /** Wakes up shortly before the blend point; the start itself is then scheduled sample-accurately. */
  private schedulePendingMix() {
    if (!this.pendingMix) return;
    window.clearTimeout(this.pendingMix.timer);
    const startsIn = this.pendingMixStartsIn() ?? 0;
    this.pendingMix.timer = window.setTimeout(
      () => this.executePendingMix(),
      Math.max(0, (startsIn - PLAN_STABLE_SECONDS) * 1000)
    );
  }

  /**
   * The AI DJ (local Ollama) picks between the rule-abiding exit/entry points the analysis
   * found, and chooses blend vs cut and the blend length. Its reason is shown to the user.
   */
  private async askAiToRefineMix(outTrack: TrackMetadata, incoming: TrackMetadata) {
    const pending = this.pendingMix;
    if (!pending) return;
    const { plan } = pending;
    const decision = await this.askAiForMix(outTrack, incoming, pending.item, plan, this.canBeatmatch(outTrack, incoming));
    // Ignore a late answer: the mix may have started, been cancelled, or replaced
    if (!decision || this.pendingMix !== pending || this.isTransitioning) return;
    this.applyAiMix(pending, {
      exitTime: plan.exitOptions[decision.exit - 1].time,
      entryTime: plan.entryOptions[decision.entry - 1].time,
      style: decision.style,
      bars: decision.bars,
      reason: decision.reason,
    });
  }

  private askAiForMix(outTrack: TrackMetadata, incoming: TrackMetadata, item: QueuedTrack, plan: MixPlan, canBlend: boolean) {
    const outState = this.onAirDeck().getPlaybackState();
    return this.countAiMixCall(this.djAgent.chooseMix({
      mood: getMood(this.mood).label.toLowerCase(),
      sessionBpm: this.sessionBpm,
      current: { title: outTrack.title, artist: outTrack.artist, bpm: outState.effectiveBpm, position: outState.currentTime, duration: outState.duration },
      next: { title: incoming.title, artist: incoming.artist, bpm: incoming.bpm, keyLocked: item.tempoLockedTo !== undefined },
      canBlend,
      keyFit: this.keyFit(outTrack, outState.playbackRate, incoming),
      exitOptions: plan.exitOptions.map((o) => ({ inSeconds: (o.time - outState.currentTime) / outState.playbackRate, at: o.time, why: o.why })),
      entryOptions: plan.entryOptions.map((o) => ({ at: o.time, why: o.why })),
    }));
  }

  private askAiForNextSong(current: TrackMetadata, ready: QueuedTrack[]) {
    return this.countAiMixCall(this.djAgent.chooseNextSong({
      mood: getMood(this.mood).label.toLowerCase(),
      sessionBpm: this.sessionBpm,
      current: { title: current.title, artist: current.artist, bpm: current.bpm },
      recentlyPlayed: this.recentTitles.slice(-3),
      options: ready.map((q) => ({
        title: q.title,
        artist: q.artist,
        bpm: q.bpm ?? 0,
        requested: !q.isAiRecommended,
        keyFit: this.keyFit(current, this.onAirDeck().getPlaybackState().playbackRate, this.queuedItemToTrack(q)),
      })),
    }));
  }

  private async countAiMixCall<T>(call: Promise<T>): Promise<T> {
    this.aiMixCalls++;
    try {
      return await call;
    } finally {
      this.aiMixCalls--;
    }
  }

  /**
   * Without the AI: the first ready song, unless its key clashes with the song on air and one of
   * the next two (not a guest request jumping ahead of it) fits. Guest requests are never skipped.
   */
  private keyFriendlyChoice(current: TrackMetadata, ready: QueuedTrack[]): QueuedTrack {
    const first = ready[0];
    if (!first.isAiRecommended) return first;
    const rate = this.onAirDeck().getPlaybackState().playbackRate;
    if (this.keyFit(current, rate, this.queuedItemToTrack(first)) !== 'clash') return first;
    const better = ready.slice(1, 3).find((q) => q.isAiRecommended && this.keyFit(current, rate, this.queuedItemToTrack(q)) === 'good');
    if (!better) return first;
    this.lastAiDecision = `Next: "${better.title}" — its key fits, "${first.title}" clashes`;
    return better;
  }

  /** Switches a planned mix to the AI DJ's exit/entry points and style, if there's still time. */
  private applyAiMix(pending: NonNullable<typeof this.pendingMix>, choice: AiMixChoice) {
    const now = this.onAirDeck().getPlaybackState();
    const stillAhead = (t: number) => (t - now.currentTime) / now.playbackRate > PLAN_STABLE_SECONDS + 0.5;
    if (!stillAhead(pending.plan.exitTime)) return; // too close to the planned start to change anything safely

    pending.plan = {
      ...pending.plan,
      exitTime: stillAhead(choice.exitTime) ? choice.exitTime : pending.plan.exitTime,
      entryTime: choice.entryTime,
      reason: `🤖 ${choice.reason}`,
    };
    pending.style = choice.style;
    pending.blendBars = pending.keyFit === 'clash' || pending.keyFit === 'ok' ? Math.min(4, choice.bars) : choice.bars;
    this.schedulePendingMix();

    const startsIn = Math.round(this.pendingMixStartsIn() ?? 0);
    const how = choice.style === 'cut' ? 'cut on the beat' : `${choice.bars}-bar blend`;
    this.lastAiDecision = `${choice.reason} (${how})`;
    this.acquisitionStatus = `🤖 AI DJ: ${choice.reason} — ${how} into "${pending.item.title}" in ${startsIn}s (following MIXING_RULES.md). Click Mix Now to mix immediately.`;
    this.notify();
  }

  /**
   * End-of-song auto-mix. With several songs ready, the AI DJ picks the one that flows best
   * (usually already decided by prepareAiForOutro); otherwise, or if it's slow/offline, the
   * queue order is used.
   */
  private async planOutroMix(current: TrackMetadata) {
    const ready = this.queue.filter((q) => q.status === 'ready' && q.audioBuffer).slice(0, 3);
    if (ready.length === 0) return;
    let choice = this.keyFriendlyChoice(current, ready);

    const prep = this.aiOutroPrep;
    const preparedPick =
      prep?.trackId === current.id &&
      prep.pick &&
      prep.candidateIds.join() === ready.map((q) => q.id).join()
        ? ready.find((q) => q.id === prep.pick!.itemId)
        : undefined;

    if (preparedPick) {
      choice = preparedPick;
      this.lastAiDecision = `Next: "${choice.title}" — ${prep!.pick!.reason}`;
    } else if (ready.length > 1 && this.aiStatus === 'online') {
      this.choosingNextSong = true;
      this.acquisitionStatus = '🤖 AI DJ is choosing the next song…';
      this.notify();
      const decision = await this.askAiForNextSong(current, ready);
      this.choosingNextSong = false;
      if (decision) {
        choice = ready[decision.pick - 1];
        this.lastAiDecision = `Next: "${choice.title}" — ${decision.reason}`;
      }
      // The world may have moved on while the model was thinking
      if (this.pendingMix || this.isTransitioning || !this.queue.includes(choice) || choice.status !== 'ready') return;
    }

    const state = this.onAirDeck().getPlaybackState();
    if (!state.isPlaying || !state.track) return;
    const mixOut = this.mixOutWindow(state.track, state.currentTime);
    this.planMixInto(choice.id, mixOut.endsAt - state.currentTime, undefined, mixOut.earliestExit);
    if (this.lastAiDecision.startsWith('Next:') && !this.acquisitionStatus.startsWith('🤖')) {
      this.acquisitionStatus = `🤖 AI DJ picked ${this.lastAiDecision.slice(6)}. ${this.acquisitionStatus}`;
    }
  }

  private executePendingMix(exitNow: boolean = false) {
    const pending = this.pendingMix;
    if (!pending || this.isTransitioning) return;
    window.clearTimeout(pending.timer);
    this.pendingMix = null;

    const onAir = this.onAirDeck();
    if (!this.isAnyDeckPlaying()) {
      // Paused meanwhile: just start the new song
      this.queue.unshift(pending.item);
      this.startQueuedMixNow(pending.item, pending.durationSeconds);
      return;
    }

    // AI DJ choices: a cut, or a blend of its chosen length (at the outgoing tempo)
    let durationSeconds = pending.durationSeconds;
    if (durationSeconds === undefined && pending.style === 'cut') {
      durationSeconds = UNMATCHED_TRANSITION_SECONDS;
    } else if (durationSeconds === undefined && pending.blendBars) {
      durationSeconds = Math.max(4, Math.min(40, (pending.blendBars * 4 * 60) / onAir.getPlaybackState().effectiveBpm));
    }

    const targetDeckId = this.activeDeck === 'A' ? 'B' : 'A';
    const incTrack = this.queuedItemToTrack(pending.item);
    const isStrict = isStrictStartSong(incTrack);
    (targetDeckId === 'A' ? this.deckA : this.deckB).loadTrack(incTrack);
    this.startTransition({
      sourceDeck: this.activeDeck,
      targetDeck: targetDeckId,
      durationSeconds,
      style: 'bass_swap',
      sourceExitTime: exitNow ? undefined : pending.plan.exitTime,
      targetEntryTime: isStrict ? 0 : pending.plan.entryTime,
    });
  }

  /** Drops a planned mix and puts its song back at the front of the queue. */
  public cancelPendingMix(status: string = 'Planned mix cancelled.') {
    if (this.mixLoadingId) {
      this.mixLoadingId = null;
    }
    if (!this.pendingMix) {
      this.acquisitionStatus = status;
      this.notify();
      return;
    }
    window.clearTimeout(this.pendingMix.timer);
    this.queue.unshift(this.pendingMix.item);
    this.pendingMix = null;
    this.acquisitionStatus = status;
    this.notify();
  }

  /** After a seek the planned blend point may be gone or far away: plan again from here. */
  private replanPendingMix() {
    if (!this.pendingMix) return;
    const { item, durationSeconds } = this.pendingMix;
    this.cancelPendingMix();
    this.planMixInto(item.id, MANUAL_MIX_LOOKAHEAD_SECONDS, durationSeconds);
  }

  private async refillQueueWithRecommendations(current: TrackMetadata) {
    this.isFetchingRecommendations = true;
    this.lastRefillAttemptAt = Date.now();
    try {
      // Seeds: the song on air, what was just played, then favourites and Most Played. The server
      // also asks about a random handful of liked / most played songs itself (see researchSeeds).
      const seedList: Array<{ title: string; artist: string; url?: string }> = [
        { title: current.title, artist: current.artist, url: current.url },
      ];
      for (const p of [...this.playLog.slice(0, 3), ...this.favorites, ...this.library.history]) {
        if (seedList.length >= 8) break;
        if (!seedList.some((s) => s.title.toLowerCase() === p.title.toLowerCase())) {
          seedList.push({ title: p.title, artist: p.artist || '', url: p.url });
        }
      }

      const usedSeeds = new Set<string>();
      let iterations = 0;
      // Each request researches several seeds at once and returns up to 40 songs: a few fill the queue
      const MAX_ITERATIONS = 3;
      const SEEDS_PER_REQUEST = 4;

      const nextSeed = (): { title: string; artist: string; url?: string } | undefined => {
        // Find next unused seed from seedList
        let seed = seedList.find((s) => !usedSeeds.has(s.title.toLowerCase()));

        // If initial seedList is exhausted, pick from newly queued songs as seeds!
        if (!seed) {
          const nextQueuedSeed = this.queue.find((q) => !usedSeeds.has(q.title.toLowerCase()));
          if (nextQueuedSeed) {
            seed = { title: nextQueuedSeed.title, artist: nextQueuedSeed.artist };
            seedList.push(seed);
          }
        }

        // If still no seed: the listener's most played artists, then top party bangers, to fill all 50
        if (!seed) {
          const fallbackSeeds = [
            ...this.tasteProfile().artists,
            'Diljit Dosanjh Lover',
            'Sidhu Moose Wala 295',
            'AP Dhillon Brown Munde',
            'Badshah Kar Gayi Chull',
            'Karan Aujla Softly',
            'Guru Randhawa High Rated Gabru',
            'Shubh Cheques',
            'Yo Yo Honey Singh Blue Eyes',
            'Mika Singh Subha Hone Na De',
            'Karan Aujla Tauba Tauba',
            'Arijit Singh Ghungroo Party Mix',
            'Diljit Dosanjh GOAT',
            'Mankirt Aulakh Badnam',
            'Badshah Kala Chashma',
            'Shubh Baller',
          ];
          const nextFallback = fallbackSeeds.find((f) => !usedSeeds.has(f.toLowerCase()));
          if (nextFallback) {
            seed = { title: nextFallback, artist: 'Artist' };
            seedList.push(seed);
          }
        }

        if (seed) usedSeeds.add(seed.title.toLowerCase());
        return seed;
      };

      while (
        !isQueueFull(this.queue) &&
        iterations < MAX_ITERATIONS &&
        !this.stopRefill
      ) {
        iterations++;
        const batch: Array<{ title: string; artist: string; url?: string }> = [];
        while (batch.length < SEEDS_PER_REQUEST) {
          const seed = nextSeed();
          if (!seed) break;
          batch.push(seed);
        }
        if (batch.length === 0) break;
        const seeds = JSON.stringify(batch.map((sd) => [sd.title.slice(0, 80), (sd.artist || '').slice(0, 40), sd.url?.startsWith('http') ? sd.url : '']));

        // What was just played (only this browser knows) shapes the suggestions too
        const recent = JSON.stringify(this.playLog.slice(0, 12).map((e) => [e.title.slice(0, 80), (e.artist || '').slice(0, 40)]));
        const avoid = JSON.stringify(this.sessionAvoidArtists());
        const res = await fetch(
          `/api/recommend?seeds=${encodeURIComponent(seeds)}&mood=${this.mood}&recent=${encodeURIComponent(recent)}&avoid=${encodeURIComponent(avoid)}${
            this.artistFocus ? `&focus=${encodeURIComponent(JSON.stringify(this.artistFocus))}` : ''
          }${
            // The AI (~30 s on CPU) for a background fill's first seed only; Refresh uses quick searches throughout
            iterations > 1 || this.refreshingQueue ? '&ai=0' : ''
          }${
            this.offlineOnly || !navigator.onLine ? '&offline=1' : ''
          }`,
          { signal: (this.refillRequest = new AbortController()).signal }
        );
        if (res.ok) {
          const data = await res.json();
          const recs: Array<{ title: string; url: string; author: string; duration: number; thumbnail: string }> =
            data.recommendations || [];

          for (const item of recs) {
            if (isQueueFull(this.queue)) break;
            // RULE: Never add any song longer than 5 minutes (300s) on your own in up next queue
            if (item.duration && item.duration > MAX_AUTO_QUEUE_SONG_DURATION) continue;
            // RULE: Never include 8D or mashup songs in next queue on your own
            if (is8dOrMashupSong({ title: item.title, artist: item.author, url: item.url })) continue;

            // Avoid duplicates of the queue, the current song, and songs already played this session
            const isDuplicate =
              this.playedUrls.has(item.url) ||
              item.url === current.url ||
              this.isDontPlayAgain({ title: item.title, artist: item.author, url: item.url }) ||
              this.playedRecently({ title: item.title, artist: item.author, url: item.url }) ||
              this.isSongInQueueOrPlayed({ title: item.title, artist: item.author, url: item.url }) ||
              this.isTitleInQueue(item.title, item.author, item.url) ||
              this.lastPlayedWithinHour({ title: item.title, artist: item.author, url: item.url }) !== null ||
              this.wasDropped({ title: item.title, artist: item.author, url: item.url }) ||
              !this.allowedByFocus({ title: item.title, artist: item.author });
            if (!isDuplicate) {
              this.queue.push({
                id: `rec_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                title: item.title,
                artist: item.author,
                duration: item.duration,
                url: item.url,
                thumbnail: item.thumbnail,
                status: 'queued',
                isAiRecommended: true,
                source: 'ai',
                queuedAt: Date.now(),
              });
            }
          }
          this.deduplicateQueue();
          this.saveQueueToStorage();
          this.notify();
        }
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') console.warn('Failed to fetch recommendations:', err); // aborted by Refresh
    } finally {
      this.isFetchingRecommendations = false;
      this.refillRequest = null;
    }
  }

  private async preloadQueuedTrack(item: QueuedTrack) {
    this.isPreloadingNext = true;
    item.status = 'downloading';
    this.notify();

    try {
      // RULE: Never include 8D or mashup songs in next queue on your own
      if (item.source !== 'request' && is8dOrMashupSong(item)) {
        console.log(`[AudioEngine] Dropping "${item.title}" from auto-queue: 8D / mashup audio not allowed.`);
        this.queue = this.queue.filter((q) => q !== item);
        this.saveQueueToStorage();
        this.notify();
        return;
      }

      let streamUrl = item.url;
      // YouTube links and songs from the offline library (local:<id>) are fetched directly
      const isDirectUrl = streamUrl.startsWith('http://') || streamUrl.startsWith('https://') || streamUrl.startsWith('local:');
      if (!isDirectUrl) {
        // Resolve raw song title / query to YouTube stream URL via /api/search
        const query = item.title + (item.artist && item.artist !== 'Artist' ? ' ' + item.artist : '');
        const searchRes = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          if (searchData.results && searchData.results.length > 0) {
            const match = (item.source !== 'request')
              ? (searchData.results.find((r: { title: string; author?: string; url?: string }) => !is8dOrMashupSong({ title: r.title, artist: r.author, url: r.url })) || searchData.results[0])
              : searchData.results[0];
            item.url = match.url;
            item.title = match.title;
            item.artist = match.author;
            item.thumbnail = match.thumbnail;
            item.duration = match.duration;
            item.highlightTime = match.highlightTime;
            streamUrl = match.url;

            // RULE: Never include 8D or mashup songs in next queue on your own
            if (item.source !== 'request' && is8dOrMashupSong(item)) {
              console.log(`[AudioEngine] Dropping "${item.title}" from auto-queue: 8D / mashup audio not allowed.`);
              this.queue = this.queue.filter((q) => q !== item);
              this.saveQueueToStorage();
              this.notify();
              return;
            }

            // RULE: Never add/keep any song longer than 5 minutes on your own in up next queue
            if (item.source !== 'request' && item.duration && item.duration > MAX_AUTO_QUEUE_SONG_DURATION) {
              console.log(`[AudioEngine] Dropping "${item.title}" (${Math.round(item.duration)}s) from auto-queue: exceeds 5 minutes limit.`);
              this.queue = this.queue.filter((q) => q !== item);
              this.saveQueueToStorage();
              this.notify();
              return;
            }
          }
        }
      }

      if (!streamUrl.startsWith('http://') && !streamUrl.startsWith('https://') && !streamUrl.startsWith('local:')) {
        throw new Error(`no search result for "${item.title}"`);
      }

      // A playlist line can resolve to a song that just played: don't auto-queue it again within the hour
      if (
        (item.source !== 'request' && this.lastPlayedWithinHour(item) !== null) ||
        this.isDontPlayAgain(item)
      ) {
        this.queue = this.queue.filter((q) => q !== item);
        this.lastRefillAttemptAt = 0;
        this.saveQueueToStorage();
        this.notify();
        return;
      }

      const streamRes = await fetch(`/api/stream?url=${encodeURIComponent(streamUrl)}`);
      if (!streamRes.ok) throw new Error(`Stream download failed: ${streamRes.statusText}`);

      item.status = 'decoding';
      this.notify();

      const arrayBuffer = await streamRes.arrayBuffer();
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);

      item.audioBuffer = audioBuffer;
      item.duration = audioBuffer.duration;
      item.isDiskCached = true;

      // RULE: Never include 8D or mashup songs in next queue on your own
      if (item.source !== 'request' && is8dOrMashupSong(item)) {
        console.log(`[AudioEngine] Dropping "${item.title}" from auto-queue: 8D / mashup audio not allowed.`);
        this.queue = this.queue.filter((q) => q !== item);
        this.saveQueueToStorage();
        this.notify();
        return;
      }

      // RULE: Never add/keep any song longer than 5 minutes on your own in up next queue
      if (item.source !== 'request' && item.duration > MAX_AUTO_QUEUE_SONG_DURATION) {
        console.log(`[AudioEngine] Dropping "${item.title}" (${Math.round(item.duration)}s) from auto-queue: exceeds 5 minutes limit.`);
        this.queue = this.queue.filter((q) => q !== item);
        this.saveQueueToStorage();
        this.notify();
        return;
      }

      // Analyse BPM, downbeat and hook ahead of time so the mix can be planned
      const track = this.queuedItemToTrack(item);
      this.analyzeTrack(track);
      this.copyAnalysisToQueueItem(track, item);

      item.status = 'ready';
      this.saveQueueToStorage();
      this.pruneBrowserMemory();
      this.refreshCacheStatus();
      this.notify();
    } catch (err) {
      console.warn('Preload failed for', item.title, err);
      this.markFailed(item);
    } finally {
      this.isPreloadingNext = false;
    }
  }

  /**
   * Ensures a queued track has its AudioBuffer loaded into memory.
   * If the buffer was evicted to keep browser RAM lean, it re-fetches it in ~30ms from the local disk cache (cache/audio).
   */
  public async ensureTrackBuffer(item: QueuedTrack): Promise<AudioBuffer | null> {
    if (item.audioBuffer) return item.audioBuffer;
    try {
      const streamRes = await fetch(`/api/stream?url=${encodeURIComponent(item.url)}`);
      if (!streamRes.ok) throw new Error(`Stream download failed: ${streamRes.statusText}`);
      const arrayBuffer = await streamRes.arrayBuffer();
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
      item.audioBuffer = audioBuffer;
      item.duration = audioBuffer.duration;
      item.isDiskCached = true;
      this.notify();
      return audioBuffer;
    } catch (err) {
      console.warn('Could not load audio buffer from disk cache for:', item.title, err);
      return null;
    }
  }

  /**
   * Releases decoded PCM audio buffers from queue items that are further down the queue (index >= 2).
   * Their lightweight metadata (BPM, duration, downbeat) stays intact, while their raw audio lives
   * safely on disk in cache/audio and re-loads in ~30ms whenever needed.
   */
  public pruneBrowserMemory() {
    const readyItems = this.queue.filter((q) => q.status === 'ready');
    if (readyItems.length <= 2) return;

    let freed = 0;
    // Items at index 2 and beyond release their raw buffer from browser RAM
    readyItems.slice(2).forEach((q) => {
      if (q.audioBuffer) {
        q.audioBuffer = undefined;
        q.originalBuffer = undefined;
        q.isDiskCached = true;
        freed++;
      }
    });

    if (freed > 0) {
      this.notify();
    }
  }

  /** Shows a song as failed briefly, then drops it so it doesn't clutter or block the queue. */
  private markFailed(item: QueuedTrack) {
    item.status = 'failed';
    // Not added again automatically for 2 hours (unless someone asks for it)
    this.droppedPicks.push({ song: { title: item.title, artist: item.artist, url: item.url }, at: Date.now() });
    this.notify();
    window.setTimeout(() => {
      this.queue = this.queue.filter((q) => q !== item);
      this.saveQueueToStorage();
      this.notify();
    }, 8000);
  }

  // --- Play log: "Previously played" and no repeats within an hour ---

  public dedupeConsecutivePlayLog(entries: PlayLogEntry[]): PlayLogEntry[] {
    return this.library.dedupeConsecutivePlayLog(entries);
  }

  private songKeys(song: SongRef): string[] {
    return songKeys(song);
  }

  private isSameSong(a: string[], b: string[]): boolean {
    return isSameSong(a, b);
  }

  private loadTopSongAvoid() {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      const saved = JSON.parse(window.localStorage.getItem(TOP_SONG_AVOID_KEY) || 'null');
      if (saved && typeof saved.count === 'number') {
        this.topSongAvoidKey = saved.key || null;
        this.topSongAvoidCount = saved.count || 0;
      }
    } catch {
      // Ignore corrupt or unavailable storage
    }
  }

  private saveTopSongAvoid() {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      if (this.topSongAvoidKey && this.topSongAvoidCount > 0) {
        window.localStorage.setItem(
          TOP_SONG_AVOID_KEY,
          JSON.stringify({ key: this.topSongAvoidKey, count: this.topSongAvoidCount })
        );
      } else {
        window.localStorage.removeItem(TOP_SONG_AVOID_KEY);
      }
    } catch {
      // Storage unavailable
    }
  }

  /**
   * Tracks avoidance of the song at the first position of the Up Next queue.
   * If the first song in the queue is avoided and other songs are played 7 times consecutively,
   * remove that song from the top of the queue.
   */
  public checkTopSongAvoidance(playedSong: { id?: string; title?: string; artist?: string; url?: string }): void {
    if (!playedSong) return;
    if (playedSong.id && this.lastAvoidanceCheckedTrackId === playedSong.id) return;
    if (playedSong.id) this.lastAvoidanceCheckedTrackId = playedSong.id;

    if (this.queue.length === 0) {
      this.topSongAvoidKey = null;
      this.topSongAvoidCount = 0;
      this.saveTopSongAvoid();
      return;
    }

    const topItem = this.queue[0];
    if (!topItem || !topItem.title) return;

    // Check if the played song matches the top item in the queue
    const topTitle = (topItem.title || '').trim().toLowerCase();
    const topCore = cleanCoreTitle(topItem.title || '');

    const isMatch = sameSongAs(playedSong)(topItem);

    if (isMatch) {
      // Top song was played: reset avoidance tracking
      this.topSongAvoidKey = null;
      this.topSongAvoidCount = 0;
      this.saveTopSongAvoid();
      return;
    }

    // A different song was played: top song was avoided
    const topKey = topCore || topTitle || topItem.id;
    if (this.topSongAvoidKey === topKey) {
      this.topSongAvoidCount += 1;
    } else {
      this.topSongAvoidKey = topKey;
      this.topSongAvoidCount = 1;
    }

    this.saveTopSongAvoid();

    // RULE: If avoided 7 times in a row while playing other songs, remove from top of queue
    if (this.topSongAvoidCount >= 7) {
      const removed = this.queue.shift();
      console.log(`[AudioEngine] Removed "${removed?.title}" from top of Up Next queue after being avoided 7 times.`);
      this.acquisitionStatus = `Removed "${removed?.title}" from top of queue (avoided 7 times).`;
      this.topSongAvoidKey = null;
      this.topSongAvoidCount = 0;
      this.saveTopSongAvoid();
      this.saveQueueToStorage();
      this.notify();
    }
  }

  /** The listener's taste from Most Played, Favourites, the play log, banned songs and tonight's removals (see shared/taste.ts). */
  public tasteProfile(): TasteProfile {
    return buildTaste({
      history: this.library.history,
      favourites: this.favorites,
      recent: this.playLog,
      banned: this.bannedSongs,
      avoidArtists: this.sessionAvoidArtists(),
    });
  }

  /** Artists with REMOVALS_TO_AVOID_ARTIST or more songs removed from Up Next tonight. */
  private sessionAvoidArtists(): string[] {
    return [...this.removedArtists.values()].filter((a) => a.count >= REMOVALS_TO_AVOID_ARTIST).map((a) => a.name);
  }

  /**
   * Whether the song was played in the last 3 hours (Previously Played, or the server's history
   * if this browser's log was cleared). Automatic picks skip these; older plays may come back.
   */
  public playedRecently(song: SongLike): boolean {
    if (!song) return false;
    const since = Date.now() - REPLAY_GAP_MS;
    const matches = sameSongAs(song);
    return this.playLog.some((e) => e.playedAt >= since && matches(e)) || this.library.history.some((h) => h.lastPlayed >= since && matches(h));
  }

  /** A song that expired, was refreshed away or failed to load in the last 2 hours. */
  private wasDropped(song: SongLike): boolean {
    const since = Date.now() - EXPIRED_MEMORY_MS;
    this.droppedPicks = this.droppedPicks.filter((d) => d.at >= since);
    const matches = sameSongAs(song);
    return this.droppedPicks.some((d) => matches(d.song));
  }

  /** Checks whether a song matches any song in the Up Next queue, the last 3 hours' plays, or on-air decks. */
  public isSongInQueueOrPlayed(song: SongLike): boolean {
    if (!song) return false;
    if (this.isDontPlayAgain(song)) return true;
    const matches = sameSongAs(song);

    // 1. Check Up Next queue (and pending mix)
    for (const q of this.queue) {
      if (matches(q)) return true;
    }
    if (this.pendingMix && matches(this.pendingMix.item)) {
      return true;
    }

    // 2. Played in the last 3 hours
    if (this.playedRecently(song)) return true;

    // 3. Check Currently on air decks
    if (matches(this.deckA.getTrack())) return true;
    if (matches(this.deckB.getTrack())) return true;

    return false;
  }

  /** Checks whether a song title or key is already present in the Up Next queue. */
  public isTitleInQueue(title: string, artist?: string, url?: string, excludeId?: string): boolean {
    if (!title) return false;
    const matches = sameSongAs({ title, artist, url });
    const candidates = this.pendingMix ? [...this.queue, this.pendingMix.item] : this.queue;
    return candidates.some((q) => !(excludeId && q.id === excludeId) && matches(q));
  }

  /**
   * Enforces that the Up Next queue never contains duplicate songs (same video, same name,
   * or same normalized core title). Keeps the earliest ready or loading instance.
   */
  public deduplicateQueue(): void {
    if (this.queue.length <= 1) return;
    const uniqueQueue = dedupeQueue(
      this.queue,
      (item) =>
        // RULE: If any song is in previously played, same name song should NOT be there in up next queue!
        this.playedRecently(item) ||
        this.isDontPlayAgain(item) ||
        // RULE: Never add or keep any song longer than 5 minutes on your own in up next queue.
        // Explicit user searches and requests (source === 'request') are permitted.
        (item.source !== 'request' && !!item.duration && item.duration > MAX_AUTO_QUEUE_SONG_DURATION) ||
        // RULE: Never include 8D or mashup songs in next queue on your own.
        (item.source !== 'request' && is8dOrMashupSong(item))
    );
    if (uniqueQueue.length !== this.queue.length) {
      this.queue = uniqueQueue;
    }
  }

  /**
   * Reads user mood from a searched/played song and pushes the top 5
   * matching songs to the top of the Up Next queue.
   */
  public async readMoodAndPushTop5(track: TrackMetadata): Promise<void> {
    if (!track?.title) return;
    try {
      this.acquisitionStatus = `🤖 AI reading mood from "${track.title}"…`;
      this.notify();

      const moodResult = await this.djAgent.readMoodAndRecommendTop5({
        title: track.title,
        artist: track.artist,
        bpm: track.bpm,
        taste: tasteForPrompt(this.tasteProfile()),
      });

      if (!moodResult || !moodResult.top5Songs || moodResult.top5Songs.length === 0) return;

      const newQueuedItems: QueuedTrack[] = [];

      for (let i = 0; i < moodResult.top5Songs.length; i++) {
        const s = moodResult.top5Songs[i];
        const searchPrompt = s.searchPrompt || `${s.artist} - ${s.title}`;

        // RULE: Never include 8D or mashup songs in next queue on your own
        if (is8dOrMashupSong({ title: s.title, artist: s.artist, url: searchPrompt })) continue;

        // Skip if this song is in previously played, already in queue, or in Don't Play Again Ever
        if (
          this.isDontPlayAgain({ title: s.title, artist: s.artist, url: searchPrompt }) ||
          this.playedRecently({ title: s.title, artist: s.artist, url: searchPrompt }) ||
          this.isSongInQueueOrPlayed({ title: s.title, artist: s.artist, url: searchPrompt }) ||
          this.isTitleInQueue(s.title, s.artist, searchPrompt) ||
          this.wasDropped({ title: s.title, artist: s.artist, url: searchPrompt }) ||
          !this.allowedByFocus({ title: s.title, artist: s.artist }) ||
          cleanCoreTitle(track.title) === cleanCoreTitle(s.title)
        ) {
          continue;
        }

        // Quick search to get thumbnail and YouTube url
        let url = searchPrompt;
        let duration = 180;
        let thumbnail: string | undefined;
        try {
          const res = await fetch(`/api/search?q=${encodeURIComponent(searchPrompt)}&limit=5`);
          if (res.ok) {
            const data = await res.json();
            if (data.results && data.results.length > 0) {
              const r = data.results.find((res: { title: string; author?: string; url?: string }) => !is8dOrMashupSong({ title: res.title, artist: res.author, url: res.url })) || data.results[0];
              url = r.url || url;
              duration = r.duration || duration;
              thumbnail = r.thumbnail;
            }
          }
        } catch {
          // fallback to search prompt query string
        }

        // RULE: Never include 8D or mashup songs in next queue on your own
        if (is8dOrMashupSong({ title: s.title, artist: s.artist, url })) continue;

        // RULE: Never add any song longer than 5 minutes on your own in up next queue
        if (duration > MAX_AUTO_QUEUE_SONG_DURATION) continue;

        const queuedItem: QueuedTrack = {
          id: `ai_mood_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`,
          title: s.title,
          artist: s.artist,
          duration,
          url,
          thumbnail,
          status: 'queued',
          isAiRecommended: true,
          source: 'ai',
          queuedAt: Date.now(),
        };

        newQueuedItems.push(queuedItem);
      }

      if (newQueuedItems.length > 0) {
        // Push to the VERY TOP of the Up Next queue
        this.queue.unshift(...newQueuedItems);
        this.deduplicateQueue();
        if (this.queue.length > MAX_QUEUE_TARGET) {
          this.queue = this.queue.slice(0, MAX_QUEUE_TARGET);
        }
        this.saveQueueToStorage();

        // Pre-fetch the first song buffer from disk/cache for instant mix
        if (newQueuedItems[0]) {
          void this.ensureTrackBuffer(newQueuedItems[0]);
        }

        this.lastAiDecision = `Mood: ${moodResult.detectedMood} — ${moodResult.reason}`;
        this.acquisitionStatus = `🤖 AI read mood: "${moodResult.detectedMood}" from "${track.title}". Pushed top ${newQueuedItems.length} songs to top of queue!`;
        this.notify();
      }
    } catch (err) {
      console.warn('Failed to read mood and push top 5 songs:', err);
    }
  }

  /** Returns top party bangers filtered to never include songs in queue, previously played, or on air. */
  public getTopBangers(): SongHistoryItem[] {
    // One pass compares every history song with the queue and play log (~24 ms with a 50-song
    // history and queue), and the UI and phone sync read this several times a second
    const raw = this.library.history;
    const key = [
      raw.length,
      raw[0]?.id,
      raw.reduce((sum, h) => sum + (h.playCount || 0), 0),
      this.queue.map((q) => q.id).join(','),
      this.playLog.length,
      this.playLog[0]?.playedAt,
      this.bannedSongs.length,
      this.pendingMix?.item.id,
      this.deckA.getTrack()?.id,
      this.deckB.getTrack()?.id,
    ].join('|');
    if (this.topBangersCache?.key !== key || this.topBangersCache.raw !== raw) {
      this.topBangersCache = { key, raw, list: raw.filter((song) => !this.isSongInQueueOrPlayed(song)) };
    }
    return this.topBangersCache.list;
  }

  /** When the song last played within the no-repeat window (ms timestamp), or null. */
  public lastPlayedWithinHour(song: { title: string; artist?: string; url?: string }): number | null {
    const since = Date.now() - NO_REPEAT_WINDOW_MS;
    const keys = this.songKeys(song);
    const fromLog = this.playLog.find((e) => e.playedAt >= since && this.isSameSong(keys, this.songKeys(e)));
    if (fromLog) return fromLog.playedAt;
    // Also the server-side history, in case this browser's log was cleared
    const fromHistory = this.library.history.find(
      (h) => h.lastPlayed >= since && this.isSameSong(keys, this.songKeys(h))
    );
    return fromHistory ? fromHistory.lastPlayed : null;
  }

  /**
   * 1-hour rule for a song being added: playlist songs played recently are skipped (removed,
   * returns false); a song the user asked for is allowed but flagged with when it last played.
   */
  private allowRecentlyPlayed(item: QueuedTrack): boolean {
    // If the user explicitly requested this song from search or history, always allow it!
    if (item.source === 'request') {
      return true;
    }
    // A song played in the last 3 hours should NOT be in Up Next again
    if (this.playedRecently(item)) {
      this.queue = this.queue.filter((q) => q !== item);
      this.saveQueueToStorage();
      this.acquisitionStatus = `Skipped "${item.title}": played in the last 3 hours.`;
      this.notify();
      return false;
    }
    const lastPlayed = this.lastPlayedWithinHour(item);
    if (lastPlayed === null) return true;
    const minutes = Math.max(1, Math.round((Date.now() - lastPlayed) / 60000));
    this.queue = this.queue.filter((q) => q !== item);
    this.saveQueueToStorage();
    this.acquisitionStatus = `Skipped "${item.title}": played ${minutes} min ago (no repeats allowed).`;
    this.notify();
    return false;
  }

  /** Removes automatically added songs that were played within the last hour. */
  private dropRecentlyPlayedFromQueue() {
    const before = this.queue.length;
    this.queue = this.queue.filter(
      (q) => q.source === 'request' || q.status === 'downloading' || this.lastPlayedWithinHour(q) === null
    );
    if (this.queue.length !== before) {
      this.saveQueueToStorage();
      this.lastRefillAttemptAt = 0; // top the queue back up
    }
  }

  public removeFromQueue(itemId: string) {
    const removed = this.queue.find((q) => q.id === itemId);
    if (removed && !isChosen(removed)) {
      const name = songArtists(removed)[0];
      if (name) {
        const entry = this.removedArtists.get(artistKey(name)) ?? { name, count: 0 };
        entry.count++;
        this.removedArtists.set(artistKey(name), entry);
      }
    }
    if (this.queue[0]?.id === itemId) {
      this.topSongAvoidKey = null;
      this.topSongAvoidCount = 0;
      this.saveTopSongAvoid();
    }
    this.queue = this.queue.filter((q) => q.id !== itemId);
    this.saveQueueToStorage();
    this.notify();
  }

  /**
   * Reorder a track in the upcoming queue (e.g. prioritize to top/play-next or nudge up/down).
   */
  public moveQueueItem(itemId: string, direction: 'up' | 'down' | 'top') {
    const idx = this.queue.findIndex((q) => q.id === itemId);
    if (idx === -1) return;
    const item = this.queue[idx];
    const newQueue = [...this.queue];
    newQueue.splice(idx, 1);
    if (direction === 'top') {
      newQueue.unshift(item);
    } else if (direction === 'up') {
      newQueue.splice(Math.max(0, idx - 1), 0, item);
    } else if (direction === 'down') {
      newQueue.splice(Math.min(newQueue.length, idx + 1), 0, item);
    }
    this.queue = newQueue;
    this.saveQueueToStorage();
    this.notify();
  }

  /**
   * Persists the currently loaded on-air song and playhead position so that if the user
   * refreshes the page, the active song is preserved without being lost.
   */
  public saveCurrentTrackToStorage() {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      const curDeck = this.activeDeck === 'A' ? this.deckA : this.deckB;
      const track = curDeck.getTrack();
      if (!track || !track.url) {
        window.localStorage.removeItem(CURRENT_TRACK_KEY);
        return;
      }
      const serializable = {
        deckId: this.activeDeck,
        track: {
          id: track.id,
          title: track.title,
          artist: track.artist,
          duration: track.duration,
          url: track.url,
          thumbnail: track.thumbnail,
          highlightTime: track.highlightTime,
          cueInTime: track.cueInTime,
          musicStartTime: track.musicStartTime,
          musicEndTime: track.musicEndTime,
          introSkipReason: track.introSkipReason,
          bpm: track.bpm,
          bpmConfidence: track.bpmConfidence,
          firstDownbeatTime: track.firstDownbeatTime,
          sourceType: track.sourceType,
        },
        currentTime: curDeck.getCurrentTime(),
        savedAt: Date.now(),
      };
      window.localStorage.setItem(CURRENT_TRACK_KEY, JSON.stringify(serializable));
    } catch {
      // ignore in restricted environments
    }
  }

  /**
   * Restores the on-air song after a browser refresh.
   * Crucial rule: The song is retained in PAUSED state ("it shouldnt play on it s own"),
   * ready for the user to press Play.
   */
  public restoreCurrentTrackFromStorage() {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      const raw = window.localStorage.getItem(CURRENT_TRACK_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.track || !parsed.track.url) return;

      const deckId: DeckId = parsed.deckId === 'B' ? 'B' : 'A';
      this.activeDeck = deckId;
      this.applyCrossfader(deckId === 'A' ? -1 : 1);

      const deck = deckId === 'A' ? this.deckA : this.deckB;
      const t = parsed.track;
      const track: TrackMetadata = {
        id: t.id,
        title: t.title,
        artist: t.artist,
        duration: t.duration || 180,
        url: t.url,
        thumbnail: t.thumbnail,
        highlightTime: t.highlightTime,
        cueInTime: t.cueInTime,
        musicStartTime: t.musicStartTime,
        musicEndTime: t.musicEndTime,
        introSkipReason: t.introSkipReason,
        bpm: t.bpm || 128,
        bpmConfidence: t.bpmConfidence ?? 0.8,
        firstDownbeatTime: t.firstDownbeatTime ?? 0,
        sourceType: t.sourceType || 'youtube',
        waveformPeaks: this.generateSyntheticPeaks(200, 'anthem'),
      };

      // Retain track on active deck in PAUSED state (NEVER auto-plays on refresh)
      const retainedPosition = Math.max(0, Math.min(parsed.currentTime || 0, track.duration));
      deck.loadTrack(track, retainedPosition);

      // Hydrate audio buffer from local disk cache in background (~30ms) so clicking Play starts instantly
      void this.hydrateTrackBuffer(track);

      this.acquisitionStatus = `Retained "${track.title}" — press Play to resume.`;
      this.notify();
    } catch (err) {
      console.warn('Could not restore current track from storage:', err);
    }
  }

  /**
   * Ensures a TrackMetadata (such as the retained on-air song) has its AudioBuffer loaded into memory.
   * If not in memory, re-hydrates in ~30ms from the local disk cache (cache/audio).
   */
  public async hydrateTrackBuffer(track: TrackMetadata): Promise<AudioBuffer | null> {
    if (track.audioBuffer) return track.audioBuffer;
    if (!track.url) return null;
    try {
      const streamRes = await fetch(`/api/stream?url=${encodeURIComponent(track.url)}`);
      if (!streamRes.ok) throw new Error(`Stream download failed: ${streamRes.statusText}`);
      const arrayBuffer = await streamRes.arrayBuffer();
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
      track.audioBuffer = audioBuffer;
      track.duration = audioBuffer.duration;
      this.analyzeTrack(track);
      // If active deck holds this track and has not started playing yet, cue to musicStartTime
      const deck = this.activeDeck === 'A' ? this.deckA : this.deckB;
      if (deck.getTrack()?.id === track.id && !deck.getPlaybackState().isPlaying) {
        if (deck.getPlaybackState().currentTime < (track.musicStartTime ?? 0)) {
          deck.loadTrack(track, track.musicStartTime);
        }
      }
      this.notify();
      return audioBuffer;
    } catch (err) {
      console.warn('Could not hydrate track buffer for:', track.title, err);
      return null;
    }
  }

  public saveQueueToStorage() {
    try {
      this.deduplicateQueue();
      if (this.queue.length === 0) {
        this.topSongAvoidKey = null;
        this.topSongAvoidCount = 0;
        this.saveTopSongAvoid();
      }
      if (typeof window === 'undefined' || !window.localStorage) return;
      const serializable = this.queue.map((q) => ({
        id: q.id,
        title: q.title,
        artist: q.artist,
        duration: q.duration,
        url: q.url,
        thumbnail: q.thumbnail,
        highlightTime: q.highlightTime,
        cueInTime: q.cueInTime,
        musicStartTime: q.musicStartTime,
        introSkipReason: q.introSkipReason,
        musicEndTime: q.musicEndTime,
        outroReason: q.outroReason,
        status: (q.status === 'ready' || q.status === 'queued') ? 'queued' : q.status,
        isAiRecommended: q.isAiRecommended,
        source: q.source,
        lastPlayedAt: q.lastPlayedAt,
        queuedAt: q.queuedAt,
      }));
      window.localStorage.setItem('ai_dj_up_next_queue', JSON.stringify(serializable));
    } catch {
      // ignore in restricted environments
    }
  }

  public async restoreOrSeedQueue() {
    // 1. Try to restore from localStorage first so page refresh immediately retains queue
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const saved = window.localStorage.getItem('ai_dj_up_next_queue');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            this.queue = parsed.map((item: QueuedTrack) => ({
              ...item,
              status: 'queued',
              audioBuffer: undefined,
            }));
            this.deduplicateQueue();
            const onAirTrack = this.onAirDeck().getTrack();
            if (onAirTrack) {
              this.queue = this.queue.filter(
                (q) => q.id !== onAirTrack.id && q.url !== onAirTrack.url && q.title.toLowerCase() !== onAirTrack.title.toLowerCase() && cleanCoreTitle(q.title) !== cleanCoreTitle(onAirTrack.title)
              );
            }
            this.dropRecentlyPlayedFromQueue();
            this.notify();
          }
        }
      }
    } catch (err) {
      console.warn('Could not restore queue from localStorage:', err);
    }

    // 2. Proactively populate queue to 50 songs based on favorites, past played, and recommendations
    void this.populateQueueTo50();
  }

  /**
   * Populates the Up Next queue up to 50 songs: about 70 % familiar songs, then new picks.
   * 1. Familiar: Favourites, Most Played and Previously Played (not in the last 3 hours), in a
   *    weighted random order so the same songs don't always lead
   * 2. Curated library (my_songs.txt)
   * 3. New picks: context-aware AI recommendations matching taste, mood and vibe
   * Familiar and new songs then take turns (two familiar, one new; see mixFamiliarAndNew).
   */
  public async populateQueueTo50(): Promise<void> {
    if (this.isPopulatingQueue) return;
    if (isQueueFull(this.queue)) return;

    this.isPopulatingQueue = true;
    this.lastRefillAttemptAt = Date.now();

    try {
      const onAirTrack = this.onAirDeck().getTrack();
      // Familiar songs fill at most 70 % when new picks can fill the rest
      const familiarCap = this.autoCurationEnabled ? Math.round(FAMILIAR_SHARE * MAX_QUEUE_TARGET) : MAX_QUEUE_TARGET;
      const familiarFull = () => isQueueFull(this.queue) || this.queue.filter((q) => !isChosen(q) && !isNewPick(q)).length >= familiarCap;
      const isOnAir = (title: string, url: string) =>
        !!onAirTrack && (onAirTrack.title.toLowerCase() === title.toLowerCase() || onAirTrack.url === url || cleanCoreTitle(onAirTrack.title) === cleanCoreTitle(title));

      // 1. Familiar songs: favourites weigh most, then by play count, with some randomness
      type Familiar = { title: string; artist?: string; url?: string; thumbnail?: string; duration?: number; highlightTime?: number };
      const familiar: Familiar[] = [
        ...this.favorites.map((song) => ({ song: song as Familiar, weight: 4 })),
        ...this.library.history.map((song) => ({ song: song as Familiar, weight: 1 + Math.log2(Math.max(1, song.playCount)) })),
        ...this.playLog.map((song) => ({ song: song as Familiar, weight: 1 })),
      ]
        .filter((c) => c.song.title && !/^https?:\/\//i.test(c.song.title)) // a failed lookup saved its link as the title
        .map((c) => ({ ...c, rank: c.weight * (0.5 + Math.random()) }))
        .sort((a, b) => b.rank - a.rank)
        .map((c) => c.song);
      for (const song of familiar) {
        if (familiarFull()) break;
        const title = song.title;
        const artist = song.artist || 'Artist';
        const url = song.url || song.title;
        if (
          !this.allowedByFocus({ title, artist }) ||
          is8dOrMashupSong({ title, artist, url }) ||
          this.isDontPlayAgain({ title, artist, url }) ||
          this.isSongInQueueOrPlayed({ title, artist, url }) ||
          this.isTitleInQueue(title, artist, url) ||
          this.wasDropped({ title, artist, url }) ||
          isOnAir(title, url)
        ) {
          continue;
        }
        if (song.duration && song.duration > MAX_AUTO_QUEUE_SONG_DURATION) continue;

        this.queue.push({
          id: `past_q_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          title,
          artist,
          duration: song.duration || 180,
          url,
          thumbnail: song.thumbnail,
          highlightTime: song.highlightTime,
          status: 'queued',
          isAiRecommended: false,
          source: 'playlist',
          queuedAt: Date.now(),
        });
      }

      this.notify();

      // 2. Curated Library from my_songs.txt
      try {
        const res = await fetch('/api/my-songs');
        if (res.ok) {
          const data = await res.json();
          const songs: string[] = data.songs || [];
          if (songs.length > 0) {
            for (const songTitle of songs) {
              if (familiarFull()) break;
              const parts = songTitle.split(' - ');
              const artist = parts.length > 1 ? parts[0].trim() : 'Artist';
              const title = parts.length > 1 ? parts.slice(1).join(' - ').trim() : songTitle.trim();
              if (
                !this.allowedByFocus({ title, artist }) ||
                is8dOrMashupSong({ title, artist, url: songTitle }) ||
                this.isDontPlayAgain({ title, artist, url: songTitle }) ||
                this.playedRecently({ title, artist, url: songTitle }) ||
                this.isSongInQueueOrPlayed({ title, artist, url: songTitle }) ||
                this.isTitleInQueue(title, artist, songTitle) ||
                this.wasDropped({ title, artist, url: songTitle }) ||
                this.lastPlayedWithinHour({ title, artist, url: songTitle }) !== null ||
                (onAirTrack && (onAirTrack.title.toLowerCase() === title.toLowerCase() || onAirTrack.url === songTitle || cleanCoreTitle(onAirTrack.title) === cleanCoreTitle(title)))
              ) {
                continue;
              }
              this.queue.push({
                id: `seed_q_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                title,
                artist,
                duration: 180,
                url: songTitle,
                status: 'queued',
                isAiRecommended: false,
                source: 'playlist',
              });
            }
          }
        }
      } catch (err) {
        console.warn('Could not read my_songs for queue top-up:', err);
      }

      // 3. Fill all remaining slots up to MAX_QUEUE_TARGET (50) using AI recommendations
      if (!isQueueFull(this.queue) && this.autoCurationEnabled) {
        const seed = onAirTrack || (this.queue[0] ? this.queuedItemToTrack(this.queue[0]) : null) || {
          id: 'seed_init',
          title: 'Bollywood Punjabi Party Banger',
          artist: 'Party Hits',
          duration: 180,
          bpm: 128,
          sourceType: 'download' as const,
        };
        await this.refillQueueWithRecommendations(seed);
      }

      this.deduplicateQueue();
      this.queue = mixFamiliarAndNew(this.queue);
      if (this.queue.length > MAX_QUEUE_TARGET) {
        this.queue = this.queue.slice(0, MAX_QUEUE_TARGET);
      }
      this.saveQueueToStorage();
      this.notify();
    } finally {
      this.isPopulatingQueue = false;
    }
  }

  /**
   * Refresh: rebuilds Up Next from the song on air, the listener's taste and the mood. Songs
   * someone chose and the next few (loading, about to play) stay; the dropped new picks aren't
   * suggested again for 2 hours.
   */
  /** Whether a song is by one of the focus artists (title or artist names them). */
  public matchesFocus(song: { title?: string; artist?: string }): boolean {
    if (!this.artistFocus) return true;
    const text = artistKey(`${song.title ?? ''} ${song.artist ?? ''}`);
    return this.artistFocus.artists.some((a) => artistKey(a).length >= 3 && text.includes(artistKey(a)));
  }

  /** Automatic picks under "play only <artist>" must be by them; "more <artist>" allows anything. */
  private allowedByFocus(song: { title?: string; artist?: string }): boolean {
    return !this.artistFocus?.only || this.matchesFocus(song);
  }

  /**
   * "Play only Diljit Dosanjh" (only = true): Up Next keeps just their songs (and songs someone
   * added), is refilled with their hits, and the next one is mixed in now. "More Diljit Dosanjh"
   * (only = false): new picks lean toward them. Lasts until cleared.
   */
  public setArtistFocus(artists: string[], only: boolean) {
    this.artistFocus = { artists, only };
    const names = artists.join(' & ');
    if (only) {
      this.queue = this.queue.filter((q) => isChosen(q) || this.matchesFocus(q));
      if (this.pendingMix && !isChosen(this.pendingMix.item) && !this.matchesFocus(this.pendingMix.item)) this.cancelPendingMix();
      this.queue = this.queue.filter((q) => isChosen(q) || this.matchesFocus(q)); // the cancelled mix's song went back on top
      this.saveQueueToStorage();
    }
    this.noticeMix(only ? `Playing only ${names}: finding their songs…` : `More ${names} coming up…`);
    this.notify();
    void this.refreshQueue().then(() => {
      const onAir = this.onAirDeck().getTrack();
      if (!only || !this.isAnyDeckPlaying() || this.pendingMix || (onAir && this.matchesFocus(onAir))) return;
      // The song on air isn't theirs: move to one of theirs now (at the best bar in the next 45 s)
      const next = this.queue.find((q) => q.status !== 'failed' && this.matchesFocus(q));
      if (next) this.mixQueuedTrack(next.id);
      else this.noticeMix(`Couldn't find songs by ${names} right now.`);
    });
  }

  /** Back to normal: Up Next picks from all the listener's music again. */
  public clearArtistFocus() {
    if (!this.artistFocus) {
      this.noticeMix('Up Next already plays all your music.');
      return;
    }
    this.artistFocus = null;
    this.noticeMix('Back to normal: Up Next picks from all your music.');
    void this.refreshQueue();
  }

  public async refreshQueue(): Promise<void> {
    if (this.refreshingQueue) return;
    this.refreshingQueue = true;
    this.notify();
    // A background top-up may be running (an AI search takes ~30-45 s): stop it now
    this.stopRefill = true;
    this.refillRequest?.abort();
    while (this.isPopulatingQueue) await new Promise((r) => setTimeout(r, 100));
    this.stopRefill = false;
    const keep = this.queue.filter((q, i) => i < KEEP_AT_TOP || isChosen(q));
    // By id: a loading song's entry is replaced by an updated copy
    const keepIds = new Set(keep.map((q) => q.id));
    const dropped = this.queue.filter((q) => !keepIds.has(q.id));
    const now = Date.now();
    for (const q of dropped) if (isNewPick(q)) this.droppedPicks.push({ song: { title: q.title, artist: q.artist, url: q.url }, at: now });
    this.queue = keep;
    this.saveQueueToStorage();
    this.noticeMix(`Refreshing Up Next: kept ${keep.length}, finding new songs…`);
    this.notify();

    try {
      await this.populateQueueTo50();
    } finally {
      this.refreshingQueue = false;
    }
    const added = this.queue.filter((q) => !keepIds.has(q.id)).length;
    this.noticeMix(`Up Next refreshed: ${added} new songs`);
    this.notify();
  }

  /** New picks nobody played for 30 minutes leave Up Next and are replaced by fresh ones. */
  private expireStaleSongs() {
    const now = Date.now();
    // Songs restored from an older version have no time yet: their clock starts now
    for (const q of this.queue) q.queuedAt ??= now;
    const stale = staleSongs(this.queue, now);
    if (stale.length === 0) return;
    for (const q of stale) this.droppedPicks.push({ song: { title: q.title, artist: q.artist, url: q.url }, at: now });
    this.queue = this.queue.filter((q) => !stale.includes(q));
    this.saveQueueToStorage();
    this.lastRefillAttemptAt = 0; // top the queue back up
    this.acquisitionStatus = `Up Next: replaced ${stale.length} new song${stale.length === 1 ? '' : 's'} nobody played in 30 min.`;
    this.notify();
  }

  // --- Track Analysis & Rhythm Clock ---

  /**
   * Detects BPM, downbeat and hook once per track. Runs regardless of the rhythm layer
   * setting because beatmatching and hook cueing depend on it.
   */
  private analyzeTrack(track: TrackMetadata) {
    if (!track.audioBuffer) return;
    if (!track.energyProfile) track.energyProfile = computeEnergyProfile(track.audioBuffer);

    let bpm = track.bpm;
    let firstDownbeatTime = track.firstDownbeatTime ?? 0;

    if (track.bpmConfidence === undefined || !track.bpm) {
      const bpmResult = detectBpmFromBuffer(track.audioBuffer);
      track.bpm = bpmResult.bpm;
      track.bpmConfidence = bpmResult.confidence;
      track.firstDownbeatTime = bpmResult.firstDownbeatTime;
      bpm = bpmResult.bpm;
      firstDownbeatTime = bpmResult.firstDownbeatTime;
    }

    // Detect the world's most liked part (highlight) & optimal pre-roll cue-in
    if (track.highlightTime === undefined || track.cueInTime === undefined) {
      const highlight = HighlightDetector.detectHighlight(
        track.audioBuffer,
        bpm,
        track.highlightTime ? { peakSeconds: track.highlightTime, intensity: track.highlightIntensity || 0.95 } : undefined,
        firstDownbeatTime
      );
      track.highlightTime = highlight.highlightTime;
      track.cueInTime = highlight.cueInTime;
      track.highlightSource = highlight.source;
      track.highlightIntensity = highlight.intensity;
    }

    // Skip a spoken intro (dialogue, movie scene, skit) and start where the music begins.
    // Decided from the audio: a talking opening (speech-like, no beat) is skipped, a musical one is kept.
    // Exception: Ping Pong Tremor (and related festival anthems) strictly plays from 0:00 starting timestamp.
    if (isStrictStartSong(track)) {
      track.musicStartTime = 0;
      track.cueInTime = 0;
      track.introSkipReason = undefined;
    } else if (track.musicStartTime === undefined) {
      const intro = IntroSkitDetector.detectMusicStart(track.audioBuffer, bpm, firstDownbeatTime);
      // Keep the last few analyses so the on-air song's can be inspected (see getSyncState)
      this.introAnalyses.set(track.id, intro);
      if (this.introAnalyses.size > 20) this.introAnalyses.delete(this.introAnalyses.keys().next().value!);
      track.musicStartTime = intro.suggestedMusicStart;
      track.introSkipReason = intro.reason;
    }

    // Where the music ends: a closing scene, dialogue, fade or silence after it is never waited for
    if (track.musicEndTime === undefined) {
      const outro = OutroDetector.detectMusicEnd(track.audioBuffer, bpm, firstDownbeatTime);
      track.musicEndTime = outro.musicEnd;
      track.outroReason = outro.cut ? outro.reason : undefined;
    }

    // Key (for harmonic mixing) and loudness (for level matching), ~50 ms
    if (track.keyConfidence === undefined) {
      const key = detectKey(track.audioBuffer);
      track.key = key.camelot;
      track.keyConfidence = key.confidence;
    }
    if (track.loudnessDb === undefined) track.loudnessDb = measureLoudnessDb(track.energyProfile);
    for (const deck of [this.deckA, this.deckB]) {
      if (deck.getTrack() === track) deck.setTrimDb(loudnessGainDb(track.loudnessDb));
    }

    this.rhythmPlans.planFor(track);
  }

  /**
   * How well two songs' keys fit as they'll be heard in the mix: without key lock a deck's speed
   * shifts its pitch (6 % = a semitone), so the incoming song is judged at its beatmatch rate.
   */
  private keyFit(out: TrackMetadata, outRate: number, inc: TrackMetadata): 'good' | 'ok' | 'clash' | 'unknown' {
    if (!out.key || !inc.key || (out.keyConfidence ?? 0) < MIN_KEY_CONFIDENCE || (inc.keyConfidence ?? 0) < MIN_KEY_CONFIDENCE) return 'unknown';
    const outConfidence = out.bpmConfidence ?? 0;
    const incRate = this.computeBeatmatchRate(out.bpm * outRate, outConfidence, inc).rate;
    const fit = keyCompatibility(shiftKey(out.key, outRate), shiftKey(inc.key, incRate));
    return fit === null ? 'unknown' : fit >= 1 ? 'good' : fit > 0 ? 'ok' : 'clash';
  }

  private copyAnalysisToQueueItem(track: TrackMetadata, item: QueuedTrack) {
    const isStrict = isStrictStartSong(track) || isStrictStartSong(item);
    item.bpm = track.bpm;
    item.bpmConfidence = track.bpmConfidence;
    item.firstDownbeatTime = track.firstDownbeatTime;
    item.highlightTime = track.highlightTime;
    item.cueInTime = isStrict ? 0 : track.cueInTime;
    item.musicStartTime = isStrict ? 0 : track.musicStartTime;
    item.introSkipReason = isStrict ? undefined : track.introSkipReason;
    item.musicEndTime = track.musicEndTime;
    item.outroReason = track.outroReason;
    item.energyProfile = track.energyProfile;
    item.key = track.key;
    item.keyConfidence = track.keyConfidence;
    item.loudnessDb = track.loudnessDb;
  }

  /**
   * The on-air song's beat grid and position for the rhythm layer. During a mix it reports
   * whether the songs are beatmatched (a blend) or not (a cut), so the drums can step back.
   */
  private rhythmClock(): SongClock | null {
    const deck = this.onAirDeck();
    const track = deck.getTrack();
    const anchor = deck.getClockAnchor();
    if (!track) return null;
    const other = deck === this.deckA ? this.deckB : this.deckA;
    const otherTrack = other.getTrack();
    const transition = !this.isTransitioning
      ? 'none'
      : otherTrack && this.canBeatmatch(track, otherTrack)
        ? 'blend'
        : 'cut';
    return {
      trackId: track.id,
      isPlaying: anchor !== null,
      bpm: track.bpm,
      bpmConfidence: track.bpmConfidence ?? 0,
      downbeat: track.firstDownbeatTime ?? 0,
      rate: anchor?.rate ?? 1,
      startedAt: anchor?.startedAt ?? 0,
      duration: track.duration,
      energyProfile: track.energyProfile,
      musicStartTime: track.musicStartTime,
      hookTime: track.highlightTime,
      transition,
      plan: this.rhythmPlans.planFor(track, true),
    };
  }

  // --- Hot cues & beat loops (Pro decks, see engine/DeckCues.ts) ---

  public getHotCues(deckId: DeckId): Array<number | null> {
    return this.cues.getHotCues(deckId);
  }

  public hotCue(deckId: DeckId, slot: number) {
    this.cues.hotCue(deckId, slot);
  }

  public clearHotCue(deckId: DeckId, slot: number) {
    this.cues.clearHotCue(deckId, slot);
  }

  public getLoopBars(deckId: DeckId): number {
    return this.cues.getLoopBars(deckId);
  }

  public toggleBeatLoop(deckId?: DeckId, bars: number = 4) {
    this.cues.toggleBeatLoop(deckId ?? this.activeDeck, bars);
  }

  public setLoopIn(deckId?: DeckId) {
    this.cues.setLoopIn(deckId ?? this.activeDeck);
  }

  public setLoopOut(deckId?: DeckId) {
    this.cues.setLoopOut(deckId ?? this.activeDeck);
  }

  public exitLoop(deckId?: DeckId) {
    this.cues.exitLoop(deckId ?? this.activeDeck);
  }

  public reloop(deckId?: DeckId) {
    this.cues.reloop(deckId ?? this.activeDeck);
  }

  /** Every rhythm control (laptop UI, phone remote and typed commands) goes through here. */
  public rhythmCommand(cmd: RhythmCommand) {
    this.rhythm.command(cmd);
  }

  // --- Remote Mobile Control Commands ---

  public playCurrent() {
    const cur = this.activeDeck === 'A' ? this.deckA : this.deckB;
    // Empty deck: Play starts the first ready song in the queue
    if (!cur.getTrack()) {
      this.nextTrack();
      return;
    }
    const track = cur.getTrack()!;
    if (!track.audioBuffer && !cur.isStreaming() && !this.isAnyDeckPlaying() && this.canStream(track)) {
      cur.attachStream(`/api/stream?url=${encodeURIComponent(track.url!)}`);
      cur.play();
      this.acquisitionStatus = `Streaming "${track.title}" — beat sync turns on once it has fully loaded.`;
      this.saveCurrentTrackToStorage();
      this.notify();
      void this.finishStreaming(cur, track);
      return;
    }
    if (cur.isStreaming()) {
      cur.play();
      this.notify();
      return;
    }
    if (!track.audioBuffer) {
      this.acquisitionStatus = `Loading "${track.title}"...`;
      this.notify();
      void this.hydrateTrackBuffer(track).then((buf) => {
        if (buf) {
          this.analyzeTrack(track);
          // If first song being played (no deck currently playing), start at musicStartTime (skip conversation, not hook)
          // Exception songs (e.g. Ping Pong Tremor) strictly play from 0:00
          const isStrict = isStrictStartSong(track);
          const isAnyPlaying = this.isAnyDeckPlaying();
          if (!isAnyPlaying) {
            const startPos = isStrict ? 0 : (track.musicStartTime && track.musicStartTime > 0 ? track.musicStartTime : 0);
            const currentPos = cur.getPlaybackState().currentTime;
            if (isStrict) {
              if (currentPos > 0 && cur.getPlaybackState().isPlaying) {
                cur.play();
              } else if (currentPos === 0 || !cur.getPlaybackState().isPlaying) {
                cur.play(0);
              } else {
                cur.play();
              }
            } else if (currentPos < startPos) {
              cur.play(startPos);
            } else {
              cur.play();
            }
          } else {
            cur.play();
          }
          this.saveCurrentTrackToStorage();
          this.notify();
        }
      });
      return;
    }

    this.analyzeTrack(track);
    const isStrict = isStrictStartSong(track);
    const isAnyPlaying = this.isAnyDeckPlaying();
    if (!isAnyPlaying) {
      const startPos = isStrict ? 0 : (track.musicStartTime && track.musicStartTime > 0 ? track.musicStartTime : 0);
      const currentPos = cur.getPlaybackState().currentTime;
      if (isStrict) {
        if (currentPos > 0 && cur.getPlaybackState().isPlaying) {
          cur.play();
        } else if (currentPos === 0 || !cur.getPlaybackState().isPlaying) {
          cur.play(0);
        } else {
          cur.play();
        }
      } else if (currentPos < startPos) {
        cur.play(startPos);
      } else {
        cur.play();
      }
    } else {
      cur.play();
    }

    this.saveCurrentTrackToStorage();
    this.notify();
  }

  public pauseCurrent() {
    const cur = this.activeDeck === 'A' ? this.deckA : this.deckB;
    cur.pause();
    this.cancelPendingMix('Paused — planned mix cancelled.');
    this.rhythm.silence();
    this.saveCurrentTrackToStorage();
    this.notify();
  }

  /** After a seek the beat grid moves: re-lock running drums and re-plan any waiting mix. */
  private afterSeek() {
    this.rhythm.silence(); // drop hits scheduled for the old position; it re-locks on the next tick
    this.replanPendingMix();
  }

  public stopAll() {
    this.cancelPendingMix('All playback stopped.');
    this.deckA.stop();
    this.deckB.stop();
    this.rhythm.silence();
    this.cancelTransition();
    this.saveCurrentTrackToStorage();
    this.acquisitionStatus = 'All playback stopped.';
    this.notify();
  }

  public togglePlayCurrent() {
    const cur = this.activeDeck === 'A' ? this.deckA : this.deckB;
    if (!cur.getTrack()) {
      this.nextTrack();
      return;
    }
    if (cur.getPlaybackState().isPlaying) {
      this.pauseCurrent();
    } else {
      this.playCurrent();
    }
  }

  public seekCurrent(deltaSeconds: number) {
    const cur = this.activeDeck === 'A' ? this.deckA : this.deckB;
    const now = cur.getCurrentTime();
    cur.seek(now + deltaSeconds);
    this.afterSeek();
    this.saveCurrentTrackToStorage();
    this.notify();
  }

  public seekTo(targetSeconds: number) {
    const cur = this.activeDeck === 'A' ? this.deckA : this.deckB;
    cur.seek(targetSeconds);
    this.afterSeek();
    this.saveCurrentTrackToStorage();
    this.notify();
  }

  public prevTrack() {
    const cur = this.activeDeck === 'A' ? this.deckA : this.deckB;
    const startPoint = cur.getTrack()?.musicStartTime ?? 0;
    if (cur.getCurrentTime() > startPoint + 3) {
      cur.seek(startPoint);
      this.afterSeek();
    } else {
      const otherDeck = this.activeDeck === 'A' ? 'B' : 'A';
      this.startTransition({
        sourceDeck: this.activeDeck,
        targetDeck: otherDeck,
        durationSeconds: 4,
        style: 'smooth_crossfade',
      });
    }
    this.saveCurrentTrackToStorage();
    this.notify();
  }

  /**
   * Mixes into the next ready song at the best blend point in the next 45 s per MIXING_RULES.md. Pressing it again
   * while a mix is planned starts that mix right away. Returns false if no song is ready.
   */
  public nextTrack(): boolean {
    if (this.pendingMix) {
      this.executePendingMix(true);
      return true;
    }
    const item = this.queue.find((q) => q.status === 'ready' && q.audioBuffer);
    if (!item && !this.isAnyDeckPlaying()) {
      const first = this.queue.find((q) => q.status !== 'failed' && this.canStream(q));
      if (first) return this.mixQueuedTrack(first.id);
    }
    if (!item) {
      const stillLoading = this.queue.some((q) => q.status !== 'ready' && q.status !== 'failed');
      this.acquisitionStatus = stillLoading
        ? 'Next song is still loading — keeping the current song playing.'
        : 'Queue is empty — add a song to mix into.';
      this.notify();
      return false;
    }
    return this.mixQueuedTrack(item.id);
  }

  /**
   * Mixes into a ready queued song. If something is playing, the mix is planned for the best
   * blend point within the next 45 s per MIXING_RULES.md; asking again for the same song mixes immediately.
   */
  public mixQueuedTrack(itemId: string, durationSeconds?: number, fromLoad = false): boolean {
    // A double click is one click: the second must not turn a planned mix into an instant one
    if (!fromLoad) {
      const last = this.lastMixClick;
      this.lastMixClick = { id: itemId, at: Date.now() };
      if (last?.id === itemId && Date.now() - last.at < DOUBLE_CLICK_MS) return true;
    }

    // Never swap the incoming deck's song in the middle of a mix
    if (this.isTransitioning) {
      this.noticeMix('A mix is already running — try again when it finishes.');
      return false;
    }

    if (this.pendingMix) {
      if (this.pendingMix.item.id === itemId) {
        this.noticeMix(`Mixing into "${this.pendingMix.item.title}" right now.`);
        this.executePendingMix(true);
        return true;
      }
      this.cancelPendingMix(); // a different song was chosen: plan that one instead
    }

    const item = this.queue.find((q) => q.id === itemId);
    if (!item) {
      this.noticeMix('That song is no longer in Up Next.');
      return false;
    }

    // RULE: Track avoidance of first song in Up Next queue
    this.checkTopSongAvoidance(item);
    if (!item.audioBuffer) {
      // Nothing on air: don't wait for the download, play it while it streams
      if (!this.isAnyDeckPlaying() && this.canStream(item)) {
        this.noticeMix(`Starting "${item.title}" — streaming while it loads.`);
        return this.startStreaming(item);
      }
      if (this.mixLoadingId === itemId) {
        this.noticeMix(`Still loading "${item.title}" — it mixes in as soon as it's ready.`);
        return true;
      }
      // A song is on air: a beatmatched mix needs the new song's full audio, so load it first
      this.mixLoadingId = itemId;
      this.noticeMix(`Loading "${item.title}" — it mixes in as soon as it's ready.`);
      void this.ensureTrackBuffer(item).then((buf) => {
        if (this.mixLoadingId === itemId) this.mixLoadingId = null;
        if (buf) this.mixQueuedTrack(itemId, durationSeconds, true);
        else this.noticeMix(`Couldn't load "${item.title}". Try another song.`);
      });
      return true;
    }
    if (item.status === 'tuning') {
      this.noticeMix(`"${item.title}" is being tuned to the party tempo — ready in a second.`);
      return false;
    }
    if (this.onAirDeck().getPlaybackState().isPlaying) {
      const ok = this.planMixInto(itemId, MANUAL_MIX_LOOKAHEAD_SECONDS, durationSeconds);
      const startsIn = this.pendingMix?.item.id === itemId ? this.pendingMixStartsIn() : null;
      this.noticeMix(
        startsIn !== null
          ? `Mix planned: "${item.title}" comes in at the best point in ${Math.max(1, Math.round(startsIn))} s. Click Mix again to mix now.`
          : `Mixing into "${item.title}".`
      );
      return ok;
    }
    this.noticeMix(`Playing "${item.title}".`);
    return this.startQueuedMixNow(item, durationSeconds);
  }

  /** Tells the user what their Mix click did (status line + a toast). */
  private noticeMix(text: string) {
    this.acquisitionStatus = text;
    this.mixNotice = { text, at: Date.now() };
    this.notify();
  }

  /** A song can stream if it has a playable link (a YouTube URL or a local song), not just a search text. */
  private canStream(item: { url?: string }): boolean {
    return !!item.url && (/^https?:\/\//.test(item.url) || item.url.startsWith('local:'));
  }

  /**
   * Puts a song that isn't downloaded yet on air right away (only when nothing is playing): it
   * plays while it streams, and switches to its decoded audio once that's in (beat sync, tempo
   * lock and drums need it). The download is shared on the server, so it's fetched once.
   */
  private startStreaming(item: QueuedTrack): boolean {
    this.queue = this.queue.filter((q) => q.id !== item.id);
    this.saveQueueToStorage();
    const track = this.queuedItemToTrack(item);
    const isStrict = isStrictStartSong(track);
    const deck = this.activeDeck === 'A' ? this.deckA : this.deckB;
    this.applyCrossfader(this.activeDeck === 'A' ? -1 : 1);
    deck.loadTrack(track);
    deck.attachStream(`/api/stream?url=${encodeURIComponent(item.url)}`);
    deck.play(isStrict ? 0 : (track.musicStartTime && track.musicStartTime > 0 ? track.musicStartTime : 0));
    this.recordSongPlay(track);
    this.saveCurrentTrackToStorage();
    this.acquisitionStatus = `Streaming "${track.title}" — beat sync turns on once it has fully loaded.`;
    this.notify();
    void this.finishStreaming(deck, track);
    if (item.source === 'request') void this.readMoodAndPushTop5(track);
    return true;
  }

  /** The streaming song's full audio: decode, analyse, and hand the deck over to it. */
  private async finishStreaming(deck: VirtualDeck, track: TrackMetadata) {
    const buffer = await this.hydrateTrackBuffer(track);
    if (deck.getTrack() !== track) return; // another song was loaded meanwhile
    if (!buffer) {
      this.acquisitionStatus = `"${track.title}" keeps streaming, but couldn't be fully loaded: no beat sync for this song.`;
      this.notify();
      return;
    }
    track.waveformPeaks = VirtualDeck.extractPeaks(buffer, 200);
    deck.upgradeToBuffer(track);
    if (track.url) this.rememberDecoded([this.normalizeCacheKey(track.url), this.normalizeCacheKey(track.title)], { buffer, metadata: track });
    this.acquisitionStatus = `"${track.title}" fully loaded — beat sync, tempo and drums are on.`;
    this.notify();
  }

  /** Puts a queued song on air right away: straight start if nothing plays, else a mix on the next beat. */
  public startQueuedMixNow(item: QueuedTrack, durationSeconds?: number, style: TransitionConfig['style'] = 'bass_swap'): boolean {
    if (!item.audioBuffer) {
      if (!this.isAnyDeckPlaying() && !this.isTransitioning && this.canStream(item)) return this.startStreaming(item);
      void this.ensureTrackBuffer(item).then((buf) => {
        if (buf) this.startQueuedMixNow(item, durationSeconds, style);
      });
      return true;
    }

    this.queue = this.queue.filter((q) => q.id !== item.id);
    this.saveQueueToStorage();
    const track = this.queuedItemToTrack(item);
    const isStrict = isStrictStartSong(track);

    // Nothing on air (first song of the set, or paused): no mix needed,
    // put the song straight on air and play it from where the music begins (skipping conversation).
    // First song MUST NEVER jump to hook!
    const isAnyPlaying = this.isAnyDeckPlaying();
    if (!isAnyPlaying) {
      const targetDeck = this.activeDeck === 'A' ? this.deckA : this.deckB;
      this.applyCrossfader(this.activeDeck === 'A' ? -1 : 1);
      this.analyzeTrack(track);
      targetDeck.loadTrack(track);
      const startPos = isStrict ? 0 : (track.musicStartTime && track.musicStartTime > 0 ? track.musicStartTime : 0);
      targetDeck.play(startPos);
      this.recordSongPlay(track);
      this.saveCurrentTrackToStorage();
      this.notify();
      if (item.source === 'request') {
        void this.readMoodAndPushTop5(track);
      }
      return true;
    }

    const targetDeckId = this.activeDeck === 'A' ? 'B' : 'A';
    const targetDeck = targetDeckId === 'A' ? this.deckA : this.deckB;
    this.analyzeTrack(track);
    targetDeck.loadTrack(track);

    // Never start from hook because build up is also important!
    // Start at music start point (skipping initial conversation dialogue, preserving the full buildup)
    // Exception songs (e.g. Ping Pong Tremor) strictly enter from 0:00
    const startPos = isStrict
      ? 0
      : (this.bestPartEntryRange(track)?.from ?? (track.musicStartTime && track.musicStartTime > 0
          ? track.musicStartTime
          : (track.firstDownbeatTime ?? 0)));
    targetDeck.cueAt(startPos);

    this.startTransition({
      sourceDeck: this.activeDeck,
      targetDeck: targetDeckId,
      durationSeconds,
      style,
    });

    if (item.source === 'request') {
      void this.readMoodAndPushTop5(track);
    }
    return true;
  }

  private queuedItemToTrack(item: QueuedTrack): TrackMetadata {
    const isStrict = isStrictStartSong(item);
    return {
      id: item.id,
      title: item.title,
      artist: item.artist,
      duration: item.duration,
      bpm: item.bpm ?? 128,
      bpmConfidence: item.bpmConfidence,
      firstDownbeatTime: item.firstDownbeatTime,
      audioBuffer: item.audioBuffer,
      waveformPeaks: this.queuedItemPeaks(item),
      sourceType: 'download',
      url: item.url,
      thumbnail: item.thumbnail,
      highlightTime: item.highlightTime,
      cueInTime: isStrict ? 0 : item.cueInTime,
      musicStartTime: isStrict ? 0 : item.musicStartTime,
      musicEndTime: item.musicEndTime,
      outroReason: item.outroReason,
      introSkipReason: isStrict ? undefined : item.introSkipReason,
      energyProfile: item.energyProfile,
      key: item.key,
      keyConfidence: item.keyConfidence,
      loudnessDb: item.loudnessDb,
      // Tuned to the set tempo: keep the original so the Tempo control can re-time from it
      originalBuffer: item.original ? item.originalBuffer : undefined,
      original: item.original,
      tempoRatio: item.original && item.bpm ? item.bpm / item.original.bpm : undefined,
    };
  }

  /**
   * The waveform overview, computed once per song (it scans the whole buffer, ~12 ms) and kept
   * on the queue item: it's a 200-point outline, so it looks the same at any tempo.
   */
  private queuedItemPeaks(item: QueuedTrack): number[] {
    if (item.waveformPeaks) return item.waveformPeaks;
    if (!item.audioBuffer) return this.generateSyntheticPeaks(200, 'anthem');
    return (item.waveformPeaks = VirtualDeck.extractPeaks(item.audioBuffer, 200));
  }

  private newQueueId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * Stores a decoded song under its lookup keys and keeps only the most recent few in memory:
   * each decoded song is ~90 MB, and anything older is re-read from the disk cache in seconds.
   */
  private rememberDecoded(keys: string[], entry: { buffer: AudioBuffer; metadata: TrackMetadata }) {
    for (const key of keys.filter(Boolean)) {
      this.audioBufferCache.delete(key); // re-insert so it counts as most recent
      this.audioBufferCache.set(key, entry);
    }
    // Map keeps insertion order: the first distinct buffers are the least recently stored
    const buffers = [...new Set([...this.audioBufferCache.values()].map((e) => e.buffer))];
    for (const old of buffers.slice(0, Math.max(0, buffers.length - MAX_DECODED_IN_MEMORY))) {
      for (const [key, value] of this.audioBufferCache) {
        if (value.buffer === old) this.audioBufferCache.delete(key);
      }
    }
  }

  private normalizeCacheKey(str: string): string {
    return str.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // --- Background Song Acquisition & Automated Mixing ---

  /**
   * Finds, downloads and analyses a song. `position` decides where it joins the queue:
   * a one-off request jumps to the front, a playlist keeps its order at the back.
   */
  public async acquireTrack(
    queryOrUrl: string,
    autoMix: boolean = false,
    position: 'front' | 'back' = 'front',
    source: 'request' | 'playlist' = 'request',
    readMoodOnPlay: boolean = false
  ): Promise<QueuedTrack | null> {
    const cacheKey = this.normalizeCacheKey(queryOrUrl);
    const cached = this.audioBufferCache.get(cacheKey);

    // RULE: If song is in Don't Play Again Ever, do not acquire or queue
    if (this.isDontPlayAgain({ title: queryOrUrl, url: queryOrUrl })) {
      this.acquisitionStatus = `"${queryOrUrl}" is saved in "Don't Play Again Ever".`;
      this.notify();
      return null;
    }

    // RULE: If song is in previously played, same name song should NOT be there in up next queue (auto-curator rule, user requests always allowed)
    if (source !== 'request' && this.playedRecently({ title: queryOrUrl, url: queryOrUrl })) {
      this.acquisitionStatus = `"${queryOrUrl}" was already played previously.`;
      this.notify();
      return null;
    }

    // RULE: Never include 8D or mashup songs in next queue on your own
    if (source !== 'request' && is8dOrMashupSong({ title: queryOrUrl, url: queryOrUrl })) {
      this.acquisitionStatus = `Skipped "${queryOrUrl}": 8D/mashup songs are not allowed in auto queue.`;
      this.notify();
      return null;
    }

    // Check if song is already in the queue
    const existingIndex = this.queue.findIndex(
      (q) => (queryOrUrl && q.url && queryOrUrl.trim().toLowerCase() === q.url.trim().toLowerCase()) ||
             (q.title && queryOrUrl.trim().toLowerCase() === q.title.trim().toLowerCase())
    );
    if (existingIndex !== -1) {
      const existing = this.queue[existingIndex];
      if (autoMix) {
        // User asked to play a song that's already in the queue: play/mix it right now!
        this.acquisitionStatus = `Playing "${existing.title}" from queue!`;
        if (existing.status === 'ready' && existing.audioBuffer) {
          this.startQueuedMixNow(existing);
        } else {
          this.queue.splice(existingIndex, 1);
          this.queue.unshift(existing);
          void this.ensureTrackBuffer(existing).then((buf) => {
            if (buf) this.startQueuedMixNow(existing);
          });
        }
        this.notify();
        return existing;
      } else {
        if (position === 'front') {
          if (existingIndex > 0) {
            this.queue.splice(existingIndex, 1);
            this.queue.unshift(existing);
            this.saveQueueToStorage();
          }
          this.acquisitionStatus = `Moved "${existing.title}" to first place of Up Next queue!`;
          this.notify();
          return existing;
        } else {
          this.acquisitionStatus = `"${existing.title}" is already in the queue.`;
          this.notify();
          return existing;
        }
      }
    }

    // If playing/mixing immediately, check if the current first song in Up Next was avoided
    if (autoMix) {
      this.checkTopSongAvoidance({ title: queryOrUrl, url: queryOrUrl });
    }

    const addToQueue = (item: QueuedTrack) => {
      if (position === 'front') {
        if (this.pendingMix && this.pendingMix.item.isAiRecommended) {
          this.cancelPendingMix('Planned mix cancelled: new song queued at top.');
        }
        this.queue.unshift(item);
      } else {
        this.queue.push(item);
      }
    };

    // Instant In-Memory Cache Hit: Replay immediately from RAM without re-downloading or re-rendering
    if (cached) {
      this.acquisitionStatus = `Memory Instant Play: "${cached.metadata.title}" (Replay from RAM)`;
      const id = this.newQueueId('cached');
      const queuedItem: QueuedTrack = {
        id,
        title: cached.metadata.title,
        artist: cached.metadata.artist,
        duration: cached.metadata.duration,
        url: cached.metadata.url || queryOrUrl,
        thumbnail: cached.metadata.thumbnail,
        status: 'ready',
        audioBuffer: cached.buffer,
        source,
      };
      if (!this.allowRecentlyPlayed(queuedItem)) return null;
      // RULE: Never include 8D or mashup songs in next queue on your own
      if (source !== 'request' && is8dOrMashupSong(cached.metadata)) {
        this.acquisitionStatus = `Skipped "${cached.metadata.title}": 8D/mashup songs are not allowed in auto queue.`;
        this.notify();
        return null;
      }
      // RULE: Never add any song longer than 5 minutes on your own in up next queue
      if (source !== 'request' && cached.metadata.duration > MAX_AUTO_QUEUE_SONG_DURATION) {
        this.acquisitionStatus = `Skipped "${cached.metadata.title}": exceeds 5 minutes limit.`;
        this.notify();
        return null;
      }
      this.copyAnalysisToQueueItem(cached.metadata, queuedItem);
      addToQueue(queuedItem);
      this.saveQueueToStorage();

      if (autoMix) {
        this.startQueuedMixNow(queuedItem);
        this.acquisitionStatus = `Playing "${cached.metadata.title}"!`;
      }
      if (source === 'request' && (autoMix || readMoodOnPlay || !this.isAnyDeckPlaying())) {
        void this.readMoodAndPushTop5(cached.metadata);
      }

      this.notify();
      return queuedItem;
    }

    const id = this.newQueueId('yt');
    const queuedItem: QueuedTrack = {
      id,
      title: queryOrUrl,
      artist: 'Searching...',
      duration: 180,
      url: queryOrUrl,
      status: 'downloading',
      source,
    };

    addToQueue(queuedItem);
    this.saveQueueToStorage();
    this.acquisitionStatus = `Searching "${queryOrUrl}"...`;
    this.notify();

    try {
      const searchRes = await fetch(`/api/search?q=${encodeURIComponent(queryOrUrl)}`);
      if (!searchRes.ok) throw new Error(`Search failed: ${searchRes.statusText}`);
      const searchData = await searchRes.json();

      if (!searchData.results || searchData.results.length === 0) {
        throw new Error('No audio found for query.');
      }

      const match = (source !== 'request')
        ? (searchData.results.find((r: { title: string; author?: string; url?: string }) => !is8dOrMashupSong({ title: r.title, artist: r.author, url: r.url })) || searchData.results[0])
        : searchData.results[0];

      // RULE: Never include 8D or mashup songs in next queue on your own
      if (source !== 'request' && is8dOrMashupSong({ title: match.title, artist: match.author, url: match.url })) {
        this.queue = this.queue.filter((q) => q.id !== queuedItem.id);
        this.saveQueueToStorage();
        this.acquisitionStatus = `Skipped "${match.title}": 8D/mashup audio is not allowed in auto queue.`;
        this.notify();
        return null;
      }

      // RULE: Check if resolved song is in Don't Play Again Ever
      if (this.isDontPlayAgain({ title: match.title, artist: match.author, url: match.url })) {
        this.queue = this.queue.filter((q) => q.id !== queuedItem.id);
        this.saveQueueToStorage();
        this.acquisitionStatus = `"${match.title}" is saved in "Don't Play Again Ever".`;
        this.notify();
        return null;
      }

      // RULE: Check if resolved song is in previously played (for auto-curation)
      if (source !== 'request' && this.playedRecently({ title: match.title, artist: match.author, url: match.url })) {
        this.queue = this.queue.filter((q) => q.id !== queuedItem.id);
        this.saveQueueToStorage();
        this.acquisitionStatus = `"${match.title}" was already played previously.`;
        this.notify();
        return null;
      }

      // Second-level deduplication: check if the resolved song is already in the queue
      const existingResolvedIndex = this.queue.findIndex(
        (q) => q.id !== queuedItem.id && (
          (match.url && q.url && match.url.trim().toLowerCase() === q.url.trim().toLowerCase()) ||
          this.isSameSong(this.songKeys({ title: match.title, artist: match.author, url: match.url }), this.songKeys(q))
        )
      );
      if (existingResolvedIndex !== -1) {
        const existing = this.queue[existingResolvedIndex];
        this.queue = this.queue.filter((q) => q.id !== queuedItem.id);
        this.saveQueueToStorage();
        if (autoMix) {
          this.acquisitionStatus = `Playing "${existing.title}" from queue!`;
          if (existing.status === 'ready' && existing.audioBuffer) {
            this.startQueuedMixNow(existing);
          } else {
            this.queue.splice(existingResolvedIndex, 1);
            this.queue.unshift(existing);
            void this.ensureTrackBuffer(existing).then((buf) => {
              if (buf) this.startQueuedMixNow(existing);
            });
          }
          this.notify();
          return existing;
        } else if (position === 'front') {
          const idx = this.queue.indexOf(existing);
          if (idx > 0) {
            this.queue.splice(idx, 1);
            this.queue.unshift(existing);
            this.saveQueueToStorage();
          }
          this.acquisitionStatus = `Moved "${existing.title}" to first place of Up Next queue!`;
          this.notify();
          return existing;
        }
        this.acquisitionStatus = `"${match.title}" is already in the queue.`;
        this.notify();
        return existing;
      }

      // Second-level check: check cache with matching URL or Title from search
      const matchUrlKey = match.url ? this.normalizeCacheKey(match.url) : '';
      const matchTitleKey = match.title ? this.normalizeCacheKey(match.title) : '';
      const secondaryCached = this.audioBufferCache.get(matchUrlKey) || this.audioBufferCache.get(matchTitleKey);

      if (secondaryCached) {
        this.queue = this.queue.filter((q) => q.id !== queuedItem.id);
        return this.acquireTrack(secondaryCached.metadata.title, autoMix, position, source);
      }

      queuedItem.title = match.title;
      queuedItem.artist = match.author;
      queuedItem.duration = match.duration;
      queuedItem.url = match.url;
      queuedItem.thumbnail = match.thumbnail;
      if (!this.allowRecentlyPlayed(queuedItem)) return null;

      // RULE: Never add any song longer than 5 minutes on your own in up next queue
      if (source !== 'request' && match.duration && match.duration > MAX_AUTO_QUEUE_SONG_DURATION) {
        this.queue = this.queue.filter((q) => q.id !== queuedItem.id);
        this.saveQueueToStorage();
        this.acquisitionStatus = `Skipped "${match.title}" (${Math.round(match.duration)}s): exceeds 5 minutes limit.`;
        this.notify();
        return null;
      }

      if (autoMix && !this.isAnyDeckPlaying() && !this.isTransitioning) {
        if (source === 'request') this.acquisitionStatus = `Streaming "${match.title}"…`;
        this.startStreaming(queuedItem);
        return queuedItem;
      }

      queuedItem.status = 'downloading';
      this.acquisitionStatus = `Downloading audio: "${match.title}"...`;
      this.notify();

      // Fetch audio stream
      const streamRes = await fetch(`/api/stream?url=${encodeURIComponent(match.url)}`);
      if (!streamRes.ok) throw new Error(`Stream download failed: ${streamRes.statusText}`);

      queuedItem.status = 'decoding';
      this.acquisitionStatus = `Decoding PCM audio buffer...`;
      this.notify();

      const arrayBuffer = await streamRes.arrayBuffer();
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
      queuedItem.audioBuffer = audioBuffer;
      queuedItem.duration = audioBuffer.duration;

      // RULE: Never add any song longer than 5 minutes on your own in up next queue
      if (source !== 'request' && audioBuffer.duration > MAX_AUTO_QUEUE_SONG_DURATION) {
        this.queue = this.queue.filter((q) => q.id !== queuedItem.id);
        this.saveQueueToStorage();
        this.acquisitionStatus = `Skipped "${match.title}" (${Math.round(audioBuffer.duration)}s): exceeds 5 minutes limit.`;
        this.notify();
        return null;
      }

      queuedItem.status = 'ready';
      this.saveQueueToStorage();
      this.acquisitionStatus = `Ready: "${match.title}"`;

      const trackMetadata: TrackMetadata = {
        id: queuedItem.id,
        title: queuedItem.title,
        artist: queuedItem.artist,
        duration: audioBuffer.duration,
        bpm: 128,
        audioBuffer,
        waveformPeaks: VirtualDeck.extractPeaks(audioBuffer, 200),
        sourceType: 'download',
        url: match.url,
        thumbnail: match.thumbnail,
        highlightTime: match.highlightTime,
        highlightIntensity: match.highlightIntensity,
      };

      // Analyse BPM, downbeat and hook up front, so the song is ready to mix and to drum on.
      this.analyzeTrack(trackMetadata);
      this.copyAnalysisToQueueItem(trackMetadata, queuedItem);

      // Keep it decoded in memory for instant replays (older songs come back from the disk cache)
      this.rememberDecoded(
        [cacheKey, match.url ? this.normalizeCacheKey(match.url) : '', match.title ? this.normalizeCacheKey(match.title) : ''],
        { buffer: audioBuffer, metadata: trackMetadata }
      );

      // If autoMix requested: transition immediately into set!
      if (autoMix) {
        this.startQueuedMixNow(queuedItem);
        this.acquisitionStatus = `Playing "${match.title}"!`;
      }
      if (source === 'request' && (autoMix || readMoodOnPlay || !this.isAnyDeckPlaying())) {
        void this.readMoodAndPushTop5(trackMetadata);
      }

      this.notify();
      return queuedItem;
    } catch (err) {
      console.error('Audio acquisition failed:', err);
      this.acquisitionStatus = `Couldn't get "${queuedItem.title}": ${err instanceof Error ? err.message : String(err)}`;
      this.markFailed(queuedItem);
      return null;
    }
  }

  // --- Crossfader & Transitions ---

  /** Manual crossfader move. Grabbing the fader takes over from a running automatic mix. */
  public setCrossfader(pos: number) {
    if (this.isTransitioning) {
      this.cancelTransition();
    }
    this.applyCrossfader(pos);
    this.notify();
  }

  private applyCrossfader(pos: number) {
    this.crossfaderPosition = Math.max(-1, Math.min(1, pos));
    this.activeDeck = this.crossfaderPosition < 0 ? 'A' : 'B';

    const [gainA, gainB] = this.equalPowerGains(this.crossfaderPosition);
    const now = this.ctx.currentTime;
    this.crossfaderGainA.gain.cancelScheduledValues(now);
    this.crossfaderGainB.gain.cancelScheduledValues(now);
    this.crossfaderGainA.gain.setTargetAtTime(gainA, now, 0.02);
    this.crossfaderGainB.gain.setTargetAtTime(gainB, now, 0.02);
  }

  private equalPowerGains(pos: number): [number, number] {
    const x = (pos + 1) / 2;
    return [Math.cos((x * Math.PI) / 2), Math.sin((x * Math.PI) / 2)];
  }

  /** Real seconds until the deck's next beat (at least 50 ms ahead so it can be scheduled). */
  private secondsToNextBeat(state: { track: TrackMetadata | null; currentTime: number; playbackRate: number }): number {
    if (!state.track) return 0.05;
    const beat = 60 / state.track.bpm; // song seconds per beat
    const grid = state.track.firstDownbeatTime ?? 0;
    const beatsElapsed = (state.currentTime - grid) / beat;
    let nextBeat = grid + Math.ceil(beatsElapsed) * beat;
    while ((nextBeat - state.currentTime) / state.playbackRate < 0.05) nextBeat += beat;
    return (nextBeat - state.currentTime) / state.playbackRate;
  }

  /**
   * Picks the playback rate that beatmatches the incoming track, trying half/double-time.
   * Returns rate 1 (natural pitch) when either BPM is unreliable or the shift would be audible.
   */
  private computeBeatmatchRate(sourceBpm: number, sourceConfidence: number, target: TrackMetadata) {
    if (sourceConfidence < MIN_BEATMATCH_CONFIDENCE || (target.bpmConfidence ?? 0) < MIN_BEATMATCH_CONFIDENCE) {
      return { rate: 1, matched: false };
    }
    let bestRate = 1;
    let bestShift = Infinity;
    for (const multiple of [0.5, 1, 2]) {
      const rate = sourceBpm / (target.bpm * multiple);
      if (Math.abs(rate - 1) < bestShift) {
        bestShift = Math.abs(rate - 1);
        bestRate = rate;
      }
    }
    // In Party mood: never decrease BPM of incoming song below its original natural tempo!
    if (this.mood === 'party' && bestRate < 1.0) {
      return { rate: 1, matched: false };
    }
    // Hard limit: never adjust beyond ±16% per MIXING_RULES.md
    return bestShift <= BPM_LIMITS.MAX_PERMITTED_PCT ? { rate: bestRate, matched: true } : { rate: 1, matched: false };
  }

  public getCrossfader(): number {
    return this.crossfaderPosition;
  }

  public setMasterVolume(vol: number) {
    const clamped = Math.max(0, Math.min(1, vol));
    this.masterGain.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.02);
    this.notify();
  }

  public startTransition(config: TransitionConfig) {
    if (this.isTransitioning || config.sourceDeck === config.targetDeck) return;
    // Target already fully on air (e.g. an AI command naming the playing deck): nothing to mix
    const targetCrossfaderEnd = config.targetDeck === 'B' ? 1.0 : -1.0;
    if (this.crossfaderPosition === targetCrossfaderEnd) return;

    const sourceDeck = config.sourceDeck === 'A' ? this.deckA : this.deckB;
    const targetDeck = config.targetDeck === 'A' ? this.deckA : this.deckB;
    const targetTrack = targetDeck.getTrack();
    if (!targetTrack) return;

    const sourceState = sourceDeck.getPlaybackState();
    const sourceBpm = sourceState.effectiveBpm;

    // Set the incoming rate BEFORE it starts so it never plays a moment at the wrong speed
    this.analyzeTrack(targetTrack);
    const sourceConfidence = sourceState.isPlaying ? sourceState.track?.bpmConfidence ?? 0 : 0;
    const match = this.computeBeatmatchRate(sourceBpm, sourceConfidence, targetTrack);
    targetDeck.setPlaybackRate(match.rate, true);

    // Beatmatched: blend over the mood's bar count (4 Bhangra, 8 Normal/Party, 16 Chill/Romantic).
    // Not matched: a short cut, since unsynced beats flam.
    const blendSeconds = (this.blendBars() * 4 * 60) / sourceBpm;
    let durationSeconds = config.durationSeconds ?? Math.max(4, Math.min(40, blendSeconds));
    if (config.style === 'drop_cut') {
      durationSeconds = config.durationSeconds ?? 0.3;
    } else if (match.matched) {
      const shift = (match.rate - 1) * 100;
      this.acquisitionStatus = `Beatmatched mix at ${sourceBpm} BPM (${shift >= 0 ? '+' : ''}${shift.toFixed(1)}% tempo on the new song, gliding back to normal after).`;
    } else if (sourceState.isPlaying) {
      durationSeconds = Math.min(durationSeconds, UNMATCHED_TRANSITION_SECONDS);
      this.acquisitionStatus = `Tempos too far apart (${sourceBpm} → ${targetTrack.bpm} BPM) — quick cut on the beat at natural pitch.`;
    }

    // Start "on the one": the incoming song's first beat lands exactly on an outgoing beat.
    // Without this, even two songs at identical BPM have kicks that clash (flam).
    // A planned mix starts at its chosen bar of the outgoing song and its chosen entry point.
    let startTime = this.ctx.currentTime + 0.05;
    const isSourcePlaying = sourceState.isPlaying && !!sourceState.track;
    if (!targetDeck.getPlaybackState().isPlaying) {
      // Never start from hook because buildup is also important!
      // Start at musicStartTime (skipping spoken preamble, preserving the musical build-up).
      // Exception: Ping Pong Tremor strictly plays from starting 0:00.
      const isStrict = isStrictStartSong(targetTrack);
      const defaultEntry = isStrict
        ? 0
        : (targetTrack.musicStartTime && targetTrack.musicStartTime > 0
            ? targetTrack.musicStartTime
            : (targetTrack.firstDownbeatTime ?? 0));
      const cuePoint = isStrict ? 0 : (config.targetEntryTime ?? defaultEntry);
      if (isSourcePlaying && config.style !== 'drop_cut') {
        const toPlannedExit =
          config.sourceExitTime !== undefined
            ? (config.sourceExitTime - sourceState.currentTime) / sourceState.playbackRate
            : -1;
        if (toPlannedExit >= 0.05) {
          startTime = this.ctx.currentTime + toPlannedExit;
        } else if (sourceConfidence >= MIN_BEATMATCH_CONFIDENCE) {
          startTime = this.ctx.currentTime + this.secondsToNextBeat(sourceState);
        }
      }
      targetDeck.play(cuePoint, startTime);
    }

    this.isTransitioning = true;
    this.transitionProgress = 0;

    // Schedule the whole mix on the audio clock. requestAnimationFrame stops when the
    // browser tab is hidden, which used to freeze mixes halfway with both songs playing.
    const startCrossfader = this.crossfaderPosition;
    const targetCrossfader = targetCrossfaderEnd;
    const crossfaderAt = (progress: number) => {
      const smooth = progress * progress * (3 - 2 * progress);
      return startCrossfader + (targetCrossfader - startCrossfader) * smooth;
    };

    const curvePoints = 64;
    const curveA = new Float32Array(curvePoints);
    const curveB = new Float32Array(curvePoints);
    for (let i = 0; i < curvePoints; i++) {
      [curveA[i], curveB[i]] = this.equalPowerGains(crossfaderAt(i / (curvePoints - 1)));
    }
    this.crossfaderGainA.gain.cancelScheduledValues(this.ctx.currentTime);
    this.crossfaderGainB.gain.cancelScheduledValues(this.ctx.currentTime);
    this.crossfaderGainA.gain.setValueCurveAtTime(curveA, startTime, durationSeconds);
    this.crossfaderGainB.gain.setValueCurveAtTime(curveB, startTime, durationSeconds);

    // A cut between songs that can't be beatmatched (or the AI's chosen cut): the outgoing song
    // echoes out on its own beat instead of stopping dead
    const isCut = isSourcePlaying && (!match.matched || durationSeconds <= UNMATCHED_TRANSITION_SECONDS + 0.01 || config.style === 'drop_cut');
    if (isCut) {
      sourceDeck.scheduleEchoOut(startTime + durationSeconds / 2, 60 / Math.max(60, sourceBpm));
      this.acquisitionStatus += ' Echo-out on the old song.';
    }

    // Bass swap: outgoing bass fades out over the first half, incoming bass comes in over the second
    if (config.style === 'bass_swap') {
      const midTime = startTime + durationSeconds / 2;
      sourceDeck.scheduleLowRamp(sourceState.lowGain, -24, startTime, midTime);
      targetDeck.scheduleLowRamp(-24, 0, midTime, startTime + durationSeconds);
    }

    this.transitionTimer = window.setInterval(() => {
      const progress = Math.max(0, Math.min(1, (this.ctx.currentTime - startTime) / durationSeconds));
      this.transitionProgress = progress;
      this.crossfaderPosition = crossfaderAt(progress);
      this.activeDeck = this.crossfaderPosition < 0 ? 'A' : 'B';
      if (progress < 1) return;

      window.clearInterval(this.transitionTimer!);
      this.transitionTimer = null;
      this.isTransitioning = false;
      this.activeDeck = config.targetDeck;
      this.applyCrossfader(targetCrossfader);
      sourceDeck.pause();
      sourceDeck.setEQ(0, 0, 0);
      targetDeck.setEQ(0, 0, 0);

      // The new song is on air (the rhythm layer follows it by itself via rhythmClock)
      this.analyzeTrack(targetTrack);
      this.recordSongPlay(targetTrack);
      this.saveCurrentTrackToStorage();
      this.notify();
    }, 100);
    this.notify();
  }

  public cancelTransition() {
    if (this.transitionTimer !== null) {
      window.clearInterval(this.transitionTimer);
      this.transitionTimer = null;
    }
    if (this.isTransitioning) {
      // Freeze the mix where it is instead of letting the scheduled automation finish
      this.isTransitioning = false;
      this.applyCrossfader(this.crossfaderPosition);
      this.deckA.setEQ(0, 0, 0);
      this.deckB.setEQ(0, 0, 0);
    }
    this.transitionProgress = 0;
    this.notify();
  }

  /** The mix waiting for its blend point, for the UI (cheap: no queue or history copying). */
  public getPendingMixInfo(): PendingMixInfo | null {
    const startsIn = this.pendingMixStartsIn();
    if (!this.pendingMix || startsIn === null) return null;
    return {
      id: this.pendingMix.item.id,
      title: this.pendingMix.item.title,
      artist: this.pendingMix.item.artist,
      thumbnail: this.pendingMix.item.thumbnail,
      startsInSeconds: Math.max(0, startsIn),
      entryTime: this.pendingMix.plan.entryTime,
      reason: this.pendingMix.plan.reason,
      targetKey: this.pendingMix.item.key,
      keyFit: this.pendingMix.keyFit,
      harmonicShift: this.pendingMix.harmonicShift,
    };
  }

  /**
   * One-Click Harmonic Queue Reordering:
   * Sorts the Up Next queue into an unbroken, clash-free Camelot wheel harmonic journey.
   * Starts from the currently playing on-air song's key (or deck A/B), preserving any
   * currently in-flight downloading or mixing tracks at position 0.
   */
  public sortQueueHarmonically(): number {
    if (this.queue.length <= 1) return 0;

    // 1. Determine reference key from currently playing on-air song
    const onAirState = this.getOnAirDeck().getPlaybackState();
    const onAirTrack = onAirState.track;
    let refKey = onAirTrack?.key
      ? (this.keyLock ? onAirTrack.key : shiftKey(onAirTrack.key, onAirState.playbackRate))
      : this.queue.find((q) => q.key)?.key;

    // 2. Protect head items if currently active/downloading/mixing
    let startIndex = 0;
    if (
      this.pendingMix ||
      (this.queue[0] &&
        (this.queue[0].status === 'downloading' ||
          this.queue[0].status === 'decoding' ||
          this.queue[0].status === 'tuning'))
    ) {
      startIndex = 1;
      if (this.queue[0].key) refKey = this.queue[0].key;
    }

    if (startIndex >= this.queue.length - 1) return 0;

    const pinnedHead = this.queue.slice(0, startIndex);
    const pool = [...this.queue.slice(startIndex)];
    const sorted: QueuedTrack[] = [];

    while (pool.length > 0) {
      let bestIdx = 0;
      let bestScore = -1;

      for (let i = 0; i < pool.length; i++) {
        const item = pool[i];
        if (!item.key) {
          // Track with key still pending: neutral low score with original queue index tiebreaker
          const score = 0.2 - (i * 0.0001);
          if (score > bestScore) {
            bestScore = score;
            bestIdx = i;
          }
          continue;
        }

        const compat = getHarmonicCompatibility(refKey, item.key);
        // Harmonic score: 1.0 (exact), 0.98 (relative), 0.95 (energy boost +1), 0.92 (deep drop -1), etc.
        // Slight tiebreaker keeps earlier user requests / bangers ahead of same-score tracks
        const score = compat.score - (i * 0.0001);
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }

      const chosen = pool.splice(bestIdx, 1)[0];
      sorted.push(chosen);
      if (chosen.key) {
        refKey = chosen.key;
      }
    }

    this.queue = [...pinnedHead, ...sorted];
    this.saveQueueToStorage();
    this.notify();
    return sorted.length;
  }

  // --- Phone sync (see engine/syncState.ts) ---

  public getSyncState(): HostSyncState {
    return buildSyncState(this);
  }

  public getLiveSyncState(): LiveSyncState {
    return buildLiveSyncState(this);
  }

  public getSyncSignature(): string {
    return syncSignature(this);
  }

  public getOnAirDeck(): VirtualDeck {
    return this.onAirDeck();
  }

  /** How the on-air (or any analysed) song's intro was analysed, for diagnostics. */
  public getIntroAnalysis(trackId: string): IntroAnalysisResult | null {
    return this.introAnalyses.get(trackId) ?? null;
  }

  /** Changes whenever the Most Played list may have changed (see getTopBangers). */
  public getTopBangersKey(): string | undefined {
    return this.topBangersCache?.key;
  }

  // --- History & Favorites Management ---

  public fetchPlayHistory(): Promise<SongHistoryItem[]> {
    return this.library.fetchHistory();
  }

  public async recordSongPlay(track: TrackMetadata) {
    if (track?.url) this.playedUrls.add(track.url);
    if (track && this.recentTitles[this.recentTitles.length - 1] !== track.title) {
      this.recentTitles = [...this.recentTitles, track.title].slice(-5);
    }
    if (!track || track.id.startsWith('demo_') || this.lastRecordedTrackId === track.id) return;
    this.lastRecordedTrackId = track.id;

    this.library.logPlay(track);
    // Drop any other copies of this song waiting in Up Next
    const playedKeys = this.songKeys(track);
    const before = this.queue.length;
    this.queue = this.queue.filter((q) => q.status === 'downloading' || !this.isSameSong(playedKeys, this.songKeys(q)));
    if (this.queue.length !== before) this.saveQueueToStorage();
    this.notify();

    await this.library.postPlay(track);
  }

  public isFavorite(song?: { id?: string; title?: string; url?: string } | null): boolean {
    return this.library.isFavorite(song);
  }

  public toggleFavorite(song?: Parameters<SongLibrary['toggleFavorite']>[0]): Promise<boolean> {
    return this.library.toggleFavorite(song);
  }

  public isDontPlayAgain(song?: { id?: string; title?: string; artist?: string; url?: string } | null): boolean {
    return this.library.isBanned(song);
  }

  /** Thumbs down: never play this song again (removed from Up Next, skipped if on air). Again to undo. */
  public async toggleDontPlayAgain(song?: Parameters<SongLibrary['toggleBanned']>[0] | null): Promise<boolean> {
    if (!song || (!song.id && !song.title && !song.url)) return false;
    const { banned, title, synced } = this.library.toggleBanned(song);
    if (!banned) {
      this.acquisitionStatus = `Removed "${title}" from Don't Play Again Ever.`;
    } else {
      this.acquisitionStatus = `Saved "${title}" in "Don't Play Again Ever".`;
      // 1. Immediately purge any copies from Up Next
      const before = this.queue.length;
      this.queue = this.queue.filter((q) => !this.isDontPlayAgain(q));
      if (this.queue.length !== before) this.saveQueueToStorage();

      // 2. If it's on air or currently playing on any deck, instantly change the song too!
      const onAirTrack = this.onAirDeck().getTrack();
      const deckATrack = this.deckA.getTrack();
      const deckBTrack = this.deckB.getTrack();
      const isPlayingA = this.deckA.getPlaybackState().isPlaying;
      const isPlayingB = this.deckB.getPlaybackState().isPlaying;

      const matchesBanned = (t?: TrackMetadata | null) => {
        if (!t) return false;
        return (
          this.isDontPlayAgain(t) ||
          (song && song.title ? isSameSong(songKeys({ title: song.title, artist: song.artist, url: song.url }), songKeys(t)) : false)
        );
      };

      const isCurrentPlayingDisliked =
        matchesBanned(onAirTrack) ||
        (isPlayingA && matchesBanned(deckATrack)) ||
        (isPlayingB && matchesBanned(deckBTrack));

      if (isCurrentPlayingDisliked) {
        console.log(`[AudioEngine] Currently playing "${title}" was disliked (Thumbs Down) — changing song instantly.`);
        this.skipDislikedCurrentTrack(title);
      }
    }
    this.notify();
    return synced;
  }

  /**
   * Instantly changes the currently playing song when the user clicks Dislike on it.
   * Cancels any slow mix plans or transitions and immediately cuts/mixes into the next queued song.
   */
  public skipDislikedCurrentTrack(_dislikedTitle?: string): boolean {
    if (this.isTransitioning) {
      this.cancelTransition();
    }

    // Cancel pending slow mix if any
    let pendingItem: QueuedTrack | null = null;
    if (this.pendingMix) {
      pendingItem = this.pendingMix.item;
      window.clearTimeout(this.pendingMix.timer);
      this.pendingMix = null;
    }

    // 1. If a planned mix item exists and isn't disliked, cut into it immediately!
    if (pendingItem && !this.isDontPlayAgain(pendingItem)) {
      this.acquisitionStatus = `Disliked song skipped — cutting immediately to "${pendingItem.title}"!`;
      this.startQueuedMixNow(pendingItem, 0.3, 'drop_cut');
      this.notify();
      return true;
    }

    // 2. Find the first ready track in the queue with a decoded buffer
    const nextReady = this.queue.find((q) => q.status === 'ready' && q.audioBuffer);
    if (nextReady) {
      this.acquisitionStatus = `Disliked song skipped — cutting immediately to "${nextReady.title}"!`;
      this.startQueuedMixNow(nextReady, 0.3, 'drop_cut');
      this.notify();
      return true;
    }

    // 3. Next, check if a track can stream right away
    const nextStream = this.queue.find((q) => q.status !== 'failed' && this.canStream(q));
    if (nextStream) {
      this.deckA.pause();
      this.deckB.pause();
      this.acquisitionStatus = `Disliked song skipped — streaming "${nextStream.title}" immediately!`;
      this.startStreaming(nextStream);
      this.notify();
      return true;
    }

    // 4. If next song is loading/downloading in queue
    const nextLoading = this.queue.find((q) => q.status !== 'failed');
    if (nextLoading) {
      this.deckA.pause();
      this.deckB.pause();
      this.acquisitionStatus = `Disliked song stopped — loading "${nextLoading.title}" to play next...`;
      this.notify();
      void this.ensureTrackBuffer(nextLoading).then((buf) => {
        if (buf) this.startQueuedMixNow(nextLoading, 0.3, 'drop_cut');
      });
      return true;
    }

    // 5. Queue is empty: stop playing decks immediately
    this.deckA.pause();
    this.deckB.pause();
    this.acquisitionStatus = 'Disliked song stopped. Up Next queue is empty — searching for new songs...';
    this.notify();
    void this.populateQueueTo50();
    return true;
  }

  public async playStarterSong(songId: string) {
    const song = this.library.history.find((s) => s.id === songId) || this.favorites.find((s) => s.id === songId);
    if (!song) return;

    const query = song.url || `${song.title} ${song.artist}`;
    this.acquisitionStatus = `Starting party with: "${song.title}"...`;
    this.notify();
    await this.acquireTrack(query, true);
  }

  public async loadSongsFromTextFile(): Promise<{ count: number; songs: string[] }> {
    try {
      this.acquisitionStatus = 'Reading songs from my_songs.txt...';
      this.notify();

      const res = await fetch('/api/my-songs');
      if (!res.ok) throw new Error('Could not read my_songs.txt');
      const data = await res.json();
      const songs: string[] = data.songs || [];

      if (songs.length === 0) {
        this.acquisitionStatus = 'No songs found in my_songs.txt';
        this.notify();
        return { count: 0, songs: [] };
      }

      this.acquisitionStatus = `Found ${songs.length} songs in my_songs.txt. Loading...`;
      this.notify();

      const curDeck = this.activeDeck === 'A' ? this.deckA : this.deckB;
      const curTrack = curDeck.getTrack();
      const isPlayingRealTrack = curDeck.getPlaybackState().isPlaying && curTrack && !curTrack.id.startsWith('demo_');

      // Leave out songs played in the last hour
      const fresh = songs.filter((s) => this.lastPlayedWithinHour({ title: s, url: s }) === null);
      const skipped = songs.length - fresh.length;

      let next = 0;
      if (!isPlayingRealTrack) {
        // Start the set with the first song that can actually be fetched
        while (next < fresh.length && !(await this.acquireTrack(fresh[next++], true, 'back', 'playlist'))) {
          // try the next line
        }
      }

      // Download the rest one at a time, in file order, so the set isn't starved of bandwidth
      const remaining = fresh.slice(next);
      void (async () => {
        for (const song of remaining) {
          await this.acquireTrack(song, false, 'back', 'playlist');
        }
      })();

      this.acquisitionStatus = `Loading ${fresh.length} songs from my_songs.txt in order...${
        skipped ? ` (${skipped} skipped: played in the last hour)` : ''
      }`;
      this.notify();
      return { count: songs.length, songs };
    } catch (err) {
      console.error('Error loading songs from text file:', err);
      this.acquisitionStatus = `Failed to load my_songs.txt: ${String(err)}`;
      this.notify();
      return { count: 0, songs: [] };
    }
  }

  public jumpToHook(deckId?: DeckId) {
    const targetId = deckId || this.activeDeck;
    const deck = targetId === 'A' ? this.deckA : this.deckB;
    deck.jumpToHighlight();
    this.afterSeek();
    this.notify();
  }

  /** Best Parts mode for a dancing crowd: each song plays its build-up and hook, then mixes out. Remembered. */
  public toggleBestParts() {
    this.bestPartsMode = !this.bestPartsMode;
    try {
      window.localStorage.setItem(BEST_PARTS_KEY, this.bestPartsMode ? '1' : '0');
    } catch {
      // storage unavailable
    }
    // The AI's ahead-of-time answers were for the old mix-out point; a mix already planned stands
    this.aiOutroPrep = null;
    this.acquisitionStatus = this.bestPartsMode
      ? 'Best Parts ON: each song plays its build-up and hook (about 1–1.5 min), then mixes into the next.'
      : 'Best Parts OFF: songs play through to their outro again.';
    this.notify();
  }

  /** Up Next from the offline library only (e.g. a venue with bad Wi-Fi). Remembered. */
  public toggleOfflineOnly() {
    this.offlineOnly = !this.offlineOnly;
    try {
      window.localStorage.setItem(OFFLINE_ONLY_KEY, this.offlineOnly ? '1' : '0');
    } catch {
      // storage unavailable
    }
    this.acquisitionStatus = this.offlineOnly
      ? 'Offline only: Up Next now comes from the songs on this laptop.'
      : 'Online again: Up Next uses internet recommendations.';
    // Refill from the right source straight away
    this.lastRefillAttemptAt = 0;
    this.notify();
  }

  public toggleAutoCuration() {
    this.autoCurationEnabled = !this.autoCurationEnabled;
    this.notify();
  }

  private handleDeckUpdate(_deckId: DeckId) {
    this.notify();
  }

  private generateSyntheticPeaks(count: number, type: 'anthem' | 'banger'): number[] {
    const peaks: number[] = [];
    for (let i = 0; i < count; i++) {
      const beat = (i % 8) / 8;
      const kick = beat === 0 ? 0.9 : 0.2;
      const variation = Math.sin(i / 10) * 0.2 + (type === 'anthem' ? 0.4 : 0.5);
      peaks.push(Number(Math.min(1.0, kick + variation).toFixed(3)));
    }
    return peaks;
  }

  private notify() {
    if (this.onEngineUpdate) {
      this.onEngineUpdate();
    }
  }
}
