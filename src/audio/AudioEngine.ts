import { VirtualDeck } from './VirtualDeck';
import { PercussionDeck } from './PercussionDeck';
import { DeckId, TransitionConfig, QueuedTrack, HostSyncState, TrackMetadata, SongHistoryItem } from '../types';
import { detectBpmFromBuffer, BpmAnalysisResult } from './BpmDetector';
import { evaluatePercussionForTrack, PercussionDecision } from '../ai/PercussionAdvisor';
import { HighlightDetector } from './HighlightDetector';

// Beatmatching changes pitch along with tempo, so only beatmatch when the tempo shift
// stays within ~1 semitone. Beyond that, mix at natural speed with a short crossfade.
const MAX_BEATMATCH_SHIFT = 0.06;
const MIN_BEATMATCH_CONFIDENCE = 0.6;
const UNMATCHED_TRANSITION_SECONDS = 4;
// After a beatmatched mix, glide the on-air song back to its natural tempo/pitch (0.4% per second)
const PITCH_RETURN_PER_SECOND = 0.004;

export class AudioEngine {
  public ctx: AudioContext;

  // Decks
  public deckA: VirtualDeck;
  public deckB: VirtualDeck;
  public percussionDeck: PercussionDeck;

  // Master Nodes
  private masterGain: GainNode;
  private limiter: DynamicsCompressorNode;
  public masterAnalyser: AnalyserNode;

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
  public autoCueViralHook: boolean = true; // World's most liked hook auto-cue preference
  public percussionDecisionReason: string = 'Background drums/orchestra paused per user preference';
  private isFetchingRecommendations: boolean = false;
  private isPreloadingNext: boolean = false;

  // In-memory audio buffer cache (avoids re-downloading or re-rendering songs)
  private audioBufferCache = new Map<string, { buffer: AudioBuffer; metadata: TrackMetadata }>();

  // User History & Favorite Starters
  public mostPlayedSongs: SongHistoryItem[] = [];
  private lastRecordedTrackId: string | null = null;

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

    // Master Analyser
    this.masterAnalyser = this.ctx.createAnalyser();
    this.masterAnalyser.fftSize = 512;

    // Chain: Limiter -> Master Gain -> Master Analyser -> Output
    this.limiter.connect(this.masterGain);
    this.masterGain.connect(this.masterAnalyser);
    this.masterAnalyser.connect(this.ctx.destination);

    // Crossfader Gains for Deck A & Deck B
    this.crossfaderGainA = this.ctx.createGain();
    this.crossfaderGainB = this.ctx.createGain();

    this.crossfaderGainA.connect(this.limiter);
    this.crossfaderGainB.connect(this.limiter);

    // Initialize Decks
    this.deckA = new VirtualDeck('A', this.ctx, this.crossfaderGainA);
    this.deckB = new VirtualDeck('B', this.ctx, this.crossfaderGainB);

    // Percussion Deck connects directly to the Limiter (independent of crossfader!)
    this.percussionDeck = new PercussionDeck(this.ctx, this.limiter);
    this.percussionDeck.stop(); // Ensure completely stopped and silent on startup

    // Set initial crossfader to 100% Deck A
    this.applyCrossfader(-1);

    // Forward deck updates
    this.deckA.onStateUpdate = () => this.handleDeckUpdate('A');
    this.deckB.onStateUpdate = () => this.handleDeckUpdate('B');
    this.percussionDeck.onStateUpdate = () => this.notify();

    // Load persisted most played song history
    this.fetchPlayHistory();

    // Start background watcher loop for auto-queue curation and outro mixing
    this.startAutoDjLoop();
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

    // 1. Check Outro Auto-Mix (continuous playback when current track is ending).
    // Only mix when a queued song is ready; otherwise keep the current song going.
    if (
      curState.isPlaying &&
      curState.duration > 35 &&
      !this.isTransitioning &&
      curState.duration - curState.currentTime <= 14 &&
      this.queue.some((q) => q.status === 'ready' && q.audioBuffer)
    ) {
      // Trigger phrase-aligned transition to next song
      console.log('Auto-DJ: Approaching outro boundary. Auto-mixing next track...');
      this.nextTrack();
      return;
    }

    // 2. Autonomous 5-Song Queue Refill from Internet
    if (this.autoCurationEnabled && curTrack && this.queue.length < 5 && !this.isFetchingRecommendations) {
      this.refillQueueWithRecommendations(curTrack.title, curTrack.artist);
    }

