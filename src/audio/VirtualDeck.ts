import { DeckId, TrackMetadata } from '../types';
import { detectBpmFromBuffer } from './BpmDetector';
import { IntroSkitDetector } from './IntroSkitDetector';
import { loudnessGainDb } from './Loudness';

// playbackRate shifts pitch along with tempo ("vinyl" mode); key-locked tempo changes use
// a re-timed buffer instead. Range matches the Tempo control (0.5x – 1.5x).
export const MIN_PLAYBACK_RATE = 0.5;
export const MAX_PLAYBACK_RATE = 1.5;
const SWAP_FADE_SECONDS = 0.04;

export class VirtualDeck {
  public readonly id: DeckId;
  private ctx: AudioContext;

  // Nodes
  private sourceNode: AudioBufferSourceNode | null = null;
  private sourceGain: GainNode | null = null; // per-source fade, used when swapping audio mid-song
  private gainNode: GainNode;
  private trimNode: GainNode; // loudness matching (see Loudness.ts), before the volume fader
  private lowFilter: BiquadFilterNode;
  private midFilter: BiquadFilterNode;
  private highFilter: BiquadFilterNode;
  public analyserNode: AnalyserNode;
  // Echo-out FX (used on cuts): post-fader send -> delay (with feedback) -> high-pass -> master.
  // It goes to the master bus, not through the crossfader, so the echo tail rings on after the cut.
  private fxSend: GainNode;
  private fxDelay: DelayNode;
  private fxFeedback: GainNode;
  private fxFilter: BiquadFilterNode;

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
  // A beat loop on the playing source (song seconds); cleared by any new source, pause or seek
  private loop: { start: number; end: number } | null = null;

  // Callback on playback state change
  public onStateUpdate?: () => void;

  constructor(id: DeckId, ctx: AudioContext, destinationNode: AudioNode, fxDestination?: AudioNode) {
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

    // Loudness trim, then the volume fader
    this.trimNode = this.ctx.createGain();
    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.value = this.volume;

    // Analyser Node for live visualizer
    this.analyserNode = this.ctx.createAnalyser();
    this.analyserNode.fftSize = 256;

    // Chain: Filters -> Gain -> Analyser -> Output Bus
    this.lowFilter.connect(this.midFilter);
    this.midFilter.connect(this.highFilter);
    this.highFilter.connect(this.trimNode);
    this.trimNode.connect(this.gainNode);
    this.gainNode.connect(this.analyserNode);
    this.analyserNode.connect(destinationNode);

    this.fxSend = this.ctx.createGain();
    this.fxSend.gain.value = 0;
    this.fxDelay = this.ctx.createDelay(2);
    this.fxFeedback = this.ctx.createGain();
    this.fxFeedback.gain.value = 0;
    this.fxFilter = this.ctx.createBiquadFilter();
    this.fxFilter.type = 'highpass';
    this.fxFilter.frequency.value = 300;
    this.gainNode.connect(this.fxSend);
    this.fxSend.connect(this.fxDelay);
    this.fxDelay.connect(this.fxFeedback);
    this.fxFeedback.connect(this.fxDelay);
    this.fxDelay.connect(this.fxFilter);
    this.fxFilter.connect(fxDestination ?? destinationNode);
  }

