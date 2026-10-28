import { DeckId, TrackMetadata } from '../types';
import { detectBpmFromBuffer } from './BpmDetector';
import { IntroSkitDetector } from './IntroSkitDetector';

// playbackRate shifts pitch along with tempo ("vinyl" mode); key-locked tempo changes use
// a re-timed buffer instead. Range matches the Tempo control (0.8x – 1.25x).
export const MIN_PLAYBACK_RATE = 0.8;
export const MAX_PLAYBACK_RATE = 1.25;
const SWAP_FADE_SECONDS = 0.04;

export class VirtualDeck {
  public readonly id: DeckId;
  private ctx: AudioContext;

  // Nodes
  private sourceNode: AudioBufferSourceNode | null = null;
  private sourceGain: GainNode | null = null; // per-source fade, used when swapping audio mid-song
  private gainNode: GainNode;
  private lowFilter: BiquadFilterNode;
  private midFilter: BiquadFilterNode;
  private highFilter: BiquadFilterNode;
  public analyserNode: AnalyserNode;

  // Playback State
  private track: TrackMetadata | null = null;
  private isPlaying: boolean = false;
  private playbackRate: number = 1.0;
  // True when the engine (not the user) set the rate, so it may glide it back to 1.0
  private rateIsAutomatic: boolean = false;
  private volume: number = 1.0;
  private lowGain: number = 0;   // dB
  private midGain: number = 0;   // dB
  private highGain: number = 0;  // dB

  // Time tracking
  private startedAt: number = 0;
  private pausedAt: number = 0;

  // Callback on playback state change
  public onStateUpdate?: () => void;

  constructor(id: DeckId, ctx: AudioContext, destinationNode: AudioNode) {
    this.id = id;
    this.ctx = ctx;

    // Build DSP Filter Chain
    // Low Isolator EQ: Lowshelf at 250 Hz
    this.lowFilter = this.ctx.createBiquadFilter();
    this.lowFilter.type = 'lowshelf';
    this.lowFilter.frequency.value = 250;
    this.lowFilter.gain.value = 0;

    // Mid Isolator EQ: Peaking filter at 1200 Hz
    this.midFilter = this.ctx.createBiquadFilter();
    this.midFilter.type = 'peaking';
    this.midFilter.frequency.value = 1200;
    this.midFilter.Q.value = 1.0;
    this.midFilter.gain.value = 0;

    // High Isolator EQ: Highshelf at 3500 Hz
    this.highFilter = this.ctx.createBiquadFilter();
    this.highFilter.type = 'highshelf';
    this.highFilter.frequency.value = 3500;
    this.highFilter.gain.value = 0;

    // Gain (Volume) Node
    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.value = this.volume;

    // Analyser Node for live visualizer
    this.analyserNode = this.ctx.createAnalyser();
    this.analyserNode.fftSize = 256;

    // Chain: Filters -> Gain -> Analyser -> Output Bus
    this.lowFilter.connect(this.midFilter);
    this.midFilter.connect(this.highFilter);
    this.highFilter.connect(this.gainNode);
    this.gainNode.connect(this.analyserNode);
    this.analyserNode.connect(destinationNode);
  }

  public async loadAudioFile(file: File): Promise<TrackMetadata> {
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);

    // Compute waveform peaks for visual scrubbing
    const peaks = VirtualDeck.extractPeaks(audioBuffer, 200);
    const bpmResult = detectBpmFromBuffer(audioBuffer);
    const introAnalysis = IntroSkitDetector.detectMusicStart(
      audioBuffer,
      bpmResult.bpm,
      bpmResult.firstDownbeatTime
    );

    const metadata: TrackMetadata = {
      id: `local_${Date.now()}`,
      title: file.name.replace(/\.[^/.]+$/, ''),
      artist: 'Local Library',
      duration: audioBuffer.duration,
      bpm: bpmResult.bpm,
      bpmConfidence: bpmResult.confidence,
      firstDownbeatTime: bpmResult.firstDownbeatTime,
      audioBuffer,
      waveformPeaks: peaks,
      musicStartTime: introAnalysis.suggestedMusicStart,
      introSkipReason: introAnalysis.reason,
      sourceType: 'local',
    };

