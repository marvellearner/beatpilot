/**
 * Live Rhythm Enhancer (Deck P): real dhol, dholak and percussion samples played on top of
 * the song on air.
 *
 * Timing: every hit is scheduled individually on the audio clock, about 0.2 s ahead, at a
 * time computed from the on-air song's own beat grid (its BPM and downbeat, in song seconds,
 * mapped through the deck's start time and playback rate). Nothing loops, so the layer
 * can't drift, follows tempo changes and mixes exactly, and its pitch never changes.
 *
 * What plays: in AI mode (the default) each song's RhythmPlan, made by the AI DJ from the
 * song itself (see rhythmPlan.ts), decides whether drums play, the style and the level. In
 * manual mode the user's style and level apply to every song.
 *
 * Arrangement: per bar, from the song's loudness (see arrangement.ts). During a beatmatched
 * mix it steps back to the light groove; during a cut it rests.
 */
import { VOICES, loadKit, type VoiceId } from './kit';
import { RHYTHM_STYLES, getRhythmStyle, hitVelocity, swungBeatOffset, type RhythmStyleId } from './styles';
import { planArrangement, steadyArrangement, type Arrangement, type RhythmSection } from './arrangement';
import type { EnergyProfile } from '../MixPointPlanner';
import type { RhythmPlan } from './rhythmPlan';

export { RHYTHM_STYLES };
export type { RhythmStyleId, RhythmSection, RhythmPlan };

/** Where the on-air song is, in a form the scheduler can turn into audio-clock times. */
export interface SongClock {
  trackId: string;
  isPlaying: boolean;
  bpm: number; // tempo of the deck's audio, in song seconds
  bpmConfidence: number;
  downbeat: number; // a bar start, song seconds
  rate: number; // deck playback rate
  startedAt: number; // audio-clock time of song position 0: position = (now - startedAt) * rate
  duration: number;
  energyProfile?: EnergyProfile;
  musicStartTime?: number;
  hookTime?: number;
  transition: 'none' | 'blend' | 'cut'; // a mix in progress
  plan: RhythmPlan | null; // what the AI DJ (or the fallback rules) chose for this song
}

export interface RhythmState {
  enabled: boolean;
  mode: 'ai' | 'manual'; // AI picks per song, or the user's choices apply to every song
  styleId: RhythmStyleId; // the style playing (AI mode) or chosen (manual)
  plan: RhythmPlan | null; // the on-air song's plan (AI mode)
  followSong: boolean; // manual mode: arrangement follows the song's energy (otherwise a steady layer)
  level: number; // 0–1, overall volume of the layer
  muted: boolean;
  samplesReady: boolean;
  section: RhythmSection | 'fill'; // what is playing right now
  status: string;
  bpm: number | null; // tempo it is locked to
}

export type RhythmCommand =
  | { kind: 'toggle' }
  | { kind: 'style'; styleId: RhythmStyleId }
  | { kind: 'mode' }
  | { kind: 'followSong' }
  | { kind: 'level'; level: number }
  | { kind: 'mute' };

const LOOKAHEAD_SECONDS = 0.2;
const TICK_MS = 25;
const MIN_CONFIDENCE = 0.5; // below this the beat grid isn't trustworthy enough to play on
const HALF_TIME_ABOVE_BPM = 140; // fast songs (e.g. 170+ bhangra) get the groove at half speed
const SETTINGS_KEY = 'ai_dj_rhythm_settings_v2';

const dbToGain = (db: number) => Math.pow(10, db / 20);
const sectionRank = { off: 0, light: 1, full: 2 } as const;

export class RhythmEnhancer {
  private ctx: AudioContext;
  private getClock: () => SongClock | null;
  private onChange: () => void;

  private kit = new Map<VoiceId, AudioBuffer[]>();
  private voiceInputs = new Map<VoiceId, AudioNode>();
  private bus: GainNode;
  private active = new Set<AudioBufferSourceNode>();
  private lastTake = new Map<VoiceId, number>();

  private enabled = true; // on by default: in AI mode the AI decides per song whether drums play
  private mode: 'ai' | 'manual' = 'ai';
  private styleId: RhythmStyleId = 'dhol_dhamaal'; // playing now
  private manualStyleId: RhythmStyleId = 'dhol_dhamaal'; // the user's choice in manual mode
  private pendingStyleId: RhythmStyleId | null = null; // switched on the next bar line
  private followSong = true;
  private level = 0.8;
  private plan: RhythmPlan | null = null;
  private planGain = 1;
  private muted = false;
  private samplesReady = false;
  private section: RhythmSection | 'fill' = 'off';
  private status = 'Off';
  private lockedBpm: number | null = null;

