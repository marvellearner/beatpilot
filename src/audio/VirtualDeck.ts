import { DeckId, TrackMetadata } from '../types';
import { detectBpmFromBuffer } from './BpmDetector';
import { IntroSkitDetector } from './IntroSkitDetector';
import { loudnessGainDb } from './Loudness';
import { isStrictStartSong } from './songMatch';

// playbackRate shifts pitch along with tempo ("vinyl" mode); key-locked tempo changes use
// a re-timed buffer instead. Range matches the Tempo control (0.5x – 1.5x).
export const MIN_PLAYBACK_RATE = 0.5;
export const MAX_PLAYBACK_RATE = 1.5;
const SWAP_FADE_SECONDS = 0.04;

const SWEEP_OPEN_HZ = 10;
const SWEEP_CLOSED_HZ = 1500;

export class VirtualDeck {
  public readonly id: DeckId;
  private ctx: AudioContext;

  // Nodes
  private sourceNode: AudioBufferSourceNode | null = null;
  private sourceGain: GainNode | null = null; // per-source fade, used when swapping audio mid-song
  // Streaming: a song that isn't downloaded yet plays through an <audio> element while it buffers,
  // then hands over to the decoded buffer (see attachStream / upgradeToBuffer)
  private mediaEl: HTMLAudioElement | null = null;
  // Key lock for a streaming song: the browser re-times it so speed changes keep the pitch
  private keepStreamPitch = false;
  private mediaSource: MediaElementAudioSourceNode | null = null;
  private mediaGain: GainNode | null = null;
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
  private sweepFilter: BiquadFilterNode; // high-pass for a filter-sweep exit; open (10 Hz) otherwise

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
  private loopInTime: number | null = null;
  private lastLoop: { start: number; end: number } | null = null;

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

