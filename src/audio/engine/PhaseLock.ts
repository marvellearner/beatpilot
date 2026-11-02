/**
 * Live phase lock for beatmatched blends: what a DJ does by ear with the jog wheel. The two
 * songs' tempos are matched before the blend, but each beat grid comes from analysis and can sit
 * a fraction of a beat off (QA measured kicks 60–120 ms apart, heard as a flam). So during the
 * first bars of a blend both decks are listened to (kick and bass, before the EQ), the distance
 * between their beats is measured (beatPhase.ts), and the new song is nudged onto the old one's
 * beat; a second check a few seconds later fixes what's left. MIXING_RULES.md "Live phase lock".
 *
 * The loudness of each deck's low end is followed on the audio thread (an AudioWorklet), in 5 ms
 * frames stamped with the audio clock, so the main thread being busy doesn't blur it.
 */
import { beatOffset } from '../analysis/beatPhase';

const HOP_SECONDS = 0.005;
const KEEP_SECONDS = 15; // frames kept (a measurement looks back a few seconds)
export const PHASE_MIN_CLARITY = 2; // both songs need a clear beat in the stretch measured
export const PHASE_TOLERANCE_SECONDS = 0.012; // closer than this is already tight: left alone

const WORKLET = `
class PhaseLockTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.hop = Math.max(1, Math.round(sampleRate * ${HOP_SECONDS}));
    this.a = 1 - Math.exp((-2 * Math.PI * 150) / sampleRate); // one-pole low-pass at 150 Hz: kick and bass
    this.lp = [0, 0];
    this.sum = [0, 0];
    this.n = 0;
    this.out = [[], []];
    this.t0 = 0;
  }
  process(inputs) {
    const len = 128;
    for (let i = 0; i < len; i++) {
      if (this.n === 0 && this.out[0].length === 0) this.t0 = currentTime + i / sampleRate;
      for (let k = 0; k < 2; k++) {
        const inp = inputs[k];
        const x = inp && inp.length ? (inp[0][i] + (inp[1] || inp[0])[i]) / 2 : 0;
        this.lp[k] += this.a * (x - this.lp[k]);
        this.sum[k] += this.lp[k] * this.lp[k];
      }
      if (++this.n >= this.hop) {
        for (let k = 0; k < 2; k++) { this.out[k].push(Math.sqrt(this.sum[k] / this.hop)); this.sum[k] = 0; }
        this.n = 0;
        if (this.out[0].length >= 20) {
          this.port.postMessage({ t: this.t0, hop: this.hop / sampleRate, a: this.out[0], b: this.out[1] });
          this.out = [[], []];
        }
      }
    }
    return true;
  }
}
registerProcessor('phase-lock-tap', PhaseLockTap);`;

type Batch = { t: number; hop: number; a: number[]; b: number[] };

export class PhaseLock {
  private batches: Batch[] = [];
  private ready = false;

  constructor(private ctx: AudioContext, deckA: AudioNode, deckB: AudioNode) {
    void this.init(deckA, deckB);
  }

  private async init(deckA: AudioNode, deckB: AudioNode) {
    try {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await this.ctx.audioWorklet.addModule(url);
      const node = new AudioWorkletNode(this.ctx, 'phase-lock-tap', { numberOfInputs: 2, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
      deckA.connect(node, 0, 0);
      deckB.connect(node, 0, 1);
      const mute = this.ctx.createGain();
      mute.gain.value = 0; // keeps the tap running without adding sound
      node.connect(mute).connect(this.ctx.destination);
      node.port.onmessage = ({ data }: MessageEvent<Batch>) => {
        this.batches.push(data);
        const keepFrom = data.t - KEEP_SECONDS;
        while (this.batches.length && this.batches[0].t < keepFrom) this.batches.shift();
      };
      this.ready = true;
    } catch (err) {
      console.warn('[PhaseLock] unavailable (no AudioWorklet): beat grids are used as analysed', err);
    }
  }

  /**
   * How far the incoming deck's beats are from the outgoing deck's between audio-clock times
   * `from` and `to` (seconds, positive = incoming late), or null when it can't be measured
   * (no worklet, too short a stretch, or no clear beat on either side).
   */
  public measure(from: number, to: number, beatSec: number, incoming: 'A' | 'B'): { offsetSec: number; clarity: number } | null {
    if (!this.ready) return null;
    const a: number[] = [];
    const b: number[] = [];
    let t0: number | null = null;
    let hop = HOP_SECONDS;
    for (const batch of this.batches) {
      hop = batch.hop;
      for (let i = 0; i < batch.a.length; i++) {
        const t = batch.t + i * batch.hop;
        if (t < from || t > to) continue;
        t0 ??= t;
        a.push(batch.a[i]);
        b.push(batch.b[i]);
      }
    }
    if (t0 === null || a.length * hop < 4 * beatSec) return null;
    const [out, inc] = incoming === 'B' ? [a, b] : [b, a];
    const r = beatOffset(out, inc, t0, hop, beatSec);
    return r.clarity >= PHASE_MIN_CLARITY ? r : null;
  }
}
