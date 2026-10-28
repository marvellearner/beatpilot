import { VirtualDeck } from './VirtualDeck';
import { PercussionDeck } from './PercussionDeck';
import {
  DeckId,
  TransitionConfig,
  QueuedTrack,
  HostSyncState,
  TrackMetadata,
  SongHistoryItem,
  FavoriteSong,
  TempoInfo,
  PlayLogEntry,
} from '../types';
import { detectBpmFromBuffer, BpmAnalysisResult } from './BpmDetector';
import { evaluatePercussionForTrack, PercussionDecision } from '../ai/PercussionAdvisor';
import { HighlightDetector } from './HighlightDetector';
import { computeEnergyProfile, planMix, MixPlan, MixSongInfo } from './MixPointPlanner';
import { EQ_BANDS, EQ_MAX_DB, EQ_MIN_DB, EqBandId, EqGains, MoodId, getMood } from './Moods';
import { stretchAudioBuffer } from './stretchInWorker';
import { songKeys, isSameSong, type SongRef } from './songMatch';
import { OllamaDJAgent } from '../ai/OllamaDJAgent';
import { IntroSkitDetector, type IntroAnalysisResult } from './IntroSkitDetector';

const SOUND_SETTINGS_KEY = 'ai_dj_sound_settings';
const PLAY_LOG_KEY = 'ai_dj_play_log';
const CURRENT_TRACK_KEY = 'ai_dj_current_track';
// Up Next never auto-adds a song played within the last hour
const NO_REPEAT_WINDOW_MS = 60 * 60 * 1000;
const PLAY_LOG_MAX = 100;
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
const PLAN_STABLE_SECONDS = 2.5; // stop ramping tempo this close to a planned mix so timing is exact
// Tempo glide speed for both the pre-mix ramp and the return to natural pitch (0.4% per second)
const PITCH_RETURN_PER_SECOND = 0.004;
// Key-locked stretching (WSOLA) sounds clean up to about ±25%
const MAX_KEYLOCK_STRETCH = 0.25;
// Tempo control range for the on-air song
const MIN_TEMPO = 0.5;
const MAX_TEMPO = 1.25;
const MIN_QUEUE_TARGET = 45; // Maintain ~50 songs in queue at all times
const MAX_QUEUE_TARGET = 50; // Up Next queue capacity (50 songs)

export class AudioEngine {
  public ctx: AudioContext;

  // Decks
  public deckA: VirtualDeck;
  public deckB: VirtualDeck;
  public percussionDeck: PercussionDeck;

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
  public autoCurationEnabled: boolean = true;
  public autoPercussionEnabled: boolean = false; // Stopped background music/drums per user preference
  public autoCueViralHook: boolean = false; // Never start from hook by default (buildup is important)
  public percussionDecisionReason: string = 'Background drums/orchestra paused per user preference';
  private isFetchingRecommendations: boolean = false;
  private lastRefillAttemptAt: number = 0;
  private isPreloadingNext: boolean = false;
  // Songs already played this session, so auto-curation doesn't repeat them
  private playedUrls = new Set<string>();
  // Every play with its time (kept across reloads): "Previously played" + the 1-hour no-repeat rule
  public playLog: PlayLogEntry[] = [];
  // Recent intro-skip analyses by track id, for diagnosing songs on real audio
  private introAnalyses = new Map<string, IntroAnalysisResult>();
  // Drums the user had running when they paused, restarted on play
  private resumePercussionOnPlay: boolean = false;

  // In-memory audio buffer cache (avoids re-downloading or re-rendering songs)
  private audioBufferCache = new Map<string, { buffer: AudioBuffer; metadata: TrackMetadata }>();

  // User History & Favorite Starters
  private rawMostPlayedSongs: SongHistoryItem[] = [];

  /**
   * Top Bangers (Most Played Songs) — strictly excludes any song that is currently
   * in the Up Next queue, currently on-air, or present in Previously Played history.
   */
  public get mostPlayedSongs(): SongHistoryItem[] {
    return this.getTopBangers();
  }

  public set mostPlayedSongs(items: SongHistoryItem[]) {
    this.rawMostPlayedSongs = Array.isArray(items) ? items : [];
  }

  public get rawMostPlayedSongsList(): SongHistoryItem[] {
    return this.rawMostPlayedSongs;
  }
  public favorites: FavoriteSong[] = [];
  private lastRecordedTrackId: string | null = null;

  // A mix waiting for its planned blend point (the song is out of the queue meanwhile)
  private pendingMix: {
    item: QueuedTrack;
    plan: MixPlan;
    durationSeconds?: number;
    timer: number;
    style?: 'blend' | 'cut'; // set by the AI DJ
    blendBars?: number; // set by the AI DJ
  } | null = null;

  // AI DJ brain: Gemini cloud primary with local Ollama offline backup
  public djAgent = new OllamaDJAgent();
  public aiStatus: 'checking' | 'online' | 'offline' = 'checking';
  public aiProvider: 'gemini' | 'ollama' | 'none' = 'none';
  public aiModelName: string = '';
  public lastAiDecision: string = '';
  // Disk Cache stats (cache/audio directory on disk)
  public diskCacheCount: number = 0;
  public diskCacheMb: number = 0;
  private choosingNextSong = false;
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
    this.deckA = new VirtualDeck('A', this.ctx, this.crossfaderGainA);
    this.deckB = new VirtualDeck('B', this.ctx, this.crossfaderGainB);

    // Percussion Deck joins the master bus directly (independent of crossfader!)
    this.percussionDeck = new PercussionDeck(this.ctx, this.masterBus);
    this.percussionDeck.stop(); // Ensure completely stopped and silent on startup

    // Set initial crossfader to 100% Deck A
    this.applyCrossfader(-1);

    // Forward deck updates
    this.deckA.onStateUpdate = () => this.handleDeckUpdate('A');
    this.deckB.onStateUpdate = () => this.handleDeckUpdate('B');
    this.percussionDeck.onStateUpdate = () => this.notify();

    // Restore the last mood and EQ the user chose
    this.loadSoundSettings();

    // Load persisted most played song history
    this.fetchPlayHistory();

    // Load persisted favorites (localStorage + sync with server)
    this.loadFavorites();