    this.loadTrack(metadata);
    return metadata;
  }

  public loadTrack(metadata: TrackMetadata) {
    if (this.isPlaying) {
      this.pause();
    }
    this.track = metadata;
    // Always skip initial conversation/dialogue if any that is without music
    this.pausedAt = metadata.musicStartTime && metadata.musicStartTime > 0 ? metadata.musicStartTime : 0;
    this.startedAt = 0;
    // A new song starts at its natural tempo/pitch
    this.playbackRate = 1.0;
    this.rateIsAutomatic = false;
    this.notifyUpdate();
  }

  /** @param when AudioContext time to start at (used to land the first beat on the other deck's beat) */
  public play(fromOffset?: number, when?: number) {
    if (!this.track || !this.track.audioBuffer) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    if (this.isPlaying) {
      this.stopSource();
    }

    const musicStart = this.track.musicStartTime && this.track.musicStartTime > 0 ? this.track.musicStartTime : 0;
    let offset = fromOffset !== undefined ? fromOffset : this.pausedAt;
    // Always skip initial conversation/dialogue part if any that is without music
    if (fromOffset === undefined && this.pausedAt < musicStart) {
      offset = musicStart;
    }
    const clampedOffset = Math.max(0, Math.min(offset, this.track.duration));

    const startTime = Math.max(when ?? 0, this.ctx.currentTime);
    this.startSource(this.track.audioBuffer, clampedOffset, startTime, false);

    this.startedAt = startTime - clampedOffset / this.playbackRate;
    this.pausedAt = clampedOffset;
    this.isPlaying = true;
    this.notifyUpdate();
  }

  private startSource(buffer: AudioBuffer, offset: number, startTime: number, fadeIn: boolean) {
    this.sourceNode = this.ctx.createBufferSource();
    this.sourceNode.buffer = buffer;
    this.sourceNode.playbackRate.value = this.playbackRate;
    this.sourceNode.loop = true; // Loop for continuous DJ mixing

    this.sourceGain = this.ctx.createGain();
    if (fadeIn) {
      this.sourceGain.gain.setValueAtTime(0, startTime);
      this.sourceGain.gain.linearRampToValueAtTime(1, startTime + SWAP_FADE_SECONDS);
    }
    this.sourceNode.connect(this.sourceGain);
    this.sourceGain.connect(this.lowFilter);
    this.sourceNode.start(startTime, offset);
  }

  /**
   * Swaps in a re-timed version of the song (key-locked tempo change) without a gap or click:
   * the new audio starts at `newOffset` while the old fades out over 40 ms.
   */
  public replaceAudio(track: TrackMetadata, newOffset: number) {
    this.track = track;
    const offset = Math.max(0, Math.min(newOffset, track.duration));
    if (!this.isPlaying || !track.audioBuffer) {
      this.pausedAt = offset;
      this.notifyUpdate();
      return;
    }

    const now = this.ctx.currentTime;
    const oldSource = this.sourceNode;
    const oldGain = this.sourceGain;
    if (oldSource && oldGain) {
      oldGain.gain.setValueAtTime(1, now);
      oldGain.gain.linearRampToValueAtTime(0, now + SWAP_FADE_SECONDS);
      oldSource.stop(now + SWAP_FADE_SECONDS + 0.01);
      oldSource.onended = () => {
        oldSource.disconnect();
        oldGain.disconnect();
      };
    }
    this.startSource(track.audioBuffer, offset, now, true);
    this.startedAt = now - offset / this.playbackRate;
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
    this.pausedAt = this.track?.musicStartTime && this.track.musicStartTime > 0 ? this.track.musicStartTime : 0;
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

  public seek(timeSeconds: number) {
    if (!this.track) return;
    const target = Math.max(0, Math.min(timeSeconds, this.track.duration));
    if (this.isPlaying) {
      this.play(target);
    } else {
      this.pausedAt = target;
      this.notifyUpdate();
    }
  }

  public cueAt(timeSeconds: number) {
    if (!this.track) return;
    const target = Math.max(0, Math.min(timeSeconds, this.track.duration));
    this.pausedAt = target;
    if (this.isPlaying) {
      this.play(target);
    } else {
      this.notifyUpdate();
    }
  }

  public jumpToHighlight() {
    if (!this.track) return;
    const target = this.track.highlightTime ?? this.track.cueInTime ?? 0;
    this.seek(target);
  }

  public setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
    this.gainNode.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    this.notifyUpdate();
  }

  public setPlaybackRate(rate: number, automatic: boolean = false) {
    // Re-anchor the clock at the current position, otherwise the elapsed time is
    // rescaled by the new rate and the playhead jumps.
    const position = this.getCurrentTime();
    this.playbackRate = Math.max(MIN_PLAYBACK_RATE, Math.min(MAX_PLAYBACK_RATE, rate));
    this.rateIsAutomatic = automatic;
    if (this.sourceNode) {
      this.sourceNode.playbackRate.setTargetAtTime(this.playbackRate, this.ctx.currentTime, 0.02);
      this.startedAt = this.ctx.currentTime - position / this.playbackRate;
    }
    this.notifyUpdate();
  }

  public isRateAutomatic(): boolean {
    return this.rateIsAutomatic;
  }

  /** Schedules a linear low-EQ ramp on the audio clock (keeps running when the tab is hidden). */
  public scheduleLowRamp(fromDb: number, toDb: number, startTime: number, endTime: number) {
    const param = this.lowFilter.gain;
    param.cancelScheduledValues(this.ctx.currentTime);
    param.setValueAtTime(fromDb, this.ctx.currentTime);
    param.setValueAtTime(fromDb, startTime);
    param.linearRampToValueAtTime(toDb, endTime);
    this.lowGain = toDb;
  }

  public setEQ(low: number, mid: number, high: number) {
    this.lowGain = Math.max(-40, Math.min(6, low));
    this.midGain = Math.max(-40, Math.min(6, mid));
    this.highGain = Math.max(-40, Math.min(6, high));

    const now = this.ctx.currentTime;
    this.lowFilter.gain.setTargetAtTime(this.lowGain, now, 0.02);
    this.midFilter.gain.setTargetAtTime(this.midGain, now, 0.02);
    this.highFilter.gain.setTargetAtTime(this.highGain, now, 0.02);
    this.notifyUpdate();
  }

  public getCurrentTime(): number {
    if (!this.track) return 0;
    if (this.isPlaying) {
      // Clamped at 0 while a scheduled start is still in the future
      const elapsed = Math.max(0, (this.ctx.currentTime - this.startedAt) * this.playbackRate);
      return elapsed % this.track.duration;
    }
    return this.pausedAt;
  }

  public getTrack(): TrackMetadata | null {
    return this.track;
  }

  public getPlaybackState() {
    return {
      deckId: this.id,
      track: this.track,
      isPlaying: this.isPlaying,
      currentTime: this.getCurrentTime(),
      duration: this.track ? this.track.duration : 0,
      volume: this.volume,
      playbackRate: this.playbackRate,
      effectiveBpm: this.track ? Math.round(this.track.bpm * this.playbackRate * 10) / 10 : 128,
      lowGain: this.lowGain,
      midGain: this.midGain,
      highGain: this.highGain,
      isCue: false,
    };
  }

  private stopSource() {
    if (this.sourceNode) {
      try {
        this.sourceNode.stop();
        this.sourceNode.disconnect();
      } catch {
        // Source node may already be stopped
      }
      this.sourceNode = null;
    }
    this.sourceGain?.disconnect();
    this.sourceGain = null;
  }

  public static extractPeaks(buffer: AudioBuffer, count: number): number[] {
    const raw = buffer.getChannelData(0);
    const blockSize = Math.floor(raw.length / count);
    const peaks: number[] = [];

    for (let i = 0; i < count; i++) {
      let max = 0;
      const start = i * blockSize;
      for (let j = 0; j < blockSize; j += 10) {
        const val = Math.abs(raw[start + j]);
        if (val > max) max = val;
      }
      peaks.push(Number(max.toFixed(3)));
    }
    return peaks;
  }

  private notifyUpdate() {
    if (this.onStateUpdate) {
      this.onStateUpdate();
    }
  }
}
