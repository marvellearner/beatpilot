/**
 * VocalFocus: the "Music" fader. Lowers the music and keeps the vocals, in real time, with no
 * processing ahead of time.
 *
 * How: a lead vocal is almost always in the centre of the stereo mix and between ~180 Hz and
 * ~5.5 kHz. Next to the untouched song ("dry") runs a vocal path: the song's centre (L+R, which
 * drops everything panned to the sides), band-limited to the voice range (drops the bass, kick
 * and cymbals) with a little presence. The fader turns the dry song down and the vocal path up:
 *
 *   music 100 %: the song as it is
 *   music  50 %: the song at half level + the vocal path: music clearly lower, voice in front
 *   music   0 %: the vocal path only: mostly voice, centred instruments in its range stay faint
 *
 * It isn't true separation (an AI stem model is: when a song has stems, they replace this path).
 *
 * Signal flow:  input ─┬─ dry ──────────────────────────────────────────┬─ output
 *                      └─ mono centre → HPF 180 → LPF 5.5k → presence ─┘
 */

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

export class VocalFocus {
  public readonly input: GainNode;
  public readonly output: GainNode;
  private readonly dry: GainNode;
  private readonly vocal: GainNode;
  private level = 1;

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
    this.input.connect(centre);
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
  }

  /** Music level 0…1 (1 = the song as it is, 0 = vocals only). */
  public get musicLevel(): number {
    return this.level;
  }

  public setMusicLevel(level: number): void {
    this.level = Math.max(0, Math.min(1, level));
    const g = vocalFocusGains(this.level);
    const now = this.ctx.currentTime;
    this.dry.gain.setTargetAtTime(g.dry, now, RAMP_SECONDS);
    this.vocal.gain.setTargetAtTime(g.vocal, now, RAMP_SECONDS);
  }
}