  private gridKey = '';
  private nextStep: number | null = null; // next step (16th) to schedule, counted from the downbeat
  private arrangement: Arrangement | null = null;
  private arrangementKey = '';

  constructor(ctx: AudioContext, destination: AudioNode, getClock: () => SongClock | null, onChange: () => void) {
    this.ctx = ctx;
    this.getClock = getClock;
    this.onChange = onChange;

    // Voices -> level -> gentle glue compressor -> master
    this.bus = ctx.createGain();
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -20;
    glue.knee.value = 10;
    glue.ratio.value = 3;
    glue.attack.value = 0.003;
    glue.release.value = 0.12;
    const out = ctx.createGain();
    out.gain.value = 0.75;
    this.bus.connect(glue).connect(out).connect(destination);

    for (const voice of Object.keys(VOICES) as VoiceId[]) {
      const lowCut = ctx.createBiquadFilter();
      lowCut.type = 'highpass';
      lowCut.frequency.value = VOICES[voice].lowCutHz;
      lowCut.Q.value = 0.707;
      const pan = ctx.createStereoPanner();
      pan.pan.value = VOICES[voice].pan;
      lowCut.connect(pan).connect(this.bus);
      this.voiceInputs.set(voice, lowCut);
    }

    this.loadSettings();
    this.applyLevel();
    void loadKit(ctx).then((kit) => {
      this.kit = kit;
      this.samplesReady = [...kit.values()].some((takes) => takes.length > 0);
      if (!this.samplesReady) this.status = 'Drum samples failed to load (see console)';
      this.onChange();
    });
    window.setInterval(() => this.tick(), TICK_MS);
  }

  // --- Controls ---

  public command(cmd: RhythmCommand) {
    switch (cmd.kind) {
      case 'toggle':
        this.setEnabled(!this.enabled);
        break;
      case 'style':
        this.mode = 'manual';
        this.manualStyleId = cmd.styleId;
        this.switchStyle(cmd.styleId);
        this.applyLevel();
        break;
      case 'mode':
        this.mode = this.mode === 'ai' ? 'manual' : 'ai';
        if (this.mode === 'manual') this.switchStyle(this.manualStyleId);
        this.plan = null; // AI mode picks the song's plan up again on the next tick
        this.arrangementKey = '';
        this.applyLevel();
        break;
      case 'followSong':
        this.followSong = !this.followSong;
        this.arrangementKey = '';
        break;
      case 'level':
        this.level = Math.max(0, Math.min(1, cmd.level));
        this.applyLevel();
        break;
      case 'mute':
        this.muted = !this.muted;
        this.applyLevel();
        break;
    }
    this.saveSettings();
    this.onChange();
  }

  public setEnabled(on: boolean) {
    if (this.enabled === on) return;
    this.enabled = on;
    this.nextStep = null;
    if (!on) {
      this.silence();
      this.section = 'off';
      this.status = 'Off';
    }
    this.saveSettings();
    this.onChange();
  }

  /** Stops hits that are already scheduled (pause, stop, seek). */
  public silence() {
    for (const src of this.active) {
      try {
        src.stop();
      } catch {
        // already stopped
      }
    }
    this.active.clear();
    this.nextStep = null;
  }

  public getState(): RhythmState {
    return {
      enabled: this.enabled,
      mode: this.mode,
      styleId: this.mode === 'manual' ? this.manualStyleId : (this.pendingStyleId ?? this.styleId),
      plan: this.mode === 'ai' ? this.plan : null,
      followSong: this.followSong,
      level: this.level,
      muted: this.muted,
      samplesReady: this.samplesReady,
      section: this.section,
      status: this.status,
      bpm: this.lockedBpm,
    };
  }

  private switchStyle(id: RhythmStyleId) {
    if (id === this.styleId) {
      this.pendingStyleId = null;
      return;
    }
    // Not playing: switch now. Playing: switch on the next bar line so the groove isn't cut mid-bar.
    if (this.enabled && this.nextStep !== null) this.pendingStyleId = id;
    else this.styleId = id;
  }

