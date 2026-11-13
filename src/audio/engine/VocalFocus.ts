/**
 * VocalFocus: the "Music" fader. Lowers the music and keeps the vocals, in real time, with no
 * processing ahead of time.
 *
 * How: next to the untouched song ("dry") runs a vocal path, and the fader turns the dry song down
 * and the vocal path up. The vocal path is the vocalIsolator on the audio thread: frequency by
 * frequency it keeps what is centred, not a hit and not held steady. Where the audio thread isn't
 * available, the song's centre band-limited to the voice range is used instead.
 *
 *   music 100 %: the song as it is
 *   music  50 %: the song at half level + the vocal path: music clearly lower, voice in front
 *   music   0 %: the vocal path only: mostly voice, instruments much lower but still faintly there
 *
 * Signal flow:  input ─┬─ dry (delayed to match the isolator while the fader is down) ─┬─ output
 *                      └─ vocalIsolator (worklet) ─────────────────────────────────────┘
 */
import { createVocalIsolator, VOCAL_ISOLATOR_LATENCY } from './vocalIsolator';

/** Voice range kept by the vocal path. */
export const VOCAL_LOW_HZ = 180;
export const VOCAL_HIGH_HZ = 5500;
/**
 * Vocal path level. 0.9 measured right on test tones, but on real songs (several voice harmonics
 * through the presence boost) the voice came out +3 dB and the peaks +4.5 dB, pushing the master
 * limiter. At 0.75 the voice stays about as loud as in the song.
 */
const VOCAL_MAKEUP = 0.75;
const RAMP_SECONDS = 0.05;

/** Dry (whole song) and vocal-path levels for a music level 0…1. */
export function vocalFocusGains(musicLevel: number): { dry: number; vocal: number } {
  const m = Math.max(0, Math.min(1, musicLevel));
  // The vocal path fades in as the music goes down; full song at 1, vocal path only at 0
  return { dry: m, vocal: (1 - m) * VOCAL_MAKEUP };
}

const WORKLET = `
const createVocalIsolator = ${createVocalIsolator.toString()};
class VocalIsolatorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.isolator = null;
    // Off at 100 %: no work, and each time it is switched on it starts clean
    this.port.onmessage = (e) => { this.isolator = e.data.active ? createVocalIsolator(sampleRate) : null; };
  }
  process(inputs, outputs) {
    const input = inputs[0];
    if (this.isolator && input.length) this.isolator.process(input[0], input[1] || input[0], outputs[0][0]);
    return true;
  }
}
registerProcessor('vocal-isolator', VocalIsolatorProcessor);
`;

/** The worklet code, added once per audio context (both decks share it). */
const workletLoaded = new WeakMap<BaseAudioContext, Promise<void>>();
function loadWorklet(ctx: BaseAudioContext): Promise<void> {
  let loaded = workletLoaded.get(ctx);
  if (!loaded) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    loaded = ctx.audioWorklet.addModule(url);
    workletLoaded.set(ctx, loaded);
  }
  return loaded;
}

export class VocalFocus {
  public readonly input: GainNode;
  public readonly output: GainNode;
  private readonly dry: GainNode;
  private readonly vocal: GainNode;
  private level = 1;
  // Once the isolator is running: the dry song's delayed route, and the worklet itself
  private dryAligned: GainNode | null = null;
  private isolator: AudioWorkletNode | null = null;
  private isolatorOn = false;

  constructor(private readonly ctx: BaseAudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.vocal = ctx.createGain();

    // Mono centre: a one-channel node downmixes stereo to (L+R)/2 ("speakers" interpretation)
    const centre = ctx.createGain();
    centre.channelCount = 1;
    centre.channelCountMode = 'explicit';
    centre.channelInterpretation = 'speakers';

    // Two filters each side (4th order, Butterworth Q pair): one 2nd-order stage only took
    // cymbals down ~8 dB and let the kick and bass through
    const filter = (type: BiquadFilterType, hz: number, q: number) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = hz;
      f.Q.value = q;
      return f;
    };
    const highPass1 = filter('highpass', VOCAL_LOW_HZ, 0.54);
    const highPass2 = filter('highpass', VOCAL_LOW_HZ, 1.31);
    const lowPass1 = filter('lowpass', VOCAL_HIGH_HZ, 0.54);
    const lowPass2 = filter('lowpass', VOCAL_HIGH_HZ, 1.31);
    const presence = ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 2500;
    presence.Q.value = 0.9;
    presence.gain.value = 3;

