import { PercussionPattern, PercussionState, DeckId } from '../types';
import { createSynthesizedBuffer } from './SynthesizedSamples';

export const PERCUSSION_PATTERNS: PercussionPattern[] = [
  {
    id: 'punjabi_dhol',
    name: 'Punjabi Dhol Live',
    category: 'punjabi_dhol',
    defaultBpm: 128,
    description: 'Authentic Punjabi Dhol Chaap with heavy curved stick Dagga & sharp Thapi crack',
    bars: 4,
  },
  {
    id: 'bhangra_groove',
    name: 'Bhangra Dholak & Chimta',
    category: 'bhangra',
    defaultBpm: 130,
    description: 'High-energy traditional wedding & club Bhangra bounce with metallic chimta accents',
    bars: 4,
  },
  {
    id: 'electronic_drums',
    name: 'Club 4-on-the-Floor',
    category: 'electronic',
    defaultBpm: 126,
    description: 'Punchy 909-style kick, snappy 808 clap on 2 & 4, and rolling 16th hats',
    bars: 4,
  },
  {
    id: 'afrobeat',
    name: 'Afrobeat Shakers & Congas',
    category: 'afrobeat',
    defaultBpm: 120,
    description: 'Syncopated wooden congas, organic shakers, and deep polyrhythmic groove',
    bars: 4,
  },
];

export class PercussionDeck {
  private ctx: AudioContext;
  private destinationNode: AudioNode;

  // Nodes
  private sourceNode: AudioBufferSourceNode | null = null;
  private highPassFilter: BiquadFilterNode;
  private presenceFilter: BiquadFilterNode;
  private gainNode: GainNode;
  public analyserNode: AnalyserNode;

  // State
  private isPlaying: boolean = false;
  private activePatternId: string = 'punjabi_dhol';
  private volume: number = 0.85;
  private intensity: number = 1.0;
  private isMuted: boolean = false;
  private isDucked: boolean = false; // Ducked during quiet verses / breakdowns
  private syncToDeck: DeckId | 'manual' = 'A';
  private currentBpm: number = 128;

  // Cache of pre-synthesized loop buffers
  private bufferCache: Map<string, AudioBuffer> = new Map();

  // Time tracking
  private startedAt: number = 0;
  private pausedAt: number = 0;

  public onStateUpdate?: () => void;

  constructor(ctx: AudioContext, destinationNode: AudioNode) {
    this.ctx = ctx;
    this.destinationNode = destinationNode;

    // Highpass Filter at 50 Hz: eliminates sub-bass rumble so the song's own 808/kick has room
    this.highPassFilter = this.ctx.createBiquadFilter();
    this.highPassFilter.type = 'highpass';
    this.highPassFilter.frequency.value = 50;
    this.highPassFilter.Q.value = 0.707;

    // Presence Boost at 3.0 kHz (+2.5dB): studio polish that makes Thapi & Chimta cut through as a 'cherry on top'
    this.presenceFilter = this.ctx.createBiquadFilter();
    this.presenceFilter.type = 'peaking';
    this.presenceFilter.frequency.value = 3000;
    this.presenceFilter.gain.value = 2.5;
    this.presenceFilter.Q.value = 1.0;

    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.value = this.volume;

    this.analyserNode = this.ctx.createAnalyser();
    this.analyserNode.fftSize = 256;

    // Chain: Source -> Highpass (Clean Sub) -> Presence (Crisp Slap) -> Gain -> Analyser -> Output
    this.highPassFilter.connect(this.presenceFilter);
    this.presenceFilter.connect(this.gainNode);
    this.gainNode.connect(this.analyserNode);
    this.analyserNode.connect(this.destinationNode);

    // Pre-cache buffers for instantaneous pattern switching
    this.preloadBuffers();
  }

  private preloadBuffers() {
    for (const pattern of PERCUSSION_PATTERNS) {
      const buf = createSynthesizedBuffer(this.ctx, pattern.id, pattern.defaultBpm);
      this.bufferCache.set(pattern.id, buf);
    }
  }

  public play() {
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    if (this.isPlaying) return;

    this.startLoop(this.pausedAt);
    this.isPlaying = true;
    this.notifyUpdate();
  }

  public pause() {
    if (!this.isPlaying) return;
    this.pausedAt = this.getCurrentTime();
    this.stopSource();
    this.isPlaying = false;
    this.notifyUpdate();
  }

  public stop() {
    this.stopSource();
    this.isPlaying = false;
    this.pausedAt = 0;
    this.startedAt = 0;
    this.notifyUpdate();
  }

  public togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  public switchPattern(patternId: string) {
    if (this.activePatternId === patternId) return;

    const pattern = PERCUSSION_PATTERNS.find((p) => p.id === patternId);
    if (!pattern) return;

    // All patterns are 4 bars, so keep the same position within the bar cycle
    const oldBuffer = this.getBuffer();
    const loopFraction = oldBuffer ? this.getCurrentTime() / oldBuffer.duration : 0;
    this.activePatternId = patternId;
    const newBuffer = this.getBuffer();
    const newOffset = newBuffer ? loopFraction * newBuffer.duration : 0;

    if (this.isPlaying) {
      // Seamlessly hot-swap the buffer without stopping the timeline
      this.stopSource();
      this.startLoop(newOffset);
    } else {
      this.pausedAt = newOffset;
    }
    this.notifyUpdate();
  }