  private applyLevel() {
    // In AI mode the song's plan sets how present the layer is (0.7 = normal); the slider is the overall volume
    const planGain = this.mode === 'ai' ? this.planGain : 1;
    const gain = this.muted ? 0 : this.level * planGain;
    this.bus.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.15);
  }

  // --- Scheduling ---

  private setStatus(section: RhythmSection | 'fill', status: string, bpm: number | null) {
    if (section === this.section && status === this.status && bpm === this.lockedBpm) return;
    this.section = section;
    this.status = status;
    this.lockedBpm = bpm;
    this.onChange();
  }

  private tick() {
    if (!this.enabled || !this.samplesReady) return;
    const clock = this.getClock();
    if (!clock || !clock.isPlaying) {
      if (this.active.size) this.silence();
      this.nextStep = null;
      this.setStatus('off', clock ? 'Waiting for the music to play' : 'No song on air', null);
      return;
    }
    if (clock.bpmConfidence < MIN_CONFIDENCE || clock.bpm < 70 || clock.bpm > 200) {
      this.nextStep = null;
      this.setStatus('off', `Beat not clear enough to lock on (${Math.round(clock.bpmConfidence * 100)}%): drums held`, null);
      return;
    }

    if (this.mode === 'ai' && !this.followPlan(clock)) return;

    const halfTime = clock.bpm > HALF_TIME_ABOVE_BPM;
    const stepSeconds = (60 / clock.bpm / 4) * (halfTime ? 2 : 1); // song seconds per pattern step
    const barSeconds = stepSeconds * 16;
    const key = `${clock.trackId}|${clock.bpm}|${clock.downbeat}`;
    if (key !== this.gridKey) {
      // New song, or the same song re-timed (tempo lock): lock onto its grid afresh
      this.gridKey = key;
      this.nextStep = null;
    }
    this.ensureArrangement(clock, barSeconds, halfTime);

    const style = getRhythmStyle(this.styleId);
    const stepTime = (k: number) => {
      const bar = Math.floor(k / 16);
      const step = k - bar * 16;
      return clock.downbeat + bar * barSeconds + swungBeatOffset(step, style.swing) * stepSeconds * 4;
    };
    const toCtx = (songTime: number) => clock.startedAt + songTime / clock.rate;
    const now = this.ctx.currentTime;
    const songNow = (now - clock.startedAt) * clock.rate;

    // (Re)lock to the first step at or after now: on start, new song, or after a seek
    const drifted = this.nextStep !== null && (toCtx(stepTime(this.nextStep)) < now - 0.03 || stepTime(this.nextStep) > songNow + 2 * barSeconds);
    if (this.nextStep === null || drifted) {
      if (drifted) this.silence();
      let k = Math.floor((songNow - clock.downbeat) / stepSeconds);
      while (stepTime(k) < songNow) k++;
      this.nextStep = k;
    }

    while (toCtx(stepTime(this.nextStep)) < now + LOOKAHEAD_SECONDS) {
      const k = this.nextStep;
      if (k % 16 === 0 && this.pendingStyleId) {
        this.styleId = this.pendingStyleId;
        this.pendingStyleId = null;
      }
      this.scheduleStep(k, toCtx(stepTime(k)), clock);
      this.nextStep++;
    }

    // What's playing now, for the UI
    const bar = Math.floor((songNow - clock.downbeat) / barSeconds);
    const { section, fill, reason } = this.sectionFor(bar, clock);
    const name = getRhythmStyle(this.pendingStyleId ?? this.styleId).name;
    const tempo = Math.round(clock.bpm * clock.rate * (halfTime ? 0.5 : 1));
    const who = this.mode === 'ai' ? '🤖 ' : '';
    const label =
      section === 'off'
        ? `${who}${name} resting: ${reason}`
        : `${who}${name}${halfTime ? ' (half-time)' : ''}: ${fill ? 'fill' : reason}`;
    this.setStatus(fill ? 'fill' : section, label, tempo);
  }

  /**
   * AI mode: take the on-air song's plan. A new song's style applies at once (its grid is
   * new anyway); a plan that changes mid-song (the AI answered late) switches on the next bar.
   * Returns false when there is no plan yet or it says no drums on this song.
   */
  private followPlan(clock: SongClock): boolean {
    const plan = clock.plan;
    if (plan !== this.plan) {
      const sameSong = this.plan !== null && this.nextStep !== null && `${clock.trackId}|${clock.bpm}|${clock.downbeat}` === this.gridKey;
      this.plan = plan;
      if (plan) {
        if (sameSong) this.switchStyle(plan.styleId);
        else {
          this.styleId = plan.styleId;
          this.pendingStyleId = null;
        }
        this.planGain = Math.max(0.3, Math.min(1, plan.level)) / 0.7;
      }
      this.applyLevel();
      this.onChange();
    }
    if (!plan) {
      this.nextStep = null;
      this.setStatus('off', 'AI is listening to this song…', null);
      return false;
    }
    if (!plan.play) {
      if (this.active.size) this.silence();
      this.nextStep = null;
      this.setStatus('off', `🤖 No drums on this song: ${plan.reason}`, null);
      return false;
    }
    return true;
  }

  private ensureArrangement(clock: SongClock, barSeconds: number, halfTime: boolean) {
    const follow = this.mode === 'ai' || this.followSong;
    const key = `${clock.trackId}|${clock.bpm}|${clock.downbeat}|${halfTime}|${follow}|${clock.energyProfile ? 1 : 0}`;
    if (key === this.arrangementKey) return;
    this.arrangementKey = key;
    const input = {
      profile: clock.energyProfile!,
      barSeconds,
      downbeat: clock.downbeat,
      duration: clock.duration,
      musicStartTime: clock.musicStartTime,
      hookTime: clock.hookTime,
    };
    this.arrangement = follow && clock.energyProfile ? planArrangement(input) : steadyArrangement(input);
  }

  private sectionFor(bar: number, clock: SongClock): { section: RhythmSection; fill: boolean; reason: string } {
    const a = this.arrangement;
    if (!a || bar < 0 || bar >= a.sections.length) return { section: 'off', fill: false, reason: 'outside the song' };
    let section = a.sections[bar];
    let fill = a.fills[bar];
    let reason = a.reasons[bar];
    if (clock.transition === 'cut') return { section: 'off', fill: false, reason: 'mixing (cut)' };
    if (clock.transition === 'blend' && sectionRank[section] > sectionRank.light) {
      section = 'light';
      fill = false;
      reason = 'mixing: light groove';
    }
    return { section, fill, reason };
  }

  private scheduleStep(k: number, when: number, clock: SongClock) {
    const bar = Math.floor(k / 16);
    const step = k - bar * 16;
    const { section, fill } = this.sectionFor(bar, clock);
    if (section === 'off') return;
    const style = getRhythmStyle(this.styleId);

    // A fill bar keeps the full groove underneath and lets the fill's voices take over
    const voices = new Set<VoiceId>([
      ...(Object.keys(style[section]) as VoiceId[]),
      ...(fill ? (Object.keys(style.fill) as VoiceId[]) : []),
    ]);
    for (const voice of voices) {
      const pattern = fill && style.fill[voice] ? style.fill[voice] : (fill ? style.full : style[section])[voice];
      const velocity = hitVelocity(pattern, bar, step);
      if (velocity <= 0) continue;
      // Small human variation: ±3 ms (±1 ms on the downbeat) and ±8 % velocity
      const jitter = (Math.random() * 2 - 1) * (step === 0 ? 0.001 : 0.003);
      const t = when + jitter;
      if (t < this.ctx.currentTime) continue;
      this.playHit(voice, t, velocity * (0.92 + Math.random() * 0.16));
    }
  }

  private playHit(voice: VoiceId, when: number, velocity: number) {
    const takes = this.kit.get(voice);
    const input = this.voiceInputs.get(voice);
    if (!takes?.length || !input) return;
    // Round-robin without repeating the previous take
    let take = Math.floor(Math.random() * takes.length);
    if (takes.length > 1 && take === this.lastTake.get(voice)) take = (take + 1) % takes.length;
    this.lastTake.set(voice, take);

    const src = this.ctx.createBufferSource();
    src.buffer = takes[take];
    const gain = this.ctx.createGain();
    // Velocity on a curve so ghost notes are clearly softer
    gain.gain.value = Math.pow(Math.min(1.1, velocity), 1.6) * dbToGain(VOICES[voice].trimDb);
    src.connect(gain).connect(input);
    src.onended = () => {
      this.active.delete(src);
      gain.disconnect();
    };
    this.active.add(src);
    src.start(when);
  }

  // --- Settings (per browser) ---

  private loadSettings() {
    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (RHYTHM_STYLES.some((st) => st.id === s.manualStyleId)) this.manualStyleId = this.styleId = s.manualStyleId;
      if (s.mode === 'ai' || s.mode === 'manual') this.mode = s.mode;
      if (typeof s.enabled === 'boolean') this.enabled = s.enabled;
      if (typeof s.followSong === 'boolean') this.followSong = s.followSong;
      if (typeof s.level === 'number') this.level = Math.max(0, Math.min(1, s.level));
      if (typeof s.muted === 'boolean') this.muted = s.muted;
    } catch {
      // ignore unreadable settings
    }
  }

  private saveSettings() {
    try {
      window.localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({
          enabled: this.enabled,
          mode: this.mode,
          manualStyleId: this.manualStyleId,
          followSong: this.followSong,
          level: this.level,
          muted: this.muted,
        })
      );
    } catch {
      // storage unavailable
    }
  }
}