    // Filter-sweep exit: a high-pass that is fully open until a mix sweeps it up
    this.sweepFilter = this.ctx.createBiquadFilter();
    this.sweepFilter.type = 'highpass';
    this.sweepFilter.frequency.value = SWEEP_OPEN_HZ;
    this.sweepFilter.Q.value = 0.9;

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
    this.highFilter.connect(this.sweepFilter);
    this.sweepFilter.connect(this.trimNode);
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
    this.releaseStream();
    this.resetFilterSweep();
    this.track = metadata;
    const isStrict = isStrictStartSong(metadata);
    if (isStrict) {
      metadata.musicStartTime = 0;
      metadata.cueInTime = 0;
      metadata.introSkipReason = undefined;
    }
    // Always skip initial conversation/dialogue if any that is without music (unless strict start song)
    const defaultStart = isStrict ? 0 : (metadata.musicStartTime && metadata.musicStartTime > 0 ? metadata.musicStartTime : 0);
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
    if (!this.track) return;
    if (!this.track.audioBuffer) {
      if (this.mediaEl) this.playStream(fromOffset);
      return;
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    if (this.isPlaying) {
      this.stopSource();
    }

    const isStrict = isStrictStartSong(this.track);
    const musicStart = isStrict ? 0 : (this.track.musicStartTime && this.track.musicStartTime > 0 ? this.track.musicStartTime : 0);
    let offset = fromOffset !== undefined ? fromOffset : this.pausedAt;
    // Always skip initial conversation/dialogue part if any that is without music (unless strict start song)
    if (!isStrict && fromOffset === undefined && this.pausedAt < musicStart) {
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

  /**
   * Plays `src` while it downloads, through the same EQ, trim and volume chain as a buffer.
   * The song's details stay on `track`; call upgradeToBuffer once its audio is decoded.
   */
  public attachStream(src: string) {
    this.releaseStream();
    const el = new Audio();
    el.preload = 'auto';
    el.preservesPitch = this.keepStreamPitch; // key lock on: speed changes keep the pitch; off: vinyl
    el.src = src;
    this.mediaEl = el;
    this.mediaSource = this.ctx.createMediaElementSource(el);
    this.mediaGain = this.ctx.createGain();
    this.mediaSource.connect(this.mediaGain);
    this.mediaGain.connect(this.lowFilter);
    const update = () => this.notifyUpdate();
    el.addEventListener('waiting', update);
    el.addEventListener('playing', update);
    el.addEventListener('canplay', update);
    el.addEventListener('loadedmetadata', () => {
      if (this.track && !this.track.audioBuffer && Number.isFinite(el.duration)) this.track.duration = el.duration;
      update();
    });
    el.addEventListener('ended', () => {
      if (this.mediaEl !== el) return;
      this.isPlaying = false;
      this.pausedAt = 0;
      update();
    });
    el.addEventListener('error', () => {
      if (this.mediaEl !== el) return;
      this.isPlaying = false;
      this.streamError = el.error?.message || 'The song could not be streamed';
      update();
    });
  }

  /** Why streaming stopped, if it failed (shown by the engine). */
  public streamError: string | null = null;

  /** True while the song plays from the stream, before its full audio is decoded. */
  public isStreaming(): boolean {
    return !!this.mediaEl && !this.track?.audioBuffer;
  }

  /** Streaming, playing, but waiting for data. */
  public isBuffering(): boolean {
    const el = this.mediaEl;
    return !!el && this.isPlaying && el.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
  }

  private playStream(fromOffset?: number) {
    const el = this.mediaEl!;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const isStrict = isStrictStartSong(this.track);
    const musicStart = isStrict ? 0 : (this.track?.musicStartTime && this.track.musicStartTime > 0 ? this.track.musicStartTime : 0);
    let offset = fromOffset ?? this.pausedAt;
    if (isStrict && fromOffset === undefined && this.pausedAt === 0) {
      offset = 0;
    } else if (!isStrict && fromOffset === undefined && this.pausedAt < musicStart) {
      offset = musicStart;
    }
    if (Math.abs(el.currentTime - offset) > 0.05) el.currentTime = offset;
    el.playbackRate = this.playbackRate;
    this.streamError = null;
    this.isPlaying = true;
    el.play().catch((err) => {
      if (this.mediaEl !== el || err?.name === 'AbortError') return; // replaced or paused meanwhile
      this.isPlaying = false;
      this.streamError = err?.message || 'The song could not be streamed';
      this.notifyUpdate();
    });
    this.notifyUpdate();
  }

  /**
   * The song's full audio is decoded: carry on from the same moment on the buffer (40 ms
   * crossfade, no gap) and drop the stream. `track` must be this deck's track with audioBuffer set.
   */
  public upgradeToBuffer(track: TrackMetadata) {
    if (!this.mediaEl || track !== this.track || !track.audioBuffer) return;
    const el = this.mediaEl;
    const position = el.currentTime;
    if (this.isPlaying && !el.paused) {
      const now = this.ctx.currentTime;
      const fadeOut = this.mediaGain!;
      fadeOut.gain.setValueAtTime(1, now);
      fadeOut.gain.linearRampToValueAtTime(0, now + SWAP_FADE_SECONDS);
      this.startSource(track.audioBuffer, Math.min(position, track.duration), now, true);
      this.startedAt = now - position / this.playbackRate;
      // The deck now plays from the buffer; the stream fades out, then is let go
      const nodes = { el, source: this.mediaSource, gain: this.mediaGain };
      this.mediaEl = null;
      this.mediaSource = null;
      this.mediaGain = null;
      window.setTimeout(() => VirtualDeck.disposeStream(nodes), (SWAP_FADE_SECONDS + 0.05) * 1000);
    } else {
      this.pausedAt = position;
      this.releaseStream();
    }
    this.notifyUpdate();
  }

  /** Stops and disconnects the current stream, if any. */
  private releaseStream() {
    if (!this.mediaEl) return;
    VirtualDeck.disposeStream({ el: this.mediaEl, source: this.mediaSource, gain: this.mediaGain });
    this.mediaEl = null;
    this.mediaSource = null;
    this.mediaGain = null;
  }

  private static disposeStream(s: { el: HTMLAudioElement; source: AudioNode | null; gain: AudioNode | null }) {
    s.el.pause();
    s.el.removeAttribute('src');
    s.el.load(); // aborts the download
    s.source?.disconnect();
    s.gain?.disconnect();
  }

  public pause() {
    if (!this.isPlaying) return;
    this.pausedAt = this.getCurrentTime();
    if (this.loop) this.lastLoop = { ...this.loop };
    this.loop = null;
    this.stopSource();
    this.mediaEl?.pause();
    this.isPlaying = false;
    this.notifyUpdate();
  }

  public stop() {
    this.stopSource();
    this.mediaEl?.pause();
    this.isPlaying = false;
    const isStrict = isStrictStartSong(this.track);
    this.pausedAt = isStrict ? 0 : (this.track?.musicStartTime && this.track.musicStartTime > 0 ? this.track.musicStartTime : 0);
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

  /**
   * Best part: jumps to the next hook after the current spot (each chorus / the drop in turn,
   * back to the first after the last). Returns which one, for the status line.
   */
  public jumpToHighlight(): { index: number; count: number; time: number } | null {
    if (!this.track) return null;
    const hooks = this.track.hooks?.length ? this.track.hooks.map((h) => h.time) : [this.track.highlightTime ?? this.track.cueInTime ?? 0];
    const now = this.getCurrentTime();
    let index = hooks.findIndex((t) => t > now + 2);
    if (index < 0) index = 0;
    this.seek(hooks[index]);
    return { index, count: hooks.length, time: hooks[index] };
  }

  public setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
    this.gainNode.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    this.notifyUpdate();
  }

  /** Key lock for streaming: with it on, a speed change of the stream keeps its pitch. */
  public setKeepStreamPitch(on: boolean) {
    this.keepStreamPitch = on;
    if (this.mediaEl) this.mediaEl.preservesPitch = on;
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
    if (this.mediaEl) this.mediaEl.playbackRate = this.playbackRate;
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

  /**
   * Filter-sweep exit: the high-pass rises from open to ~1.5 kHz between startTime and endTime,
   * so the outgoing song thins to a hiss and gets out of the way instead of its harmony
   * rubbing against a new song in a key that doesn't fit.
   */
  public scheduleFilterSweepOut(startTime: number, endTime: number) {
    const f = this.sweepFilter.frequency;
    f.cancelScheduledValues(this.ctx.currentTime);
    f.setValueAtTime(SWEEP_OPEN_HZ, this.ctx.currentTime);
    f.setValueAtTime(SWEEP_OPEN_HZ, startTime);
    f.exponentialRampToValueAtTime(SWEEP_CLOSED_HZ, endTime);
  }

  /** Opens the sweep filter again (after a mix, or when a mix is cancelled). */
  public resetFilterSweep() {
    const f = this.sweepFilter.frequency;
    f.cancelScheduledValues(this.ctx.currentTime);
    f.setTargetAtTime(SWEEP_OPEN_HZ, this.ctx.currentTime, 0.05);
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
    if (!this.isPlaying || !this.sourceNode || this.isStreaming() || !this.track || end <= start || end > this.track.duration) return false;
    this.sourceNode.loopStart = start;
    this.sourceNode.loopEnd = end;
    this.loop = { start, end };
    this.lastLoop = { start, end };
    this.loopInTime = null;
    this.notifyUpdate();
    return true;
  }

  /** Sets the loop IN (start) point. Snaps to the nearest beat if beat grid is known. */
  public setLoopIn(time?: number) {
    if (!this.track) return;
    const pos = time !== undefined ? time : this.getCurrentTime();
    const bpm = this.track.bpm || 120;
    const beat = 60 / bpm;
    const downbeat = this.track.firstDownbeatTime ?? 0;
    const snapped = (this.track.bpmConfidence ?? 0) >= 0.3
      ? Math.max(0, downbeat + Math.round((pos - downbeat) / beat) * beat)
      : Math.max(0, pos);

    this.loopInTime = snapped;

    // If currently looping, pressing IN moves the loop's start point
    if (this.loop && this.loop.end > snapped + 0.1) {
      this.setLoop(snapped, this.loop.end);
    }
    this.notifyUpdate();
  }

  /**
   * Sets the loop OUT (end) point and immediately starts looping between IN and OUT.
   * If already looping, pressing OUT exits the loop (standard DJ controller behavior).
   */
  public setLoopOut(time?: number): boolean {
    if (!this.track) return false;
    if (this.loop) {
      this.exitLoop();
      return false;
    }

    const pos = time !== undefined ? time : this.getCurrentTime();
    const bpm = this.track.bpm || 120;
    const beat = 60 / bpm;
    const downbeat = this.track.firstDownbeatTime ?? 0;

    let start = this.loopInTime;
    let end = (this.track.bpmConfidence ?? 0) >= 0.3
      ? Math.max(0, downbeat + Math.round((pos - downbeat) / beat) * beat)
      : Math.max(0, pos);

    if (start === null) {
      // If no IN point was set, default start to 1 bar (4 beats) prior to OUT
      start = Math.max(0, end - beat * 4);
    }

    if (end <= start + 0.1) {
      end = Math.min(this.track.duration, start + beat * 4);
    }

    if (end <= start) return false;

    return this.setLoop(start, end);
  }

  /** Leaves the loop and plays on seamlessly from where the loop is now. */
  public exitLoop() {
    if (!this.loop) return;
    const position = this.getCurrentTime();
    this.lastLoop = { ...this.loop };
    if (this.sourceNode) {
      this.sourceNode.loopStart = 0;
      this.sourceNode.loopEnd = 0; // back to looping the whole buffer (the default)
    }
    this.loop = null;
    this.startedAt = this.ctx.currentTime - position / this.playbackRate;
    this.notifyUpdate();
  }

  /** Toggles loop or re-enters the previous loop. */
  public reloop(): boolean {
    if (this.loop) {
      this.exitLoop();
      return false;
    }
    if (this.lastLoop && this.track) {
      this.seek(this.lastLoop.start);
      return this.setLoop(this.lastLoop.start, this.lastLoop.end);
    }
    return false;
  }

  public getLoop(): { start: number; end: number } | null {
    return this.loop;
  }

  public getLoopInTime(): number | null {
    return this.loopInTime;
  }

  public getLastLoop(): { start: number; end: number } | null {
    return this.lastLoop;
  }

  public getCurrentTime(): number {
    if (!this.track) return 0;
    if (this.isStreaming()) return this.isPlaying ? this.mediaEl!.currentTime : this.pausedAt;
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
    // A stream has no exact audio-clock anchor (and no beat grid yet): drums wait for the buffer
    return this.isPlaying && this.track && !this.isStreaming() ? { startedAt: this.startedAt, rate: this.playbackRate } : null;
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
      isStreaming: this.isStreaming(),
      isBuffering: this.isBuffering(),
      loop: this.loop,
      loopInTime: this.loopInTime,
      hasLastLoop: !!this.lastLoop,
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