    this.input.connect(this.dry);
    this.dry.connect(this.output);
    this.input.connect(centre); // replaced by the isolator as soon as it has loaded
    centre.connect(highPass1);
    highPass1.connect(highPass2);
    highPass2.connect(lowPass1);
    lowPass1.connect(lowPass2);
    lowPass2.connect(presence);
    presence.connect(this.vocal);
    this.vocal.connect(this.output); // mono is spread to both speakers again here

    const g = vocalFocusGains(1);
    this.dry.gain.value = g.dry;
    this.vocal.gain.value = g.vocal;

    if (ctx.audioWorklet) {
      void loadWorklet(ctx)
        .then(() => this.useIsolator(centre))
        .catch((err) => console.warn('[VocalFocus] no audio thread: using the centre and band filters', err));
    }
  }

  /** Swaps the filter path for the isolator, and adds the delayed dry route that lines up with it. */
  private useIsolator(centre: GainNode): void {
    const node = new AudioWorkletNode(this.ctx, 'vocal-isolator', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 2,
      channelCountMode: 'explicit',
    });
    const delay = this.ctx.createDelay(0.1);
    delay.delayTime.value = VOCAL_ISOLATOR_LATENCY / this.ctx.sampleRate;
    this.dryAligned = this.ctx.createGain();
    this.dryAligned.gain.value = 0;
    this.input.connect(delay);
    delay.connect(this.dryAligned);
    this.dryAligned.connect(this.output);
    this.input.connect(node);
    node.connect(this.vocal);
    this.input.disconnect(centre);
    this.isolator = node;
    this.setMusicLevel(this.level);
  }

  /** Music level 0…1 (1 = the song as it is, 0 = vocals only). */
  public get musicLevel(): number {
    return this.level;
  }

  /** How late the output is while the isolator runs (0 on the filter fallback). */
  public get latencySeconds(): number {
    return this.isolator ? VOCAL_ISOLATOR_LATENCY / this.ctx.sampleRate : 0;
  }

  /**
   * Sets the music level at an exact audio-clock time (a vocal overlay revealing the full song on
   * its chorus downbeat). The song stays on the isolator-delayed route even at 100 %, so its timing
   * doesn't jump mid-song; `settle` moves it back to the direct route when the deck is silent.
   */
  public scheduleMusicLevel(level: number, at: number): void {
    this.level = Math.max(0, Math.min(1, level));
    const g = vocalFocusGains(this.level);
    if (this.isolator && this.dryAligned) {
      if (!this.isolatorOn) {
        this.isolatorOn = true;
        this.isolator.port.postMessage({ active: true });
      }
      this.dry.gain.setTargetAtTime(0, this.ctx.currentTime, RAMP_SECONDS);
      this.dryAligned.gain.setTargetAtTime(g.dry, at, 0.01);
    } else {
      this.dry.gain.setTargetAtTime(g.dry, at, 0.01);
    }
    this.vocal.gain.setTargetAtTime(g.vocal, at, 0.01);
  }

  /** Back to the routing for the current level right away (call while the deck is silent). */
  public settle(): void {
    this.setMusicLevel(this.level);
  }

  public setMusicLevel(level: number): void {
    this.level = Math.max(0, Math.min(1, level));
    const g = vocalFocusGains(this.level);
    const now = this.ctx.currentTime;
    // While the isolator runs its output is a little late: the dry song waits for it. At 100 % the
    // song plays with no delay at all
    const on = !!this.isolator && this.level < 1;
    this.dry.gain.setTargetAtTime(on ? 0 : g.dry, now, RAMP_SECONDS);
    if (this.dryAligned) this.dryAligned.gain.setTargetAtTime(on ? g.dry : 0, now, RAMP_SECONDS);
    this.vocal.gain.setTargetAtTime(g.vocal, now, RAMP_SECONDS);
    if (this.isolator && on !== this.isolatorOn) {
      this.isolatorOn = on;
      this.isolator.port.postMessage({ active: on });
    }
  }
}