    // 3. Dynamic Arrangement ("Cherry on Top" Rule):
    // Keep live percussion ducked/subtle during slow verses, and unleash full power right on the viral hook drop!
    if (this.autoPercussionEnabled && curState.isPlaying && curTrack?.highlightTime) {
      const timeToHook = curTrack.highlightTime - curState.currentTime;
      if (timeToHook > 6 && curState.currentTime < curTrack.highlightTime) {
        this.percussionDeck.setDucked(true);
      } else {
        this.percussionDeck.setDucked(false);
      }
    }

    // 4. Preload the immediate next queued song so it's decoded and 100% ready
    if (this.queue.length > 0 && !this.isPreloadingNext) {
      const nextToPrep = this.queue.find((q) => q.status === 'queued');
      if (nextToPrep) {
        this.preloadQueuedTrack(nextToPrep);
      }
    }

    // 5. Glide an engine-set tempo back to natural speed so the song isn't left pitched up/down.
    // Manual pitch fader settings are left alone.
    if (!this.isTransitioning && curState.isPlaying && curDeck.isRateAutomatic() && curState.playbackRate !== 1) {
      const rate = curState.playbackRate;
      const step = Math.min(PITCH_RETURN_PER_SECOND, Math.abs(1 - rate));
      curDeck.setPlaybackRate(rate + Math.sign(1 - rate) * step, true);
    }
  }

  private async refillQueueWithRecommendations(currentTitle: string, artist: string) {
    this.isFetchingRecommendations = true;
    try {
      const res = await fetch(
        `/api/recommend?title=${encodeURIComponent(currentTitle)}&artist=${encodeURIComponent(artist)}`
      );
      if (res.ok) {
        const data = await res.json();
        const recs: Array<{ title: string; url: string; author: string; duration: number; thumbnail: string }> =
          data.recommendations || [];

        for (const item of recs) {
          if (this.queue.length >= 5) break;
          // Avoid duplicates
          if (!this.queue.some((q) => q.url === item.url || q.title === item.title)) {
            this.queue.push({
              id: `rec_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              title: item.title,
              artist: item.author,
              duration: item.duration,
              url: item.url,
              thumbnail: item.thumbnail,
              status: 'queued',
              isAiRecommended: true,
            });
          }
        }
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
      const streamRes = await fetch(`/api/stream?url=${encodeURIComponent(item.url)}`);
      if (!streamRes.ok) throw new Error(`Stream download failed: ${streamRes.statusText}`);

      item.status = 'decoding';
      this.notify();

      const arrayBuffer = await streamRes.arrayBuffer();
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);

      item.audioBuffer = audioBuffer;
      item.duration = audioBuffer.duration;

      // Analyse BPM, downbeat and hook ahead of time so the mix can be planned
      const track = this.queuedItemToTrack(item);
      this.analyzeTrack(track);
      this.copyAnalysisToQueueItem(track, item);

      item.status = 'ready';
      this.notify();
    } catch (err) {
      console.warn('Preload failed for', item.title, err);
      item.status = 'failed';
      this.notify();
    } finally {
      this.isPreloadingNext = false;
    }
  }

  // --- Autonomous Percussion Decision & Sync Logic ---

  /**
   * Detects BPM, downbeat and hook once per track. Runs regardless of the percussion
   * setting because beatmatching and hook cueing depend on it.
   */
  private analyzeTrack(track: TrackMetadata) {
    if (!track.audioBuffer || track.bpmConfidence !== undefined) return;

    const bpmResult = detectBpmFromBuffer(track.audioBuffer);
    track.bpm = bpmResult.bpm;
    track.bpmConfidence = bpmResult.confidence;
    track.firstDownbeatTime = bpmResult.firstDownbeatTime;

    // Detect the world's most liked part (highlight) & optimal pre-roll cue-in
    const highlight = HighlightDetector.detectHighlight(
      track.audioBuffer,
      bpmResult.bpm,
      track.highlightTime ? { peakSeconds: track.highlightTime, intensity: track.highlightIntensity || 0.95 } : undefined
    );
    track.highlightTime = highlight.highlightTime;
    track.cueInTime = highlight.cueInTime;
    track.highlightSource = highlight.source;
    track.highlightIntensity = highlight.intensity;
  }

  private copyAnalysisToQueueItem(track: TrackMetadata, item: QueuedTrack) {
    item.bpm = track.bpm;
    item.bpmConfidence = track.bpmConfidence;
    item.firstDownbeatTime = track.firstDownbeatTime;
    item.highlightTime = track.highlightTime;
    item.cueInTime = track.cueInTime;
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

    // Evaluate musical rules from DJ_KNOWLEDGE_AND_MIXING_RULES.md
    const decision: PercussionDecision = evaluatePercussionForTrack(track, bpmResult);
    this.percussionDecisionReason = decision.reason;

    if (decision.shouldPlay) {
      this.percussionDeck.switchPattern(decision.patternId);
      // Lock to the deck actually playing this track, at its current (possibly beatmatched) speed.
      // Song positions are converted to real seconds by dividing by the deck's rate.
      const deck = this.deckB.getTrack() === track ? this.deckB : this.deckA;
      const deckState = deck.getPlaybackState();
      this.percussionDeck.setSyncDeck(deck.id);
      this.percussionDeck.syncPhaseToTime(
        deckState.currentTime / deckState.playbackRate,
        deckState.effectiveBpm,
        (track.firstDownbeatTime || 0) / deckState.playbackRate
      );
      if (!this.percussionDeck.getState().isPlaying) {
        this.percussionDeck.play();
      }
    } else {
      // Rule: If not synced properly or acoustic, stop/mute to protect listening experience
      if (this.percussionDeck.getState().isPlaying) {
        this.percussionDeck.pause();
      }
    }

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
    cur.play();

    // Auto-evaluate percussion on play if enabled
    if (this.autoPercussionEnabled && cur.getTrack()) {
      this.analyzeAndAutoApplyPercussion(cur.getTrack()!);
    }
    this.notify();
  }

  public pauseCurrent() {
    const cur = this.activeDeck === 'A' ? this.deckA : this.deckB;
    cur.pause();
    this.percussionDeck.pause();
    this.notify();
  }

  public stopAll() {
    this.deckA.stop();
    this.deckB.stop();
    this.percussionDeck.stop();
    this.cancelTransition();
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
      cur.pause();
      this.percussionDeck.pause();
    } else {
      cur.play();
      if (this.autoPercussionEnabled && cur.getTrack()) {
        this.analyzeAndAutoApplyPercussion(cur.getTrack()!);
      }
    }
    this.notify();
  }

  public seekCurrent(deltaSeconds: number) {
    const cur = this.activeDeck === 'A' ? this.deckA : this.deckB;
    const now = cur.getCurrentTime();
    cur.seek(now + deltaSeconds);
    this.notify();
  }

  public seekTo(targetSeconds: number) {
    const cur = this.activeDeck === 'A' ? this.deckA : this.deckB;
    cur.seek(targetSeconds);
    this.notify();
  }

  public prevTrack() {
    const cur = this.activeDeck === 'A' ? this.deckA : this.deckB;
    if (cur.getCurrentTime() > 3) {
      cur.seek(0);
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
    this.notify();
  }

  /** Mixes into the next ready song. Returns false (and keeps the current song playing) if none is ready. */
  public nextTrack(): boolean {
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

  /** Loads a ready queued song onto the off-air deck and mixes into it. */
  public mixQueuedTrack(itemId: string, durationSeconds: number = 8): boolean {
    // Never swap the incoming deck's song in the middle of a mix
    if (this.isTransitioning) return false;

    const item = this.queue.find((q) => q.id === itemId);
    if (!item || !item.audioBuffer) return false;
    this.queue = this.queue.filter((q) => q.id !== itemId);
    const track = this.queuedItemToTrack(item);

    // Nothing on air (first song of the set, or paused): no mix needed,
    // put the song straight on air and play it from the beginning.
    const onAirDeck = this.activeDeck === 'A' ? this.deckA : this.deckB;
    if (!onAirDeck.getPlaybackState().isPlaying) {
      this.applyCrossfader(this.activeDeck === 'A' ? -1 : 1);
      onAirDeck.loadTrack(track);
      onAirDeck.play(0);
      this.analyzeAndAutoApplyPercussion(track);
      this.recordSongPlay(track);
      this.notify();
      return true;
    }

    const targetDeckId = this.activeDeck === 'A' ? 'B' : 'A';
    const targetDeck = targetDeckId === 'A' ? this.deckA : this.deckB;
    targetDeck.loadTrack(track);

    // If user prefers playing world's favorite part: cue right before the drop!
    if (this.autoCueViralHook && track.cueInTime) {
      targetDeck.cueAt(track.cueInTime);
    }

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
    };
  }

  private normalizeCacheKey(str: string): string {
    return str.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // --- Background Song Acquisition & Automated Mixing ---

  public async acquireTrack(queryOrUrl: string, autoMix: boolean = false): Promise<QueuedTrack | null> {
    const cacheKey = this.normalizeCacheKey(queryOrUrl);
    const cached = this.audioBufferCache.get(cacheKey);

    // Instant In-Memory Cache Hit: Replay immediately from RAM without re-downloading or re-rendering
    if (cached) {
      this.acquisitionStatus = `Memory Instant Play: "${cached.metadata.title}" (Replay from RAM)`;
      const id = `cached_${Date.now()}`;
      const queuedItem: QueuedTrack = {
        id,
        title: cached.metadata.title,
        artist: cached.metadata.artist,
        duration: cached.metadata.duration,
        url: cached.metadata.url || queryOrUrl,
        thumbnail: cached.metadata.thumbnail,
        status: 'ready',
        audioBuffer: cached.buffer,
      };
      this.copyAnalysisToQueueItem(cached.metadata, queuedItem);
      this.queue.unshift(queuedItem);

      // If a mix is already running, the song stays first in the queue for the next mix
      if (autoMix && this.mixQueuedTrack(id, 6)) {
        this.acquisitionStatus = `Instantly mixed "${cached.metadata.title}" (from RAM)!`;
      }

      this.notify();
      return queuedItem;
    }

    const id = `yt_${Date.now()}`;
    const queuedItem: QueuedTrack = {
      id,
      title: queryOrUrl,
      artist: 'Searching...',
      duration: 180,
      url: queryOrUrl,
      status: 'downloading',
    };

    // If user explicitly requests a song, prepend to the front of the queue
    this.queue.unshift(queuedItem);
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
        return this.acquireTrack(secondaryCached.metadata.title, autoMix);
      }

      queuedItem.title = match.title;
      queuedItem.artist = match.author;
      queuedItem.duration = match.duration;
      queuedItem.url = match.url;
      queuedItem.thumbnail = match.thumbnail;
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

      // Cache in memory so next time it is played, it plays instantly without re-downloading or re-rendering
      this.audioBufferCache.set(cacheKey, { buffer: audioBuffer, metadata: trackMetadata });
      if (match.url) {
        this.audioBufferCache.set(this.normalizeCacheKey(match.url), { buffer: audioBuffer, metadata: trackMetadata });
      }
      if (match.title) {
        this.audioBufferCache.set(this.normalizeCacheKey(match.title), { buffer: audioBuffer, metadata: trackMetadata });
      }

      // If autoMix requested: transition immediately (or as the next mix if one is running)
      if (autoMix && this.mixQueuedTrack(queuedItem.id)) {
        this.acquisitionStatus = `Mixing "${match.title}" into set!`;
      }

      this.notify();
      return queuedItem;
    } catch (err) {
      console.error('Audio acquisition failed:', err);
      queuedItem.status = 'failed';
      this.acquisitionStatus = `Acquisition failed: ${String(err)}`;
      this.notify();
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
    return bestShift <= MAX_BEATMATCH_SHIFT ? { rate: bestRate, matched: true } : { rate: 1, matched: false };
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
    if (this.isTransitioning) return;

    const sourceDeck = config.sourceDeck === 'A' ? this.deckA : this.deckB;
    const targetDeck = config.targetDeck === 'A' ? this.deckA : this.deckB;
    const targetTrack = targetDeck.getTrack();
    if (!targetTrack) return;

    const sourceState = sourceDeck.getPlaybackState();
    const sourceBpm = sourceState.effectiveBpm;
    let durationSeconds = config.durationSeconds;

    // Set the incoming rate BEFORE it starts so it never plays a moment at the wrong speed
    this.analyzeTrack(targetTrack);
    const sourceConfidence = sourceState.isPlaying ? sourceState.track?.bpmConfidence ?? 0 : 0;
    const match = this.computeBeatmatchRate(sourceBpm, sourceConfidence, targetTrack);
    targetDeck.setPlaybackRate(match.rate, true);
    if (match.matched) {
      const shift = (match.rate - 1) * 100;
      this.acquisitionStatus = `Beatmatched mix at ${sourceBpm} BPM (${shift >= 0 ? '+' : ''}${shift.toFixed(1)}% tempo, gliding back to normal after).`;
    } else if (sourceState.isPlaying) {
      // Tempos too far apart (or unreliable): unsynced beats would flam, so keep the overlap short
      durationSeconds = Math.min(durationSeconds, UNMATCHED_TRANSITION_SECONDS);
      this.acquisitionStatus = `Tempos too far apart (${sourceBpm} → ${targetTrack.bpm} BPM) — quick crossfade at natural pitch.`;
    }

    if (!targetDeck.getPlaybackState().isPlaying) {
      const cuePoint = this.autoCueViralHook && targetTrack.cueInTime ? targetTrack.cueInTime : 0;
      targetDeck.play(cuePoint);
    }

    if (config.syncPercussion) {
      this.percussionDeck.syncBpm(sourceBpm);
    }

    this.isTransitioning = true;
    this.transitionProgress = 0;

    // Schedule the whole mix on the audio clock. requestAnimationFrame stops when the
    // browser tab is hidden, which used to freeze mixes halfway with both songs playing.
    const startCrossfader = this.crossfaderPosition;
    const targetCrossfader = config.targetDeck === 'B' ? 1.0 : -1.0;
    const crossfaderAt = (progress: number) => {
      const smooth = progress * progress * (3 - 2 * progress);
      return startCrossfader + (targetCrossfader - startCrossfader) * smooth;
    };

    const startTime = this.ctx.currentTime;
    const curvePoints = 64;
    const curveA = new Float32Array(curvePoints);
    const curveB = new Float32Array(curvePoints);
    for (let i = 0; i < curvePoints; i++) {
      [curveA[i], curveB[i]] = this.equalPowerGains(crossfaderAt(i / (curvePoints - 1)));
    }
    this.crossfaderGainA.gain.cancelScheduledValues(startTime);
    this.crossfaderGainB.gain.cancelScheduledValues(startTime);
    this.crossfaderGainA.gain.setValueCurveAtTime(curveA, startTime, durationSeconds);
    this.crossfaderGainB.gain.setValueCurveAtTime(curveB, startTime, durationSeconds);

    // Bass swap: outgoing bass fades out over the first half, incoming bass comes in over the second
    if (config.style === 'bass_swap') {
      const midTime = startTime + durationSeconds / 2;
      sourceDeck.scheduleLowRamp(sourceState.lowGain, -24, startTime, midTime);
      targetDeck.scheduleLowRamp(-24, 0, midTime, startTime + durationSeconds);
    }

    this.transitionTimer = window.setInterval(() => {
      const progress = Math.min(1, (this.ctx.currentTime - startTime) / durationSeconds);
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

    return {
      type: 'SYNC_STATE',
      activeDeck: this.activeDeck,
      currentTrack: curState.track,
      isPlaying: curState.isPlaying,
      currentTime: curState.currentTime,
      duration: curState.duration,
      bpm: curState.effectiveBpm,
      crossfader: this.crossfaderPosition,
      percussion: this.percussionDeck.getState(),
      queue: this.queue,
      isTransitioning: this.isTransitioning,
      transitionProgress: this.transitionProgress,
      percussionDecisionReason: this.percussionDecisionReason,
      autoCurationEnabled: this.autoCurationEnabled,
      autoPercussionEnabled: this.autoPercussionEnabled,
      autoCueViralHook: this.autoCueViralHook,
      mostPlayedSongs: this.mostPlayedSongs,
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
    if (!track || track.id.startsWith('demo_') || this.lastRecordedTrackId === track.id) return;
    this.lastRecordedTrackId = track.id;

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

  public async playStarterSong(songId: string) {
    const song = this.mostPlayedSongs.find((s) => s.id === songId);
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

      if (!isPlayingRealTrack) {
        // Start set immediately with first song, queue the rest in background
        await this.acquireTrack(songs[0], true);
        for (let i = 1; i < songs.length; i++) {
          this.acquireTrack(songs[i], false);
        }
      } else {
        // Already playing music: queue all songs smoothly
        for (let i = 0; i < songs.length; i++) {
          this.acquireTrack(songs[i], false);
        }
      }

      this.acquisitionStatus = `Loaded ${songs.length} songs from my_songs.txt!`;
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
