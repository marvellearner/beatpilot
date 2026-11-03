/**
 * AudioGraph: encapsulates the Web Audio API context, hardware graph,
 * master bus, 3-band / 4-band master equalizer, headroom compensation,
 * brickwall limiter, soft safety clipper, crossfader gains, and stereo VU analysers.
 *
 * Signal flow:
 * Decks / Echo FX / Rhythm -> masterBus -> eqFilters -> eqHeadroom -> limiter -> masterGain -> safetyClipper -> masterAnalyser -> channelSplitter -> speakers
 */

import { EQ_BANDS, EQ_MAX_DB, EQ_MIN_DB, EqBandId, EqGains, getMood } from '../Moods';

export const SAFETY_KNEE = 0.9;
export const SAFETY_CEILING = 0.99;

export function equalPowerCrossfade(pos: number): [number, number] {
  const clamped = Math.max(-1, Math.min(1, pos));
  const x = (clamped + 1) / 2;
  return [Math.cos((x * Math.PI) / 2), Math.sin((x * Math.PI) / 2)];
}

export class AudioGraph {
  public readonly ctx: AudioContext;

  // Master bus where all decks and percussion sum together
  public readonly masterBus: GainNode;

  // Master EQ chain & headroom
  public readonly eqFilters = new Map<EqBandId, BiquadFilterNode>();
  public readonly eqHeadroom: GainNode;
  public eqGains: EqGains = { ...getMood('normal').eq };

  // Dynamics & Master Output
  public readonly limiter: DynamicsCompressorNode;
  public readonly masterGain: GainNode;
  public masterVolume: number = 0.9;

  // Analysers for stereo VU metering
  public readonly masterAnalyser: AnalyserNode;
  public readonly masterAnalyserL: AnalyserNode;
  public readonly masterAnalyserR: AnalyserNode;
  public readonly channelSplitter: ChannelSplitterNode;

  // Deck crossfader gains
  public readonly crossfaderGainA: GainNode;
  public readonly crossfaderGainB: GainNode;
  public crossfaderPosition: number = -1; // -1 = Deck A 100%, +1 = Deck B 100%

  constructor() {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AudioContextClass();

    // 1. Limiter to prevent clipping during multi-deck summing
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1.5;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.15;

    // 2. Master Gain
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.masterVolume;

    // 3. Master Analyser & Stereo Channel Splitter for Live VU Meters
    this.masterAnalyser = this.ctx.createAnalyser();
    this.masterAnalyser.fftSize = 512;

    this.channelSplitter = this.ctx.createChannelSplitter(2);
    this.masterAnalyserL = this.ctx.createAnalyser();
    this.masterAnalyserR = this.ctx.createAnalyser();
    this.masterAnalyserL.fftSize = 256;
    this.masterAnalyserR.fftSize = 256;

    // 4. Chain: Limiter -> Master Gain -> Safety Clipper -> Master Analyser -> Output
    this.limiter.connect(this.masterGain);
    const [clipIn, clipOut] = this.createSafetyClipper();
    this.masterGain.connect(clipIn);
    clipOut.connect(this.masterAnalyser);
    this.masterAnalyser.connect(this.channelSplitter);
    this.channelSplitter.connect(this.masterAnalyserL, 0);
    this.channelSplitter.connect(this.masterAnalyserR, 1);
    this.masterAnalyser.connect(this.ctx.destination);

    // 5. Master Equalizer chain
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

    // 6. Crossfader Gains for Deck A & Deck B
    this.crossfaderGainA = this.ctx.createGain();
    this.crossfaderGainB = this.ctx.createGain();
    this.crossfaderGainA.connect(this.masterBus);
    this.crossfaderGainB.connect(this.masterBus);

    // Initial crossfader at Deck A
    this.applyCrossfader(-1);
  }

  /**
   * Applies an equal-power crossfader curve between Deck A and Deck B.
   * pos: -1 = Deck A 100%, 0 = 50/50 blend, +1 = Deck B 100%
   */
  public applyCrossfader(pos: number): [number, number] {
    this.crossfaderPosition = Math.max(-1, Math.min(1, pos));
    const [gainA, gainB] = equalPowerCrossfade(this.crossfaderPosition);
    const now = this.ctx.currentTime;
    this.crossfaderGainA.gain.cancelScheduledValues(now);
    this.crossfaderGainB.gain.cancelScheduledValues(now);
    this.crossfaderGainA.gain.setTargetAtTime(gainA, now, 0.02);
    this.crossfaderGainB.gain.setTargetAtTime(gainB, now, 0.02);
    return [gainA, gainB];
  }