  public setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
    this.applyEffectiveGain();
    this.notifyUpdate();
  }

  public setIntensity(val: number) {
    this.intensity = Math.max(0.5, Math.min(1.5, val));
    this.applyEffectiveGain();
    this.notifyUpdate();
  }

  public toggleMute() {
    this.isMuted = !this.isMuted;
    this.applyEffectiveGain();
    this.notifyUpdate();
  }

  public syncBpm(targetBpm: number) {
    // Re-anchor the clock so the loop position stays continuous across the rate change
    const position = this.getCurrentTime();
    this.currentBpm = Math.max(80, Math.min(180, targetBpm));
    if (this.sourceNode) {
      const rate = this.getRate();
      this.sourceNode.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.05);
      this.startedAt = this.ctx.currentTime - position / rate;
    }
    this.notifyUpdate();
  }

  private getRate(): number {
    const activePattern = PERCUSSION_PATTERNS.find((p) => p.id === this.activePatternId);
    return this.currentBpm / (activePattern ? activePattern.defaultBpm : 128);
  }

  public setSyncDeck(deckId: DeckId | 'manual') {
    this.syncToDeck = deckId;
    this.notifyUpdate();
  }

  public getState(): PercussionState {
    return {
      isPlaying: this.isPlaying,
      activePatternId: this.activePatternId,
      volume: this.volume,
      intensity: this.intensity,
      currentBpm: this.currentBpm,
      syncToDeck: this.syncToDeck,
      isMuted: this.isMuted,
    };
  }

  public getCurrentTime(): number {
    const buffer = this.getBuffer();
    if (!buffer) return 0;
    if (this.isPlaying) {
      // Position within the loop buffer (buffer seconds advance at the playback rate)
      const elapsed = (this.ctx.currentTime - this.startedAt) * this.getRate();
      return elapsed % buffer.duration;
    }
    return this.pausedAt;
  }

  public setDucked(ducked: boolean) {
    if (this.isDucked === ducked) return;
    this.isDucked = ducked;
    this.applyEffectiveGain();
    this.notifyUpdate();
  }

  /**
   * Locks the loop to the song's beat grid. Times are in real (wall-clock) seconds
   * since the song started, so they stay correct when the song deck is tempo-shifted.
   */
  public syncPhaseToTime(deckCurrentTime: number, deckBpm: number, firstDownbeatTime: number = 0) {
    this.syncBpm(deckBpm);
    const buffer = this.getBuffer();
    if (!buffer) return;

    const rate = this.getRate();
    const effectiveLoopDuration = buffer.duration / rate;

    // Calculate musical time aligned to song downbeat grid
    const relativeTime = Math.max(0, deckCurrentTime - firstDownbeatTime);
    const targetPhaseInLoop = (relativeTime % effectiveLoopDuration) * rate;

    if (this.isPlaying) {
      // Only restart the loop when it is audibly out of phase (> ~15 ms)
      const drift = Math.abs(this.getCurrentTime() - targetPhaseInLoop);
      const circularDrift = Math.min(drift, buffer.duration - drift) / rate;
      if (circularDrift > 0.015) {
        this.stopSource();
        this.startLoop(targetPhaseInLoop);
      }
    } else {
      this.pausedAt = targetPhaseInLoop;
    }
  }

  private startLoop(offsetSeconds: number) {
    const buffer = this.getBuffer();
    if (!buffer) return;

    this.sourceNode = this.ctx.createBufferSource();
    this.sourceNode.buffer = buffer;
    this.sourceNode.loop = true;

    // Adjust playbackRate according to target BPM
    const rate = this.getRate();
    this.sourceNode.playbackRate.value = rate;

    // Connect to HighPass -> Presence -> Gain -> Output chain
    this.sourceNode.connect(this.highPassFilter);

    const safeOffset = offsetSeconds % buffer.duration;
    this.sourceNode.start(0, safeOffset);
    this.startedAt = this.ctx.currentTime - safeOffset / rate;
  }

  private stopSource() {
    if (this.sourceNode) {
      try {
        this.sourceNode.stop();
        this.sourceNode.disconnect();
      } catch {
        // Ignored
      }
      this.sourceNode = null;
    }
  }

  private getBuffer(): AudioBuffer | undefined {
    let buf = this.bufferCache.get(this.activePatternId);
    if (!buf) {
      buf = createSynthesizedBuffer(this.ctx, this.activePatternId);
      this.bufferCache.set(this.activePatternId, buf);
    }
    return buf;
  }

  private applyEffectiveGain() {
    let effective = this.isMuted ? 0 : this.volume * this.intensity;
    if (this.isDucked) {
      effective *= 0.35; // Soft rhythm accent during verses; explodes to 1.0 on chorus/drop
    }
    this.gainNode.gain.setTargetAtTime(effective, this.ctx.currentTime, 0.05);
  }

  private notifyUpdate() {
    if (this.onStateUpdate) {
      this.onStateUpdate();
    }
  }
}