  /**
   * Echo-out for a cut at `cutTime` (audio clock): the last beat before the cut feeds a
   * dotted-8th echo whose repeats rise through a high-pass sweep and fade over ~3 s, so the
   * outgoing song trails off on its own rhythm instead of stopping dead.
   */
  public scheduleEchoOut(cutTime: number, beatSeconds: number) {
    const now = this.ctx.currentTime;
    const beat = Math.max(0.2, Math.min(1, beatSeconds));
    const feedStart = Math.max(now, cutTime - beat);
    const tail = 3;
    const send = this.fxSend.gain;
    const feedback = this.fxFeedback.gain;
    const cutoff = this.fxFilter.frequency;
    for (const p of [send, feedback, cutoff]) p.cancelScheduledValues(now);

    this.fxDelay.delayTime.setValueAtTime(Math.min(1.9, beat * 0.75), now);
    // Feed the echo during the last beat before the cut, then close the send
    send.setValueAtTime(0, feedStart);
    send.linearRampToValueAtTime(0.7, feedStart + 0.05);
    send.setValueAtTime(0.7, cutTime);
    send.linearRampToValueAtTime(0, cutTime + 0.1);
    // Repeats fade out over the tail
    feedback.setValueAtTime(0.5, feedStart);
    feedback.setValueAtTime(0.5, cutTime);
    feedback.linearRampToValueAtTime(0, cutTime + tail);
    // High-pass sweep: the echo thins out as it fades, leaving room for the new song's bass
    cutoff.setValueAtTime(300, feedStart);
    cutoff.exponentialRampToValueAtTime(3000, cutTime + tail);
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

  public loadTrack(metadata: TrackMetadata, initialPosition?: number) {
    if (this.isPlaying) {
      this.pause();
    }
    this.track = metadata;
    // Always skip initial conversation/dialogue if any that is without music
    const defaultStart = metadata.musicStartTime && metadata.musicStartTime > 0 ? metadata.musicStartTime : 0;
    this.pausedAt = initialPosition !== undefined ? Math.max(0, Math.min(initialPosition, metadata.duration)) : defaultStart;
    this.startedAt = 0;
    // A new song starts at its natural tempo/pitch
    this.playbackRate = 1.0;
    this.rateIsAutomatic = false;
    this.setTrimDb(metadata.loudnessDb !== undefined ? loudnessGainDb(metadata.loudnessDb) : 0, true);
    this.notifyUpdate();
  }

  /** Loudness trim in dB; glides over half a second unless `instant` (a song being loaded). */
  public setTrimDb(db: number, instant = false) {
    const gain = Math.pow(10, db / 20);
    const param = this.trimNode.gain;
    param.cancelScheduledValues(this.ctx.currentTime);
    if (instant) param.setValueAtTime(gain, this.ctx.currentTime);
    else param.setTargetAtTime(gain, this.ctx.currentTime, 0.15);
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
    this.loop = null; // a new source starts without a beat loop

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
    this.loop = null;
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

  /**
   * Loops [start, end) (song seconds, normally whole bars) on the playing source. The clock keeps
   * counting through the loop, so anything locked to this song's beat grid stays on the beat.
   */
  public setLoop(start: number, end: number): boolean {
    if (!this.isPlaying || !this.sourceNode || !this.track || end <= start || end > this.track.duration) return false;
    this.sourceNode.loopStart = start;
    this.sourceNode.loopEnd = end;
    this.loop = { start, end };
    this.notifyUpdate();
    return true;
  }

  /** Leaves the loop and plays on from where the loop is now. */
  public exitLoop() {
    if (!this.loop) return;
    const position = this.getCurrentTime();
    if (this.sourceNode) {
      this.sourceNode.loopStart = 0;
      this.sourceNode.loopEnd = 0; // back to looping the whole buffer (the default)
    }
    this.loop = null;
    this.startedAt = this.ctx.currentTime - position / this.playbackRate;
    this.notifyUpdate();
  }

  public getLoop(): { start: number; end: number } | null {
    return this.loop;
  }

  public getCurrentTime(): number {
    if (!this.track) return 0;
    if (this.isPlaying) {
      // Clamped at 0 while a scheduled start is still in the future
      const elapsed = Math.max(0, (this.ctx.currentTime - this.startedAt) * this.playbackRate);
      if (this.loop && elapsed > this.loop.end) {
        return this.loop.start + ((elapsed - this.loop.start) % (this.loop.end - this.loop.start));
      }
      return elapsed % this.track.duration;
    }
    return this.pausedAt;
  }

  /**
   * The audio-clock anchor of playback (position = (ctx.currentTime - startedAt) * rate),
   * so other parts can schedule sounds exactly on this song's beats. Null when stopped.
   */
  public getClockAnchor(): { startedAt: number; rate: number } | null {
    return this.isPlaying && this.track ? { startedAt: this.startedAt, rate: this.playbackRate } : null;
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