  /**
   * Schedules a whole mix's crossfader move on the audio clock (keeps running when the tab is
   * hidden). `crossfaderAt(progress)` gives the fader position for 0…1 of the mix; the gains follow
   * it on the equal-power curve. `crossfaderPosition` is not touched: the caller tracks it.
   */
  public scheduleCrossfadeCurve(crossfaderAt: (progress: number) => number, startTime: number, durationSeconds: number): void {
    const points = 64;
    const curveA = new Float32Array(points);
    const curveB = new Float32Array(points);
    for (let i = 0; i < points; i++) {
      [curveA[i], curveB[i]] = equalPowerCrossfade(crossfaderAt(i / (points - 1)));
    }
    const now = this.ctx.currentTime;
    this.crossfaderGainA.gain.cancelScheduledValues(now);
    this.crossfaderGainB.gain.cancelScheduledValues(now);
    this.crossfaderGainA.gain.setValueCurveAtTime(curveA, startTime, durationSeconds);
    this.crossfaderGainB.gain.setValueCurveAtTime(curveB, startTime, durationSeconds);
  }

  /**
   * Schedules a straight (linear) fade from fully `from` to fully the other deck over `fadeSeconds`
   * starting at `startTime`, then holds there.
   */
  public scheduleLinearCrossfade(from: 'A' | 'B', startTime: number, fadeSeconds: number): void {
    const [out, inc] = from === 'A' ? [this.crossfaderGainA, this.crossfaderGainB] : [this.crossfaderGainB, this.crossfaderGainA];
    const now = this.ctx.currentTime;
    out.gain.cancelScheduledValues(now);
    inc.gain.cancelScheduledValues(now);
    out.gain.setValueAtTime(1, startTime);
    inc.gain.setValueAtTime(0, startTime);
    out.gain.linearRampToValueAtTime(0, startTime + fadeSeconds);
    inc.gain.linearRampToValueAtTime(1, startTime + fadeSeconds);
    out.gain.setTargetAtTime(0, startTime + fadeSeconds, 0.001);
    inc.gain.setTargetAtTime(1, startTime + fadeSeconds, 0.001);
  }

  /** Sets the master volume (0.0 to 1.0). */
  public setMasterVolume(volume: number) {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    this.masterGain.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.03);
  }

  /** Sets one EQ band (dB) with dynamic headroom compensation. */
  public setEqBand(band: EqBandId, gainDb: number): void {
    const value = Math.max(EQ_MIN_DB, Math.min(EQ_MAX_DB, gainDb));
    this.eqGains = { ...this.eqGains, [band]: value };
    this.eqFilters.get(band)?.gain.setTargetAtTime(value, this.ctx.currentTime, 0.03);

    // Headroom: pull the level down by ~60% of the biggest boost so boosting bass doesn't clip
    const maxBoost = Math.max(0, ...Object.values(this.eqGains));
    const headroom = Math.pow(10, (-0.6 * maxBoost) / 20);
    this.eqHeadroom.gain.setTargetAtTime(headroom, this.ctx.currentTime, 0.03);
  }

  /** Applies a full EQ preset. */
  public applyEq(gains: EqGains): void {
    for (const band of EQ_BANDS) {
      this.setEqBand(band.id, gains[band.id]);
    }
  }

  /** Resumes the underlying AudioContext if suspended by browser autoplay policy. */
  public async resume(): Promise<void> {
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  /**
   * Soft-saturation curve safety clipper.
   * Passes everything up to SAFETY_KNEE (0.9) unchanged and smoothly tanh-compresses
   * anything louder so output never exceeds SAFETY_CEILING (0.99).
   */
  private createSafetyClipper(): [AudioNode, AudioNode] {
    const pre = this.ctx.createGain();
    pre.gain.value = 0.5;
    const shaper = this.ctx.createWaveShaper();
    const points = 4096;
    const curve = new Float32Array(points);
    const room = SAFETY_CEILING - SAFETY_KNEE;
    for (let i = 0; i < points; i++) {
      const x = 2 * ((2 * i) / (points - 1) - 1); // -2 … 2
      const a = Math.abs(x);
      curve[i] = Math.sign(x) * (a <= SAFETY_KNEE ? a : SAFETY_KNEE + room * Math.tanh((a - SAFETY_KNEE) / room));
    }
    shaper.curve = curve;
    shaper.oversample = '2x';
    pre.connect(shaper);
    return [pre, shaper];
  }
}