    // What played recently (before the queue is restored, so it can skip those songs)
    this.loadPlayLog();

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
    this.aiModelName = health.model || (health.provider === 'gemini' ? 'Gemini Flash' : 'Qwen 2.5 3B');
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
   * One-tap party mood: sets the EQ preset, blend length, hook cueing and (for Bhangra)
   * the AI dhol, and steers auto-curation toward the mood.
   */
  public setMood(moodId: MoodId) {
    const mood = getMood(moodId);
    this.mood = mood.id;
    this.applyEq(mood.eq);
    this.autoCueViralHook = mood.hookCue;
    if (mood.autoDrums && !this.autoPercussionEnabled) this.toggleAutoPercussion();
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

  /** Sets the on-air song to an exact BPM (e.g. typed in by the user). */
  public setBpm(bpm: number) {
    const info = this.getTempoInfo();
    if (info && bpm > 0) {
      // In Party mood: never decrease BPM below original natural BPM
      if (this.mood === 'party' && bpm < info.naturalBpm - 0.5) {
        this.acquisitionStatus = `Party mood: cannot decrease BPM below original ${Math.round(info.naturalBpm)} BPM to protect dancefloor energy.`;
        this.notify();
        return;
      }
      this.setTempo(bpm / info.naturalBpm);
    } else if (bpm > 0) {
      this.sessionBpm = bpm;
      this.notify();
    }
  }

  /**
   * Plays the on-air song at `ratio` × its natural tempo (0.5x – 1.25x).
   * Key lock on: the audio is re-timed so the pitch stays the same (takes ~1 s, swapped in
   * seamlessly at the same musical position). Key lock off: vinyl style, pitch follows speed.
   */
  public async setTempo(ratio: number, options: { fromSetTempo?: boolean; fromOriginalToggle?: boolean } = {}) {
    // Picking a speed by hand means the user no longer wants the original tempo
    if (!options.fromSetTempo && !options.fromOriginalToggle) this.playOriginal = false;
    const deck = this.onAirDeck();
    const track = deck.getTrack();
    if (!track?.audioBuffer) return;
    if (this.isTransitioning) {
      this.acquisitionStatus = 'Tempo can be changed once the current mix finishes.';
      this.notify();
      return;
    }
    let target = Math.max(MIN_TEMPO, Math.min(MAX_TEMPO, Math.round(ratio * 1000) / 1000));
    // In Party mood: NEVER decrease BPM of original song (speed ratio must be >= 1.0)
    if (this.mood === 'party' && target < 1.0) {
      target = 1.0;
      this.acquisitionStatus = 'Party mood: cannot decrease BPM below original to protect dancefloor energy.';
      this.notify();
    }
    this.rememberOriginal(track);
    const job = ++this.tempoJob;

    if (!this.keyLock) {
      // Vinyl: natural audio, speed and pitch move together
      if ((track.tempoRatio ?? 1) !== 1) this.swapDeckAudio(deck, track, track.originalBuffer!, 1);
      deck.setPlaybackRate(target, false);
    } else {
      this.tempoBusy = true;
      this.acquisitionStatus = `Tuning to ${(track.original!.bpm * target).toFixed(1)} BPM (key lock: pitch unchanged)…`;
      this.notify();
      let stretched: AudioBuffer;
      try {
        stretched =
          Math.abs(target - 1) < 0.002 ? track.originalBuffer! : await stretchAudioBuffer(this.ctx, track.originalBuffer!, target);
      } catch (err) {
        console.warn('Key-locked tempo change failed:', err);
        if (job === this.tempoJob) this.tempoBusy = false;
        this.acquisitionStatus = 'Could not change the tempo with key lock. Try again, or turn key lock off.';
        this.notify();
        return;
      }
      // A newer tempo request, a new song, or a mix may have happened while stretching
      if (job !== this.tempoJob) return;
      this.tempoBusy = false;
      if (deck.getTrack() !== track || this.isTransitioning) {
        this.notify();
        return;
      }
      this.swapDeckAudio(deck, track, stretched, target);
      deck.setPlaybackRate(1, false);
    }

    // "Keep whole set at this BPM": a tempo the user picks becomes the set tempo too.
    // (Not when the engine is tuning the song to the set tempo itself.)
    const newBpm = Math.round(track.original!.bpm * target * 10) / 10;
    if (this.sessionBpm !== null && !options.fromSetTempo && !options.fromOriginalToggle) this.sessionBpm = newBpm;

    const pct = (target - 1) * 100;
    this.acquisitionStatus = options.fromOriginalToggle
      ? `Playing "${track.title}" at its original ${newBpm} BPM.`
      : options.fromSetTempo
      ? `Tuned "${track.title}" to ${newBpm} BPM for the set tempo (key lock, pitch unchanged)${
          Math.abs(newBpm - (this.sessionBpm ?? newBpm)) > 1 ? ` — as close to ${this.sessionBpm} as it can go cleanly` : ''
        }.`
      : `Tempo ${target.toFixed(2)}x (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%) = ${newBpm} BPM, ${this.keyLock ? 'key lock on' : 'vinyl mode (pitch follows speed)'}${this.sessionBpm !== null ? ', whole set follows' : ''}.`;
    if (this.percussionDeck.getState().isPlaying) this.startPercussionInSync();
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
    return Math.max(1 - MAX_KEYLOCK_STRETCH, Math.min(1 + MAX_KEYLOCK_STRETCH, ratio));
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
    return Math.abs(ratio - 1) <= MAX_KEYLOCK_STRETCH ? this.sessionBpm : null;
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
        Object.assign(item, { bpm: original.bpm, duration: original.duration, firstDownbeatTime: original.firstDownbeatTime, highlightTime: original.highlightTime, cueInTime: original.cueInTime, musicStartTime: original.musicStartTime });
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
      this.autoCueViralHook = getMood(this.mood).hookCue;
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
    const remaining = curState.duration - curState.currentTime;
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
    }

    // Re-check the AI DJ every minute (Ollama may have been started or stopped)
    if (++this.loopTicks % 60 === 0) this.refreshAiStatus();
    // Update disk cache stats every 30 seconds
    if (this.loopTicks % 30 === 0) this.refreshCacheStatus();
    // Keep browser memory ultra-lean by releasing buffers for songs far down the queue
    if (this.loopTicks % 10 === 0) this.pruneBrowserMemory();
    // Keep Up Next free of songs played in the last hour (history may load after the queue)
    if (this.loopTicks % 15 === 0) this.dropRecentlyPlayedFromQueue();

    // 2. Autonomous Queue Refill from Internet (failed songs don't count;
    // maintain at least MIN_QUEUE_TARGET (~50) songs in queue at all times;
    // retry at most every 10 s so an unproductive search doesn't hammer YouTube/Ollama)
    const usableQueueLength = this.queue.filter((q) => q.status !== 'failed').length;
    if (
      this.autoCurationEnabled &&
      usableQueueLength < MIN_QUEUE_TARGET &&
      !this.isFetchingRecommendations &&
      Date.now() - this.lastRefillAttemptAt > 10_000
    ) {
      const seedTrack = curTrack || (this.queue[0] ? this.queuedItemToTrack(this.queue[0]) : null);
      if (seedTrack) {
        this.refillQueueWithRecommendations(seedTrack);
      }
    }

    // 3. Dynamic Arrangement & Real-time Beat/Phase Sync Guard
    if (curState.isPlaying && curTrack) {
      if (this.percussionDeck.getState().isPlaying) {
        // Continuous BPM tracking across tempo glides / set tempo shifts
        if (Math.abs(this.percussionDeck.getState().currentBpm - curState.effectiveBpm) > 0.05) {
          this.percussionDeck.syncBpm(curState.effectiveBpm);
        }
      }

      // Dynamic Arrangement ("Cherry on Top" Rule):
      // Keep live percussion ducked/subtle during slow verses, and unleash full power right on the viral hook drop!
      if (curTrack.highlightTime) {
        const timeToHook = curTrack.highlightTime - curState.currentTime;
        if (timeToHook > 4 && curState.currentTime < curTrack.highlightTime) {
          this.percussionDeck.setDucked(true);
        } else {
          this.percussionDeck.setDucked(false);
          if (curState.currentTime >= curTrack.highlightTime && curState.currentTime <= curTrack.highlightTime + 25) {
            this.percussionDeck.setIntensity(1.3);
          }
        }
      }
    }

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
    return gap <= MAX_OUTGOING_RAMP + MAX_INCOMING_SHIFT;
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
      duration: track.duration,
      hookTime: track.highlightTime,
      musicStartTime: track.musicStartTime,
    };
  }

  /**
   * Looks up to `lookAheadSeconds` into the on-air song for the best bar to start blending,
   * and picks the incoming song's entry point, then waits for that moment.
   * Falls back to an immediate mix when no plan is possible (e.g. too close to the end).
   */
  private planMixInto(itemId: string, lookAheadSeconds: number, durationSeconds?: number): boolean {
    const item = this.queue.find((q) => q.id === itemId);
    if (!item || !item.audioBuffer) return false;

    const outState = this.onAirDeck().getPlaybackState();
    const outTrack = outState.track;
    const incoming = this.queuedItemToTrack(item);
    this.analyzeTrack(incoming);
    this.copyAnalysisToQueueItem(incoming, item);
    if (outTrack) this.analyzeTrack(outTrack);

    const outInfo = outTrack ? this.mixSongInfo(outTrack) : null;
    const incInfo = this.mixSongInfo(incoming);
    const plan =
      outTrack && outInfo && incInfo
        ? planMix({
            out: outInfo,
            inc: incInfo,
            outPosition: outState.currentTime,
            blendBeats: this.canBeatmatch(outTrack, incoming) ? this.blendBars() * 4 : 4,
            lookAheadSeconds,
            minLeadSeconds: 1.5,
            preferIncomingHook: false, // Never start from hook because build up is also important
          })
        : null;
    if (!plan) return this.startQueuedMixNow(item, durationSeconds);

    this.queue = this.queue.filter((q) => q.id !== itemId);
    this.pendingMix = { item, plan, durationSeconds, timer: 0 };
    this.schedulePendingMix();
    const startsIn = this.pendingMixStartsIn() ?? 0;
    this.acquisitionStatus = `Mixing into "${item.title}" in ${Math.round(startsIn)}s (following MIXING_RULES.md): ${plan.reason}. Click Mix Now to mix immediately.`;
    this.notify();

    // Let the AI DJ refine the choice in the background; the analysis' plan stands if it's slow
    if (this.aiStatus === 'online' && outTrack && !durationSeconds) {
      void this.askAiToRefineMix(outTrack, incoming);
    }
    return true;
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
    const outState = this.onAirDeck().getPlaybackState();
    const canBlend = this.canBeatmatch(outTrack, incoming);
    const { plan } = pending;

    const decision = await this.djAgent.chooseMix({
      mood: getMood(this.mood).label.toLowerCase(),
      sessionBpm: this.sessionBpm,
      current: { title: outTrack.title, artist: outTrack.artist, bpm: outState.effectiveBpm, position: outState.currentTime, duration: outState.duration },
      next: { title: incoming.title, artist: incoming.artist, bpm: incoming.bpm, keyLocked: pending.item.tempoLockedTo !== undefined },
      canBlend,
      exitOptions: plan.exitOptions.map((o) => ({ inSeconds: (o.time - outState.currentTime) / outState.playbackRate, at: o.time, why: o.why })),
      entryOptions: plan.entryOptions.map((o) => ({ at: o.time, why: o.why })),
    });
    // Ignore a late answer: the mix may have started, been cancelled, or replaced
    if (!decision || this.pendingMix !== pending || this.isTransitioning) return;

    const exit = plan.exitOptions[decision.exit - 1];
    const entry = plan.entryOptions[decision.entry - 1];
    const now = this.onAirDeck().getPlaybackState();
    const exitStillAhead = (exit.time - now.currentTime) / now.playbackRate > PLAN_STABLE_SECONDS + 0.5;
    const currentStillAhead = (plan.exitTime - now.currentTime) / now.playbackRate > PLAN_STABLE_SECONDS + 0.5;
    if (!currentStillAhead) return; // too close to the planned start to change anything safely

    pending.plan = {
      ...plan,
      exitTime: exitStillAhead ? exit.time : plan.exitTime,
      entryTime: entry.time,
      reason: `🤖 ${decision.reason}`,
    };
    pending.style = decision.style;
    pending.blendBars = decision.bars;
    this.schedulePendingMix();

    const startsIn = Math.round(this.pendingMixStartsIn() ?? 0);
    const how = decision.style === 'cut' ? 'cut on the beat' : `${decision.bars}-bar blend`;
    this.lastAiDecision = `${decision.reason} (${how})`;
    this.acquisitionStatus = `🤖 AI DJ: ${decision.reason} — ${how} into "${pending.item.title}" in ${startsIn}s (following MIXING_RULES.md). Click Mix Now to mix immediately.`;
    this.notify();
  }

  /**
   * End-of-song auto-mix. With several songs ready, the AI DJ picks the one that flows best;
   * otherwise (or if it's slow/offline) the queue order is used.
   */
  private async planOutroMix(current: TrackMetadata) {
    const ready = this.queue.filter((q) => q.status === 'ready' && q.audioBuffer).slice(0, 3);
    if (ready.length === 0) return;
    let choice = ready[0];

    if (ready.length > 1 && this.aiStatus === 'online') {
      this.choosingNextSong = true;
      this.acquisitionStatus = '🤖 AI DJ is choosing the next song…';
      this.notify();
      const decision = await this.djAgent.chooseNextSong({
        mood: getMood(this.mood).label.toLowerCase(),
        sessionBpm: this.sessionBpm,
        current: { title: current.title, artist: current.artist, bpm: current.bpm },
        recentlyPlayed: this.recentTitles.slice(-3),
        options: ready.map((q) => ({ title: q.title, artist: q.artist, bpm: q.bpm ?? 0, requested: !q.isAiRecommended })),
      });
      this.choosingNextSong = false;
      if (decision) {
        choice = ready[decision.pick - 1];
        this.lastAiDecision = `Next: "${choice.title}" — ${decision.reason}`;
      }
      // The world may have moved on while the model was thinking
      if (this.pendingMix || this.isTransitioning || !this.queue.includes(choice) || choice.status !== 'ready') return;
    }

    const state = this.onAirDeck().getPlaybackState();
    if (!state.isPlaying) return;
    this.planMixInto(choice.id, state.duration - state.currentTime);
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
    (targetDeckId === 'A' ? this.deckA : this.deckB).loadTrack(this.queuedItemToTrack(pending.item));
    this.startTransition({
      sourceDeck: this.activeDeck,
      targetDeck: targetDeckId,
      durationSeconds,
      style: 'bass_swap',
      syncPercussion: true,
      sourceExitTime: exitNow ? undefined : pending.plan.exitTime,
      targetEntryTime: pending.plan.entryTime,
    });
  }

  /** Drops a planned mix and puts its song back at the front of the queue. */
  public cancelPendingMix(status: string = 'Planned mix cancelled.') {
    if (!this.pendingMix) return;
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
      const res = await fetch(
        `/api/recommend?title=${encodeURIComponent(current.title)}&artist=${encodeURIComponent(current.artist)}&mood=${this.mood}`
      );
      if (res.ok) {
        const data = await res.json();
        const recs: Array<{ title: string; url: string; author: string; duration: number; thumbnail: string }> =
          data.recommendations || [];

        for (const item of recs) {
          if (this.queue.filter((q) => q.status !== 'failed').length >= MAX_QUEUE_TARGET) break;
          // Avoid duplicates of the queue, the current song, and songs already played this session
          const isDuplicate =
            this.playedUrls.has(item.url) ||
            item.url === current.url ||
            item.title.toLowerCase() === current.title.toLowerCase() ||
            this.queue.some((q) => q.url === item.url || q.title.toLowerCase() === item.title.toLowerCase()) ||
            this.lastPlayedWithinHour({ title: item.title, artist: item.author, url: item.url }) !== null;
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
            });
          }
        }
        this.saveQueueToStorage();
        this.notify();
      }
    } catch (err) {
      console.warn('Failed to fetch recommendations:', err);
    } finally {
      this.isFetchingRecommendations = false;
    }
  }

  private async preloadQueuedTrack(item: QueuedTrack) {
    this.isPreloadingNext = true;
    item.status = 'downloading';
    this.notify();

    try {
      let streamUrl = item.url;
      const isDirectUrl = streamUrl.startsWith('http://') || streamUrl.startsWith('https://');
      if (!isDirectUrl) {
        // Resolve raw song title / query to YouTube stream URL via /api/search
        const query = item.title + (item.artist && item.artist !== 'Artist' ? ' ' + item.artist : '');
        const searchRes = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          if (searchData.results && searchData.results.length > 0) {
            const match = searchData.results[0];
            item.url = match.url;
            item.title = match.title;
            item.artist = match.author;
            item.thumbnail = match.thumbnail;
            item.duration = match.duration;
            item.highlightTime = match.highlightTime;
            streamUrl = match.url;
          }
        }
      }

      // A playlist line can resolve to a song that just played: don't auto-queue it again within the hour
      if (item.source !== 'request' && this.lastPlayedWithinHour(item) !== null) {
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
    this.notify();
    window.setTimeout(() => {
      this.queue = this.queue.filter((q) => q !== item);
      this.saveQueueToStorage();
      this.notify();
    }, 8000);
  }

  // --- Play log: "Previously played" and no repeats within an hour ---

  private loadPlayLog() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(PLAY_LOG_KEY) || '[]');
      if (Array.isArray(saved)) this.playLog = saved.filter((e) => e && typeof e.playedAt === 'number');
    } catch {
      // Ignore corrupt or unavailable storage
    }
  }

  private savePlayLog() {
    try {
      window.localStorage.setItem(PLAY_LOG_KEY, JSON.stringify(this.playLog.slice(0, PLAY_LOG_MAX)));
    } catch {
      // Storage unavailable: the log just won't survive a reload
    }
  }

  private songKeys(song: SongRef): string[] {
    return songKeys(song);
  }

  private isSameSong(a: string[], b: string[]): boolean {
    return isSameSong(a, b);
  }

  /** Checks whether a song matches any song in the Up Next queue, Previously Played, or on-air decks. */
  public isSongInQueueOrPlayed(song: { id?: string; title?: string; artist?: string; url?: string }): boolean {
    if (!song) return false;
    const sId = song.id;
    const sUrl = song.url;
    const sTitle = (song.title || '').trim().toLowerCase();
    const sKeys = song.title ? this.songKeys({ title: song.title, artist: song.artist, url: song.url }) : [];

    const matches = (other?: { id?: string; title?: string; artist?: string; url?: string } | null): boolean => {
      if (!other) return false;
      if (sId && other.id && sId === other.id) return true;
      if (sUrl && other.url && sUrl === other.url) return true;
      if (sTitle && other.title && sTitle === other.title.trim().toLowerCase()) return true;
      if (sKeys.length > 0 && other.title && this.isSameSong(sKeys, this.songKeys({ title: other.title, artist: other.artist, url: other.url }))) return true;
      return false;
    };

    // 1. Check Up Next queue (and pending mix)
    for (const q of this.queue) {
      if (matches(q)) return true;
    }
    if (this.pendingMix && matches(this.pendingMix.item)) {
      return true;
    }

    // 2. Check Previously Played log
    for (const p of this.playLog) {
      if (matches(p)) return true;
    }

    // 3. Check Currently on air decks
    if (matches(this.deckA.getTrack())) return true;
    if (matches(this.deckB.getTrack())) return true;

    return false;
  }

  /** Returns top party bangers filtered to never include songs in queue, previously played, or on air. */
  public getTopBangers(): SongHistoryItem[] {
    return this.rawMostPlayedSongs.filter((song) => !this.isSongInQueueOrPlayed(song));
  }

  /** When the song last played within the no-repeat window (ms timestamp), or null. */
  public lastPlayedWithinHour(song: { title: string; artist?: string; url?: string }): number | null {
    const since = Date.now() - NO_REPEAT_WINDOW_MS;
    const keys = this.songKeys(song);
    const fromLog = this.playLog.find((e) => e.playedAt >= since && this.isSameSong(keys, this.songKeys(e)));
    if (fromLog) return fromLog.playedAt;
    // Also the server-side history, in case this browser's log was cleared
    const fromHistory = this.rawMostPlayedSongs.find(
      (h) => h.lastPlayed >= since && this.isSameSong(keys, this.songKeys(h))
    );
    return fromHistory ? fromHistory.lastPlayed : null;
  }

  /**
   * 1-hour rule for a song being added: playlist songs played recently are skipped (removed,
   * returns false); a song the user asked for is allowed but flagged with when it last played.
   */
  private allowRecentlyPlayed(item: QueuedTrack): boolean {
    const lastPlayed = this.lastPlayedWithinHour(item);
    if (lastPlayed === null) return true;
    const minutes = Math.max(1, Math.round((Date.now() - lastPlayed) / 60000));
    if (item.source === 'request') {
      item.lastPlayedAt = lastPlayed;
      this.acquisitionStatus = `Note: "${item.title}" was played ${minutes} min ago — adding it because you asked.`;
      return true;
    }
    this.queue = this.queue.filter((q) => q !== item);
    this.saveQueueToStorage();
    this.acquisitionStatus = `Skipped "${item.title}": played ${minutes} min ago (no repeats within an hour).`;
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
    this.queue = this.queue.filter((q) => q.id !== itemId);
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
        status: (q.status === 'ready' || q.status === 'queued') ? 'queued' : q.status,
        isAiRecommended: q.isAiRecommended,
        source: q.source,
        lastPlayedAt: q.lastPlayedAt,
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
            const onAirTrack = this.onAirDeck().getTrack();
            if (onAirTrack) {
              this.queue = this.queue.filter(
                (q) => q.id !== onAirTrack.id && q.url !== onAirTrack.url && q.title.toLowerCase() !== onAirTrack.title.toLowerCase()
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

    // 2. If queue has fewer than MIN_QUEUE_TARGET (12) songs (including on first boot or from a short saved queue),
    // automatically top up from my_songs.txt so the queue ALWAYS has > 10 songs at any point of time!
    if (this.queue.length < MIN_QUEUE_TARGET) {
      try {
        const res = await fetch('/api/my-songs');
        if (res.ok) {
          const data = await res.json();
          const songs: string[] = data.songs || [];
          if (songs.length > 0) {
            for (const songTitle of songs) {
              if (this.queue.length >= MAX_QUEUE_TARGET) break;
              const parts = songTitle.split(' - ');
              const artist = parts.length > 1 ? parts[0].trim() : 'Artist';
              const title = parts.length > 1 ? parts.slice(1).join(' - ').trim() : songTitle.trim();
              const onAirTrack = this.onAirDeck().getTrack();
              const isDuplicate =
                this.queue.some((q) => q.title.toLowerCase() === title.toLowerCase() || q.url === songTitle) ||
                (onAirTrack && (onAirTrack.title.toLowerCase() === title.toLowerCase() || onAirTrack.url === songTitle)) ||
                this.lastPlayedWithinHour({ title, artist, url: songTitle }) !== null;
              if (!isDuplicate) {
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
            this.saveQueueToStorage();
            this.notify();
          }
        }
      } catch (err) {
        console.warn('Could not auto-seed queue from my_songs.txt:', err);
      }
    }

    // 3. If still under MIN_QUEUE_TARGET, trigger recommendations based on current track or top queue item
    if (this.queue.length < MIN_QUEUE_TARGET && this.autoCurationEnabled) {
      const curDeck = this.activeDeck === 'A' ? this.deckA : this.deckB;
      const curTrack = curDeck.getTrack();
      if (curTrack) {
        void this.refillQueueWithRecommendations(curTrack);
      } else if (this.queue.length > 0) {
        const first = this.queue[0];
        void this.refillQueueWithRecommendations({
          id: first.id,
          title: first.title,
          artist: first.artist,
          duration: first.duration,
          url: first.url,
          bpm: 128,
          sourceType: 'download',
        });
      } else {
        void this.refillQueueWithRecommendations({
          id: 'seed_init',
          title: 'Bollywood Punjabi Party Banger',
          artist: 'Party Hits',
          duration: 180,
          bpm: 128,
          sourceType: 'download',
        });
      }
    }
  }

  // --- Autonomous Percussion Decision & Sync Logic ---

  /**
   * Detects BPM, downbeat and hook once per track. Runs regardless of the percussion
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
    if (track.musicStartTime === undefined) {
      const intro = IntroSkitDetector.detectMusicStart(track.audioBuffer, bpm, firstDownbeatTime);
      // Keep the last few analyses so the on-air song's can be inspected (see getSyncState)
      this.introAnalyses.set(track.id, intro);
      if (this.introAnalyses.size > 20) this.introAnalyses.delete(this.introAnalyses.keys().next().value!);
      track.musicStartTime = intro.suggestedMusicStart;
      track.introSkipReason = intro.reason;
    }
  }

  private copyAnalysisToQueueItem(track: TrackMetadata, item: QueuedTrack) {
    item.bpm = track.bpm;
    item.bpmConfidence = track.bpmConfidence;
    item.firstDownbeatTime = track.firstDownbeatTime;
    item.highlightTime = track.highlightTime;
    item.cueInTime = track.cueInTime;
    item.musicStartTime = track.musicStartTime;
    item.introSkipReason = track.introSkipReason;
    item.energyProfile = track.energyProfile;
  }

  public analyzeAndAutoApplyPercussion(track: TrackMetadata) {
    this.analyzeTrack(track);
    if (!this.autoPercussionEnabled) return;

    if (!track.audioBuffer) {
      this.percussionDecisionReason = 'Awaiting audio buffer decoding...';
      this.notify();
      return;
    }

    const confidence = track.bpmConfidence ?? 0;
    const bpmResult: BpmAnalysisResult = {
      bpm: track.bpm,
      confidence,
      isRegularBeat: confidence >= 0.65,
      firstDownbeatTime: track.firstDownbeatTime ?? 0,
    };

    // 1. Immediate zero-latency heuristic beat synchronization
    const initialDecision: PercussionDecision = evaluatePercussionForTrack(track, bpmResult);
    this.percussionDecisionReason = initialDecision.reason;

    const deck = this.deckB.getTrack() === track ? this.deckB : this.deckA;
    const deckState = deck.getPlaybackState();

    if (initialDecision.shouldPlay) {
      this.percussionDeck.switchPattern(initialDecision.patternId);
      this.percussionDeck.setSyncDeck(deck.id);
      this.percussionDeck.syncPhaseToTime(
        deckState.currentTime / deckState.playbackRate,
        deckState.effectiveBpm,
        (track.firstDownbeatTime || 0) / deckState.playbackRate
      );
      if (!this.percussionDeck.getState().isPlaying && deckState.isPlaying) {
        this.percussionDeck.play();
      }
    } else {
      if (this.percussionDeck.getState().isPlaying) {
        this.percussionDeck.pause();
      }
    }
    this.notify();

    // 2. Deep AI Rhythmic & Arrangement Sync (Ollama primary / Gemini backup)
    void this.djAgent
      .syncPercussion({
        mood: this.mood,
        track: {
          title: track.title,
          artist: track.artist,
          bpm: track.bpm,
          effectiveBpm: deckState.effectiveBpm,
          confidence,
          highlightTime: track.highlightTime,
          duration: track.duration,
          currentTime: deckState.currentTime,
        },
      })
      .then((aiDecision) => {
        if (!aiDecision) return;
        // Verify track is still on air
        if (this.onAirDeck().getTrack() !== track) return;

        const latestState = deck.getPlaybackState();
        if (aiDecision.shouldPlay && aiDecision.patternId !== 'none') {
          this.percussionDeck.switchPattern(aiDecision.patternId as any);
          this.percussionDeck.setVolume(aiDecision.volume);
          this.percussionDeck.setIntensity(aiDecision.intensity);

          // Lock to exact downbeat phase
          this.percussionDeck.syncPhaseToTime(
            latestState.currentTime / latestState.playbackRate,
            latestState.effectiveBpm,
            (track.firstDownbeatTime || 0) / latestState.playbackRate
          );

          if (!this.percussionDeck.getState().isPlaying && latestState.isPlaying) {
            this.percussionDeck.play();
          }

          const providerLabel = this.aiProvider === 'gemini' ? 'Gemini' : 'Qwen';
          this.percussionDecisionReason = `AI synced ${aiDecision.patternId.replace('_', ' ')} (${providerLabel}): ${aiDecision.reason}`;
        } else {
          if (this.percussionDeck.getState().isPlaying) {
            this.percussionDeck.pause();
          }
          this.percussionDecisionReason = `AI held drums: ${aiDecision.reason}`;
        }
        this.notify();
      })
      .catch((err) => {
        console.warn('AI percussion sync query failed:', err);
      });
  }

  /**
   * One-touch AI Rhythm Sync: re-evaluates musical rhythm sync with AI and snaps phase
   * lock to the active on-air deck immediately.
   */
  public resyncPercussionToActiveDeck() {
    const deck = this.onAirDeck();
    const track = deck.getTrack();
    if (!track) return;
    this.autoPercussionEnabled = true;
    const state = deck.getPlaybackState();
    this.percussionDeck.setSyncDeck(deck.id);
    this.percussionDeck.syncPhaseToTime(
      state.currentTime / state.playbackRate,
      state.effectiveBpm,
      (track.firstDownbeatTime || 0) / state.playbackRate
    );
    if (!this.percussionDeck.getState().isPlaying && state.isPlaying) {
      this.percussionDeck.play();
    }
    this.analyzeAndAutoApplyPercussion(track);
    this.notify();
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
    if (!track.audioBuffer) {
      this.acquisitionStatus = `Loading "${track.title}"...`;
      this.notify();
      void this.hydrateTrackBuffer(track).then((buf) => {
        if (buf) {
          this.analyzeTrack(track);
          // If first song being played (no deck currently playing), start at musicStartTime (skip conversation, not hook)
          const isAnyPlaying = this.isAnyDeckPlaying();
          if (!isAnyPlaying) {
            const startPos = track.musicStartTime && track.musicStartTime > 0 ? track.musicStartTime : 0;
            const currentPos = cur.getPlaybackState().currentTime;
            if (currentPos < startPos) {
              cur.play(startPos);
            } else {
              cur.play();
            }
          } else {
            cur.play();
          }
          if (this.autoPercussionEnabled) {
            this.analyzeAndAutoApplyPercussion(track);
          } else if (this.resumePercussionOnPlay) {
            this.startPercussionInSync();
          }
          this.resumePercussionOnPlay = false;
          this.saveCurrentTrackToStorage();
          this.notify();
        }
      });
      return;
    }

    this.analyzeTrack(track);
    const isAnyPlaying = this.isAnyDeckPlaying();
    if (!isAnyPlaying) {
      const startPos = track.musicStartTime && track.musicStartTime > 0 ? track.musicStartTime : 0;
      const currentPos = cur.getPlaybackState().currentTime;
      if (currentPos < startPos) {
        cur.play(startPos);
      } else {
        cur.play();
      }
    } else {
      cur.play();
    }

    if (this.autoPercussionEnabled) {
      this.analyzeAndAutoApplyPercussion(cur.getTrack()!);
    } else if (this.resumePercussionOnPlay) {
      this.startPercussionInSync();
    }
    this.resumePercussionOnPlay = false;
    this.saveCurrentTrackToStorage();
    this.notify();
  }

  public pauseCurrent() {
    const cur = this.activeDeck === 'A' ? this.deckA : this.deckB;
    cur.pause();
    this.cancelPendingMix('Paused — planned mix cancelled.');
    this.resumePercussionOnPlay = this.percussionDeck.getState().isPlaying;
    this.percussionDeck.pause();
    this.saveCurrentTrackToStorage();
    this.notify();
  }

  /** Start/stop the drums. Starting locks them to the beat of the song on air. */
  public togglePercussion() {
    if (this.percussionDeck.getState().isPlaying) {
      this.percussionDeck.stop();
    } else {
      this.startPercussionInSync();
    }
    this.notify();
  }

  private startPercussionInSync() {
    const deck = this.activeDeck === 'A' ? this.deckA : this.deckB;
    const state = deck.getPlaybackState();
    if (state.track && state.isPlaying) {
      this.percussionDeck.setSyncDeck(deck.id);
      this.percussionDeck.syncPhaseToTime(
        state.currentTime / state.playbackRate,
        state.effectiveBpm,
        (state.track.firstDownbeatTime || 0) / state.playbackRate
      );
    }
    this.percussionDeck.play();
  }

  /** After a seek the beat grid moves: re-lock running drums and re-plan any waiting mix. */
  private afterSeek() {
    if (this.percussionDeck.getState().isPlaying) {
      this.startPercussionInSync();
    }
    this.replanPendingMix();
  }

  public stopAll() {
    this.cancelPendingMix('All playback stopped.');
    this.deckA.stop();
    this.deckB.stop();
    this.percussionDeck.stop();
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
        syncPercussion: true,
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
  public mixQueuedTrack(itemId: string, durationSeconds?: number): boolean {
    // Never swap the incoming deck's song in the middle of a mix
    if (this.isTransitioning) return false;

    if (this.pendingMix) {
      if (this.pendingMix.item.id === itemId) {
        this.executePendingMix(true);
        return true;
      }
      this.cancelPendingMix(); // a different song was chosen: plan that one instead
    }

    const item = this.queue.find((q) => q.id === itemId);
    if (!item) return false;
    if (!item.audioBuffer) {
      // Re-hydrate audio buffer from local disk cache before mixing
      void this.ensureTrackBuffer(item).then((buf) => {
        if (buf) this.mixQueuedTrack(itemId, durationSeconds);
      });
      return true;
    }
    if (item.status === 'tuning') {
      this.acquisitionStatus = `"${item.title}" is being tuned to the party tempo — ready in a second.`;
      this.notify();
      return false;
    }
    if (this.onAirDeck().getPlaybackState().isPlaying) {
      return this.planMixInto(itemId, MANUAL_MIX_LOOKAHEAD_SECONDS, durationSeconds);
    }
    return this.startQueuedMixNow(item, durationSeconds);
  }

  /** Puts a queued song on air right away: straight start if nothing plays, else a mix on the next beat. */
  private startQueuedMixNow(item: QueuedTrack, durationSeconds?: number): boolean {
    this.queue = this.queue.filter((q) => q.id !== item.id);
    this.saveQueueToStorage();
    const track = this.queuedItemToTrack(item);

    // Nothing on air (first song of the set, or paused): no mix needed,
    // put the song straight on air and play it from where the music begins (skipping conversation).
    // First song MUST NEVER jump to hook!
    const isAnyPlaying = this.isAnyDeckPlaying();
    if (!isAnyPlaying) {
      const targetDeck = this.activeDeck === 'A' ? this.deckA : this.deckB;
      this.applyCrossfader(this.activeDeck === 'A' ? -1 : 1);
      this.analyzeTrack(track);
      targetDeck.loadTrack(track);
      const startPos = track.musicStartTime && track.musicStartTime > 0 ? track.musicStartTime : 0;
      targetDeck.play(startPos);
      if (this.autoPercussionEnabled) {
        this.analyzeAndAutoApplyPercussion(track);
      }
      this.recordSongPlay(track);
      this.saveCurrentTrackToStorage();
      this.notify();
      return true;
    }

    const targetDeckId = this.activeDeck === 'A' ? 'B' : 'A';
    const targetDeck = targetDeckId === 'A' ? this.deckA : this.deckB;
    this.analyzeTrack(track);
    targetDeck.loadTrack(track);

    // Never start from hook because build up is also important!
    // Start at music start point (skipping initial conversation dialogue, preserving the full buildup)
    const startPos = track.musicStartTime && track.musicStartTime > 0
      ? track.musicStartTime
      : (track.firstDownbeatTime ?? 0);
    targetDeck.cueAt(startPos);

    this.startTransition({
      sourceDeck: this.activeDeck,
      targetDeck: targetDeckId,
      durationSeconds,
      style: 'bass_swap',
      syncPercussion: true,
    });
    return true;
  }

  private queuedItemToTrack(item: QueuedTrack): TrackMetadata {
    return {
      id: item.id,
      title: item.title,
      artist: item.artist,
      duration: item.duration,
      bpm: item.bpm ?? 128,
      bpmConfidence: item.bpmConfidence,
      firstDownbeatTime: item.firstDownbeatTime,
      audioBuffer: item.audioBuffer,
      waveformPeaks: item.audioBuffer
        ? VirtualDeck.extractPeaks(item.audioBuffer, 200)
        : this.generateSyntheticPeaks(200, 'anthem'),
      sourceType: 'download',
      url: item.url,
      thumbnail: item.thumbnail,
      highlightTime: item.highlightTime,
      cueInTime: item.cueInTime,
      musicStartTime: item.musicStartTime,
      introSkipReason: item.introSkipReason,
      energyProfile: item.energyProfile,
      // Tuned to the set tempo: keep the original so the Tempo control can re-time from it
      originalBuffer: item.original ? item.originalBuffer : undefined,
      original: item.original,
      tempoRatio: item.original && item.bpm ? item.bpm / item.original.bpm : undefined,
    };
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
    source: 'request' | 'playlist' = 'request'
  ): Promise<QueuedTrack | null> {
    const cacheKey = this.normalizeCacheKey(queryOrUrl);
    const cached = this.audioBufferCache.get(cacheKey);
    const addToQueue = (item: QueuedTrack) =>
      position === 'front' ? this.queue.unshift(item) : this.queue.push(item);

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
      this.copyAnalysisToQueueItem(cached.metadata, queuedItem);
      addToQueue(queuedItem);
      this.saveQueueToStorage();

      // If a mix is already running, the song stays first in the queue for the next mix
      if (autoMix && this.mixQueuedTrack(id)) {
        this.acquisitionStatus = `Instantly mixed "${cached.metadata.title}" (from RAM)!`;
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

      const match = searchData.results[0];

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

      // Analyse BPM, downbeat and hook. Percussion is only re-evaluated once the song is on air,
      // so queueing a song never changes the drums under the current one.
      this.analyzeTrack(trackMetadata);
      this.copyAnalysisToQueueItem(trackMetadata, queuedItem);

      // Keep it decoded in memory for instant replays (older songs come back from the disk cache)
      this.rememberDecoded(
        [cacheKey, match.url ? this.normalizeCacheKey(match.url) : '', match.title ? this.normalizeCacheKey(match.title) : ''],
        { buffer: audioBuffer, metadata: trackMetadata }
      );

      // If autoMix requested: transition immediately (or as the next mix if one is running)
      if (autoMix && this.mixQueuedTrack(queuedItem.id)) {
        this.acquisitionStatus = `Mixing "${match.title}" into set!`;
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
    return bestShift <= MAX_INCOMING_SHIFT ? { rate: bestRate, matched: true } : { rate: 1, matched: false };
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
    if (match.matched) {
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
      const defaultEntry = targetTrack.musicStartTime && targetTrack.musicStartTime > 0
        ? targetTrack.musicStartTime
        : (targetTrack.firstDownbeatTime ?? 0);
      const cuePoint = config.targetEntryTime ?? defaultEntry;
      if (isSourcePlaying) {
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

    if (config.syncPercussion) {
      this.percussionDeck.syncBpm(sourceBpm);
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

      // The new song is on air: re-sync the drums to it
      this.analyzeAndAutoApplyPercussion(targetTrack);
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

  public getSyncState(): HostSyncState {
    const curDeck = this.activeDeck === 'A' ? this.deckA : this.deckB;
    const curState = curDeck.getPlaybackState();
    // Decoded audio and analysis envelopes are large; keep them out of the 4 Hz WebSocket broadcast
    const currentTrack = curState.track
      ? { ...curState.track, audioBuffer: undefined, originalBuffer: undefined, energyProfile: undefined }
      : null;
    const startsIn = this.pendingMixStartsIn();
    const pendingMix =
      this.pendingMix && startsIn !== null
        ? {
            id: this.pendingMix.item.id,
            title: this.pendingMix.item.title,
            startsInSeconds: Math.max(0, startsIn),
            entryTime: this.pendingMix.plan.entryTime,
            reason: this.pendingMix.plan.reason,
          }
        : null;

    return {
      type: 'SYNC_STATE',
      activeDeck: this.activeDeck,
      currentTrack,
      isPlaying: curState.isPlaying,
      currentTime: curState.currentTime,
      duration: curState.duration,
      bpm: curState.effectiveBpm,
      crossfader: this.crossfaderPosition,
      percussion: this.percussionDeck.getState(),
      queue: this.queue.map((q) => ({ ...q, audioBuffer: undefined, originalBuffer: undefined, energyProfile: undefined })),
      acquisitionStatus: this.acquisitionStatus,
      pendingMix,
      isTransitioning: this.isTransitioning,
      transitionProgress: this.transitionProgress,
      percussionDecisionReason: this.percussionDecisionReason,
      autoCurationEnabled: this.autoCurationEnabled,
      autoPercussionEnabled: this.autoPercussionEnabled,
      autoCueViralHook: this.autoCueViralHook,
      mostPlayedSongs: this.mostPlayedSongs,
      favorites: this.favorites,
      recentlyPlayed: this.playLog.slice(0, 30),
      introAnalysis: curState.track ? this.introAnalyses.get(curState.track.id) ?? null : null,
      mood: this.mood,
      eqGains: this.eqGains,
      sessionBpm: this.sessionBpm,
      aiStatus: this.aiStatus,
      lastAiDecision: this.lastAiDecision,
      tempo: this.getTempoInfo(),
    };
  }

  // --- History & Favorites Management ---

  public async fetchPlayHistory(): Promise<SongHistoryItem[]> {
    try {
      const res = await fetch('/api/history');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.history)) {
          this.mostPlayedSongs = data.history;
          this.notify();
          return data.history;
        }
      }
    } catch (err) {
      console.error('Failed to fetch play history:', err);
    }
    return this.mostPlayedSongs;
  }

  public async recordSongPlay(track: TrackMetadata) {
    if (track?.url) this.playedUrls.add(track.url);
    if (track && this.recentTitles[this.recentTitles.length - 1] !== track.title) {
      this.recentTitles = [...this.recentTitles, track.title].slice(-5);
    }
    if (!track || track.id.startsWith('demo_') || this.lastRecordedTrackId === track.id) return;
    this.lastRecordedTrackId = track.id;

    // Log the play, then drop any other copies of this song waiting in Up Next
    this.playLog = [
      { id: track.id, title: track.title, artist: track.artist, url: track.url, thumbnail: track.thumbnail, playedAt: Date.now() },
      ...this.playLog,
    ].slice(0, PLAY_LOG_MAX);
    this.savePlayLog();
    const playedKeys = this.songKeys(track);
    const before = this.queue.length;
    this.queue = this.queue.filter((q) => q.status === 'downloading' || !this.isSameSong(playedKeys, this.songKeys(q)));
    if (this.queue.length !== before) this.saveQueueToStorage();
    this.notify();

    try {
      const res = await fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          song: {
            id: track.id,
            title: track.title,
            artist: track.artist,
            duration: Math.round(track.duration),
            url: track.url,
            thumbnail: track.thumbnail,
            highlightTime: track.highlightTime,
          },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.history)) {
          this.mostPlayedSongs = data.history;
          this.notify();
        }
      }
    } catch (err) {
      console.error('Failed to record song play history:', err);
    }
  }

  public isFavorite(song?: { id?: string; title?: string; url?: string } | null): boolean {
    if (!song) return false;
    const sId = song.id;
    const sUrl = song.url;
    const sTitle = (song.title || '').trim().toLowerCase();
    return this.favorites.some((f) => {
      if (sId && f.id === sId) return true;
      if (sUrl && f.url && f.url === sUrl) return true;
      if (sTitle && f.title && f.title.trim().toLowerCase() === sTitle) return true;
      return false;
    });
  }

  public async loadFavorites(): Promise<FavoriteSong[]> {
    try {
      const raw = localStorage.getItem('ai_dj_favorites');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.favorites = parsed;
          this.notify();
        }
      }
    } catch {
      // ignore localStorage errors
    }
    return this.fetchFavorites();
  }

  public async fetchFavorites(): Promise<FavoriteSong[]> {
    try {
      const res = await fetch('/api/favorites');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.favorites)) {
          this.favorites = data.favorites;
          try {
            localStorage.setItem('ai_dj_favorites', JSON.stringify(this.favorites));
          } catch {}
          this.notify();
          return data.favorites;
        }
      }
    } catch (err) {
      console.warn('Failed to fetch favorites from server:', err);
    }
    return this.favorites;
  }

  public async toggleFavorite(
    song?: {
      id?: string;
      title?: string;
      artist?: string;
      url?: string;
      thumbnail?: string;
      duration?: number;
      bpm?: number;
      highlightTime?: number;
    } | null
  ): Promise<boolean> {
    if (!song || (!song.id && !song.title && !song.url)) return false;

    const alreadyFav = this.isFavorite(song);
    const normTitle = (song.title || '').trim().toLowerCase();

    // Optimistic local update for instant UI feedback
    if (alreadyFav) {
      this.favorites = this.favorites.filter((f) => {
        if (song.id && f.id === song.id) return false;
        if (song.url && f.url && f.url === song.url) return false;
        if (normTitle && f.title && f.title.trim().toLowerCase() === normTitle) return false;
        return true;
      });
    } else {
      const newFav: FavoriteSong = {
        id: song.id || `fav_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        title: (song.title || 'Unknown Track').trim(),
        artist: (song.artist || 'Unknown Artist').trim(),
        url: song.url,
        thumbnail: song.thumbnail,
        duration: song.duration ? Math.round(song.duration) : undefined,
        bpm: song.bpm ? Math.round(song.bpm) : undefined,
        highlightTime: song.highlightTime,
        addedAt: Date.now(),
      };
      this.favorites = [newFav, ...this.favorites];
    }

    try {
      localStorage.setItem('ai_dj_favorites', JSON.stringify(this.favorites));
    } catch {}
    this.notify();

    // Sync with backend /api/favorites/toggle
    try {
      const res = await fetch('/api/favorites/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          song: {
            id: song.id,
            title: song.title,
            artist: song.artist,
            url: song.url,
            thumbnail: song.thumbnail,
            duration: song.duration,
            bpm: song.bpm,
            highlightTime: song.highlightTime,
          },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.favorites)) {
          this.favorites = data.favorites;
          try {
            localStorage.setItem('ai_dj_favorites', JSON.stringify(this.favorites));
          } catch {}
          this.notify();
          return Boolean(data.isFavorite);
        }
      }
    } catch (err) {
      console.warn('Failed to sync favorite toggle with backend:', err);
    }

    return !alreadyFav;
  }

  public async playStarterSong(songId: string) {
    const song = this.rawMostPlayedSongs.find((s) => s.id === songId) || this.favorites.find((s) => s.id === songId);
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

  public toggleAutoCueHook() {
    this.autoCueViralHook = !this.autoCueViralHook;
    this.notify();
  }

  public toggleAutoCuration() {
    this.autoCurationEnabled = !this.autoCurationEnabled;
    this.notify();
  }

  public toggleAutoPercussion() {
    this.autoPercussionEnabled = !this.autoPercussionEnabled;
    if (this.autoPercussionEnabled) {
      const cur = this.activeDeck === 'A' ? this.deckA : this.deckB;
      if (cur.getTrack()) this.analyzeAndAutoApplyPercussion(cur.getTrack()!);
    }
    this.notify();
  }

  private handleDeckUpdate(deckId: DeckId) {
    const pState = this.percussionDeck.getState();
    if (pState.syncToDeck === deckId) {
      const activeDeck = deckId === 'A' ? this.deckA : this.deckB;
      const bpm = activeDeck.getPlaybackState().effectiveBpm;
      this.percussionDeck.syncBpm(bpm);
    }
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
