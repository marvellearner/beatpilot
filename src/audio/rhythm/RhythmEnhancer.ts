/**
 * Live Rhythm Enhancer (Deck P): a dhol wala playing along with the DJ, on real dhol and dholak
 * samples.
 *
 * What a wedding dhol player does, and what this does:
 * - plays WITH the song: keeps time softly under the singing, answers in the gaps between vocal
 *   lines, comes in with the full taal on choruses, hooks and instrumental parts, rolls into a
 *   chorus and lands it with an accent, closes a section with a tihai (dholScore.ts);
 * - carries the crowd through the DJ's mixes: on a cut between songs it plays a dhol break on the
 *   old song's beat and lands exactly on the new song's first downbeat; in a beatmatched blend it
 *   keeps a light groove;
 * - takes requests: Roll, Dhol break, Dhamaal (go big) and Rest (live cues).
 *
 * Which songs and which taal: each song's RhythmPlan (rhythmPlan.ts) in AI mode, or the user's
 * taal in manual mode. Timing: every stroke is scheduled on the audio clock, about 0.25 s ahead,
 * from the on-air song's own beat grid (BPM and downbeat, mapped through the deck's start time and
 * playback rate). Nothing loops, so it can't drift, and it follows tempo changes exactly.
 */
import { VOICES, loadKit, type VoiceId } from './kit';
import { RHYTHM_STYLES, getRhythmStyle, isRhythmStyleId, type RhythmStyle, type RhythmStyleId } from './styles';
import { planDholScore, steadyDholScore, type ScoreBar } from './dholScore';
import { barHits, rollVelocity, type BarExtras, type BarPlay } from './dholEvents';
import type { EnergyProfile } from '../MixPointPlanner';
import type { RhythmPlan, VocalMap } from './rhythmPlan';

export { RHYTHM_STYLES };
export type { RhythmStyleId, RhythmPlan };
export type RhythmSection = 'off' | 'light' | 'full';

/** One song's beat grid and position, in a form the scheduler can turn into audio-clock times. */
export interface DeckClock {
  trackId: string;
  bpm: number; // tempo of the deck's audio, in song seconds
  bpmConfidence: number;
  downbeat: number; // a bar start, song seconds
  rate: number; // deck playback rate
  startedAt: number; // audio-clock time of song position 0: position = (now - startedAt) * rate
  duration: number;
  energyProfile?: EnergyProfile;
  musicStartTime?: number;
  hookTime?: number;
  plan: RhythmPlan | null; // what the AI DJ (or the rules) chose for this song
  forceFullTime?: boolean; // keep the taal at full speed on a fast song (party mood, folk meter)
  vocal?: VocalMap; // where the singing is (measured on the song at its natural tempo)
}

/** The song on air, plus the song coming in during a mix. */
export interface SongClock extends DeckClock {
  isPlaying: boolean;
  transition: 'none' | 'blend' | 'cut'; // a mix in progress: beatmatched or not
  incoming?: DeckClock & { startsAt: number }; // the next song and when it starts (audio clock)
}

export type RhythmCue = 'roll' | 'break' | 'dhamaal' | 'rest';

export interface RhythmState {
  enabled: boolean;
  mode: 'ai' | 'manual'; // AI picks per song, or the user's taal applies to every song
  styleId: RhythmStyleId; // the taal playing (AI mode) or chosen (manual)
  plan: RhythmPlan | null; // the on-air song's plan (AI mode)
  followSong: boolean; // manual mode: follows the song (dhol wala) or a steady taal
  level: number; // 0–1, overall volume of the layer
  muted: boolean;
  samplesReady: boolean;
  section: RhythmSection | 'fill'; // what is playing right now (fill = a roll, tihai or break)
  status: string;
  bpm: number | null; // tempo it is locked to
  cues: { dhamaal: boolean; rest: boolean; breakComing: boolean; rolling: boolean };
}

export type RhythmCommand =
  | { kind: 'toggle' }
  | { kind: 'style'; styleId: RhythmStyleId }
  | { kind: 'mode' }
  | { kind: 'followSong' }
  | { kind: 'level'; level: number }
  | { kind: 'mute' }
  | { kind: 'cue'; cue: RhythmCue };

const LOOKAHEAD_SECONDS = 0.25;
const TICK_MS = 25;
const MIN_CONFIDENCE = 0.5; // below this the beat grid isn't trustworthy enough to play on
const HALF_TIME_ABOVE_BPM = 140; // fast songs (e.g. 170+ bhangra) get the taal at half speed
const SETTINGS_KEY = 'ai_dj_rhythm_settings_v3';
const BREAK_BARS = 2;
const BRIDGE_ROLL_SECONDS = 1.2; // a bridge ends with a roll this long into the new song's first downbeat
const ROLL_STROKE_SECONDS = 0.07;
const BRIDGE = 'bridge'; // queue entries of the bridge roll (timed in seconds, not on a grid)

const dbToGain = (db: number) => Math.pow(10, db / 20);

interface Grid {
  key: string;
  trackId: string;
  clock: DeckClock;
  beatSeconds: number; // song seconds per taal beat (doubled at half-time)
  barSeconds: number;
  halfTime: boolean;
}

interface Queued {
  time: number; // audio clock
  voice: VoiceId;
  velocity: number;
  muted?: boolean;
  gridKey: string;
  bar: number;
}

export class RhythmEnhancer {
  private ctx: AudioContext;
  private getClock: () => SongClock | null;
  private onChange: () => void;

  private kit = new Map<VoiceId, AudioBuffer[]>();
  private voiceInputs = new Map<VoiceId, AudioNode>();
  private bus: GainNode;
  private active = new Set<AudioBufferSourceNode>();
  private lastTake = new Map<VoiceId, number>();

  // Settings
  private enabled = true; // on by default: in AI mode the plan decides per song whether the dhol plays
  private mode: 'ai' | 'manual' = 'ai';
  private manualStyleId: RhythmStyleId = 'bhangra_chaal';
  private followSong = true;
  private level = 0.8;
  private muted = false;
  private samplesReady = false;

  // Cues
  private dhamaal = false;
  private restTrackId: string | null = null; // resting until this song changes
  private breakFrom: { gridKey: string; bar: number } | null = null; // a dhol break starts on this bar
  private breakRequested = false;
  // A cued roll: from `fromBeat` of `bar` to the bar line ending `bar + bars - 1` (1 or 2 bars)
  private roll: { gridKey: string; bar: number; fromBeat: number; bars: number } | null = null;

  // Scheduling
  private grid: Grid | null = null;
  private nextBar: number | null = null; // next bar of `grid` to put in the queue
  private queue: Queued[] = [];
  private score: ScoreBar[] = [];
  private scoreKey = '';
  private landingBar: { gridKey: string; bar: number; rolled: boolean } | null = null; // a bridge lands here (rolled: its roll was played)
  private lastClock: SongClock | null = null; // the clock of the current tick (read once per tick)
  private situation = ''; // mix state the queued bars were planned for
  private bridgeRollFor: number | null = null; // the handover a bridge roll was queued for
  private planGain = 1;

  // Shown in the UI
  private section: RhythmSection | 'fill' = 'off';
  private status = 'Off';
  private lockedBpm: number | null = null;
  private shownStyle: RhythmStyleId = 'bhangra_chaal';
  private shownPlan: RhythmPlan | null = null;

  constructor(ctx: AudioContext, destination: AudioNode, getClock: () => SongClock | null, onChange: () => void) {
    this.ctx = ctx;
    this.getClock = getClock;
    this.onChange = onChange;

    // Heads -> level -> gentle glue compressor -> master
    this.bus = ctx.createGain();
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -20;
    glue.knee.value = 10;
    glue.ratio.value = 3;
    glue.attack.value = 0.003;
    glue.release.value = 0.12;
    const out = ctx.createGain();
    // The dhol wala's overall level (was 0.75; raised 50 %, 2026-11-05: it sat too far behind the song)
    out.gain.value = 1.125;
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
      if (!this.samplesReady) this.status = 'Dhol samples failed to load (see console)';
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
        this.rebuildAhead();
        break;
      case 'mode':
        this.mode = this.mode === 'ai' ? 'manual' : 'ai';
        this.rebuildAhead();
        break;
      case 'followSong':
        this.followSong = !this.followSong;
        this.scoreKey = '';
        this.rebuildAhead();
        break;
      case 'level':
        this.level = Math.max(0, Math.min(1, cmd.level));
        break;
      case 'mute':
        this.muted = !this.muted;
        break;
      case 'cue':
        this.cue(cmd.cue);
        break;
    }
    this.applyLevel();
    this.saveSettings();
    this.onChange();
  }

  /** Live requests, like asking the dhol wala. */
  private cue(cue: RhythmCue) {
    if (!this.enabled) this.setEnabled(true);
    const grid = this.grid;
    switch (cue) {
      case 'rest':
        if (this.restTrackId) {
          this.restTrackId = null; // back in
        } else {
          this.restTrackId = grid?.trackId ?? this.getClock()?.trackId ?? '*';
          this.dhamaal = false;
          this.breakFrom = null;
          this.roll = null;
          this.dropQueued(this.ctx.currentTime + 0.01, true);
        }
        this.rebuildAhead();
        break;
      case 'dhamaal':
        this.dhamaal = !this.dhamaal;
        if (this.dhamaal) this.restTrackId = null;
        this.rebuildAhead();
        break;
      case 'break': {
        this.restTrackId = null;
        if (!grid) {
          this.breakRequested = true; // starts once the dhol has a beat to play on
          break;
        }
        const bar = this.barAt(grid, this.ctx.currentTime) + 1; // from the next bar line
        this.breakFrom = { gridKey: grid.key, bar };
        this.rebuildAhead();
        break;
      }
      case 'roll': {
        this.restTrackId = null;
        if (!grid) break;
        // Right away, from the next half beat, to the bar line; when that's too close for a roll you
        // can hear, on through the next bar too (one continuous crescendo)
        const beatNow = this.beatAt(grid, this.ctx.currentTime + 0.06);
        const bar = Math.floor(beatNow / 4);
        const fromBeat = Math.min(3.5, Math.ceil((beatNow - bar * 4) * 2) / 2);
        this.roll = { gridKey: grid.key, bar, fromBeat, bars: 4 - fromBeat < 1.5 ? 2 : 1 };
        this.rebuildAhead();
        break;
      }
    }
  }

  public setEnabled(on: boolean) {
    if (this.enabled === on) return;
    this.enabled = on;
    if (!on) {
      this.silence();
      this.section = 'off';
      this.status = 'Off';
    }
    this.saveSettings();
    this.onChange();
  }

  /** Stops strokes already scheduled (pause, stop, seek) and re-locks on the next tick. */
  public silence() {
    for (const src of this.active) {
      try {
        src.stop();
      } catch {
        // already stopped
      }
    }
    this.active.clear();
    this.queue = [];
    this.nextBar = null;
  }

  public getState(): RhythmState {
    const now = this.ctx.currentTime;
    return {
      enabled: this.enabled,
      mode: this.mode,
      styleId: this.mode === 'manual' ? this.manualStyleId : this.shownStyle,
      plan: this.mode === 'ai' ? this.shownPlan : null,
      followSong: this.followSong,
      level: this.level,
      muted: this.muted,
      samplesReady: this.samplesReady,
      section: this.section,
      status: this.status,
      bpm: this.lockedBpm,
      cues: {
        dhamaal: this.dhamaal,
        rest: this.restTrackId !== null,
        breakComing: this.breakRequested || (this.breakFrom !== null && this.grid !== null && this.barAt(this.grid, now) < this.breakFrom.bar + BREAK_BARS),
        rolling: this.roll !== null && this.grid !== null && this.barAt(this.grid, now) < this.roll.bar + this.roll.bars,
      },
    };
  }

  private applyLevel() {
    const gain = this.muted ? 0 : this.level * (this.mode === 'ai' ? this.planGain : 1) * (this.dhamaal ? 1.12 : 1);
    this.bus.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.15);
  }

  // --- Grid maths ---

  private gridFor(clock: DeckClock): Grid {
    const halfTime = !clock.forceFullTime && clock.bpm > HALF_TIME_ABOVE_BPM;
    const beatSeconds = (60 / clock.bpm) * (halfTime ? 2 : 1);
    return {
      key: `${clock.trackId}|${clock.bpm}|${clock.downbeat}|${halfTime}`,
      trackId: clock.trackId,
      clock,
      beatSeconds,
      barSeconds: beatSeconds * 4,
      halfTime,
    };
  }

  /** Audio-clock time of a beat position (in taal beats from the grid's downbeat). */
  private timeOfBeat(grid: Grid, beat: number): number {
    const songTime = grid.clock.downbeat + beat * grid.beatSeconds;
    return grid.clock.startedAt + songTime / grid.clock.rate;
  }

  private beatAt(grid: Grid, ctxTime: number): number {
    const songTime = (ctxTime - grid.clock.startedAt) * grid.clock.rate;
    return (songTime - grid.clock.downbeat) / grid.beatSeconds;
  }

  private barAt(grid: Grid, ctxTime: number): number {
    return Math.floor(this.beatAt(grid, ctxTime) / 4);
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
    this.lastClock = clock;
    const now = this.ctx.currentTime;
    if (!clock || !clock.isPlaying) {
      if (this.active.size || this.queue.length) this.silence();
      this.grid = null;
      this.setStatus('off', clock ? 'Waiting for the music to play' : 'No song on air', null);
      return;
    }

    // Which beat to play on: the song on air; during a cut, until the new song's first downbeat
    // (the bridge), then the new song's
    let deck: DeckClock = clock;
    let bridgeUntil: number | null = null;
    const incoming = clock.transition === 'cut' ? clock.incoming : undefined;
    if (incoming && incoming.bpmConfidence >= MIN_CONFIDENCE) {
      const inGrid = this.gridFor(incoming);
      const handover = this.firstDownbeatAfter(inGrid, incoming.startsAt);
      if (now + LOOKAHEAD_SECONDS >= handover - 0.005) {
        deck = incoming;
        if (this.grid?.trackId !== incoming.trackId) {
          const rolled = this.bridgeRollFor !== null && Math.abs(this.bridgeRollFor - handover) < 0.02;
          this.landingBar = { gridKey: inGrid.key, bar: this.barAt(inGrid, handover + 0.001), rolled };
        }
      } else {
        bridgeUntil = handover;
      }
    }

    if (deck.bpmConfidence < MIN_CONFIDENCE || deck.bpm < 70 || deck.bpm > 200) {
      this.grid = null;
      this.queue = [];
      this.setStatus('off', `Beat not clear enough to play along (${Math.round(deck.bpmConfidence * 100)}%): dhol waiting`, null);
      return;
    }

    const grid = this.gridFor(deck);
    if (grid.key !== this.grid?.key) {
      // New song, a re-timed song, or the bridge handing over: lock onto this grid
      const newSong = grid.trackId !== this.grid?.trackId;
      if (newSong && this.restTrackId && this.restTrackId !== grid.trackId) this.restTrackId = null; // Rest lasts one song
      this.dropQueued(this.timeOfBeat(grid, Math.floor(this.beatAt(grid, now)))); // the old grid's strokes after this beat
      this.grid = grid;
      this.nextBar = null;
      this.scoreKey = '';
      if (this.breakRequested) {
        this.breakRequested = false;
        this.breakFrom = { gridKey: grid.key, bar: this.barAt(grid, now) + 1 };
      }
    } else {
      this.grid = grid; // same grid, newest clock (rate, start time)
    }
    this.ensureScore(deck, grid);
    this.followPlan(deck);

    // A mix starting or ending, or the bridge beginning, changes what the bars already queued
    // (up to ~0.3 s ahead) should play: re-plan them now, not a bar later
    const situation = `${clock.transition}|${bridgeUntil !== null}`;
    if (situation !== this.situation) {
      this.situation = situation;
      this.rebuildAhead();
    }
    // The bridge ends with a roll into the new song's first downbeat (queued once per bridge)
    if (bridgeUntil !== null && this.bridgeRollFor !== bridgeUntil) {
      this.bridgeRollFor = bridgeUntil;
      this.queueBridgeRoll(clock, bridgeUntil, now);
    }

    // (Re)lock: the bar playing now (its strokes still ahead are scheduled), e.g. after a seek
    const barNow = this.barAt(grid, now);
    if (this.nextBar === null || this.nextBar < barNow || this.nextBar > barNow + 2) {
      if (this.nextBar !== null) this.dropQueued(now);
      this.nextBar = barNow;
    }
    // Put bars in the queue as they come into range, then start the strokes due soon
    while (this.timeOfBeat(grid, this.nextBar * 4) < now + LOOKAHEAD_SECONDS + 0.05) {
      this.enqueueBar(grid, this.nextBar, now, bridgeUntil);
      this.nextBar++;
    }
    this.flush(now);
    this.showStatus(grid, deck, barNow, bridgeUntil);
  }

  /** The first bar line of `grid` at or after audio-clock time `t`. */
  private firstDownbeatAfter(grid: Grid, t: number): number {
    const bar = Math.ceil(this.beatAt(grid, t) / 4 - 1e-6);
    return this.timeOfBeat(grid, bar * 4);
  }

  private ensureScore(deck: DeckClock, grid: Grid) {
    const follow = this.mode === 'ai' || this.followSong;
    const key = `${grid.key}|${follow}|${deck.energyProfile ? 1 : 0}|${deck.vocal ? 1 : 0}`;
    if (key === this.scoreKey) return;
    this.scoreKey = key;
    const input = {
      profile: deck.energyProfile!,
      vocal: deck.vocal,
      // The vocal map is measured at the song's natural tempo; the deck may play a re-timed copy
      vocalScale: deck.vocal && deck.duration ? deck.vocal.duration / deck.duration : 1,
      barSeconds: grid.barSeconds,
      downbeat: deck.downbeat,
      duration: deck.duration,
      musicStartTime: deck.musicStartTime,
      hookTime: deck.hookTime,
    };
    this.score = follow && deck.energyProfile ? planDholScore(input) : steadyDholScore(input);
  }

  /** AI mode: the song's plan sets the level (0.7 = normal); shown in the UI. */
  private followPlan(deck: DeckClock) {
    const plan = this.mode === 'ai' ? deck.plan : null;
    if (plan === this.shownPlan) return;
    this.shownPlan = plan;
    this.planGain = plan?.play ? Math.max(0.3, Math.min(1, plan.level)) / 0.7 : 1;
    this.applyLevel();
    this.onChange();
  }

  /** The taal for a song: the plan's (AI), the user's (manual), Dhamaal on the Dhamaal cue. */
  private styleFor(deck: DeckClock | undefined): RhythmStyle {
    if (this.dhamaal) return getRhythmStyle('dhol_dhamaal');
    if (this.mode === 'manual') return getRhythmStyle(this.manualStyleId);
    return getRhythmStyle(deck?.plan?.styleId ?? 'bhangra_chaal');
  }

  private dholWanted(deck: DeckClock | undefined): boolean {
    if (this.mode === 'manual') return true;
    return !!deck?.plan?.play;
  }

  /** What to play in `bar` of `grid`, and why. */
  private barPlan(grid: Grid, bar: number, bridging: boolean): { play: BarPlay; extras: BarExtras; style: RhythmStyle; fill: boolean; reason: string } {
    const clock = this.lastClock;
    const deck = grid.clock;
    const style = this.styleFor(deck);
    const rest = { play: { kind: 'rest' } as BarPlay, extras: {}, style, fill: false };
    const extras: BarExtras = {};
    const landing = this.landingBar?.gridKey === grid.key && this.landingBar.bar === bar;
    const cueRoll = this.roll?.gridKey === grid.key ? this.roll : null;
    const rollPart = cueRoll ? bar - cueRoll.bar : -1; // which bar of the cued roll this is
    const rolling = cueRoll !== null && rollPart >= 0 && rollPart < cueRoll.bars;
    if (cueRoll && rollPart === cueRoll.bars) extras.accent = true; // a cued roll lands here

    if (this.restTrackId) return { ...rest, reason: 'resting (Rest cue): tap Rest again to bring the dhol back' };

    // The bridge: a dhol break on the old song's beat, carrying the crowd into the next song
    if (bridging) {
      const incoming = clock?.incoming;
      if (!this.dholWanted(deck) && !this.dholWanted(incoming)) return { ...rest, reason: 'mixing: no dhol on either song' };
      const bridgeStyle = this.dholWanted(deck) ? style : this.styleFor(incoming);
      // The break's dense first bar throughout (a bridge can start anywhere in a bar, and its length
      // isn't a whole number of bars); the bridge roll takes over before the new song's downbeat
      return { play: { kind: 'break', part: 0 }, extras: {}, style: bridgeStyle, fill: true, reason: 'dhol break: carrying the crowd into the next song' };
    }

    const breakBar = this.breakFrom?.gridKey === grid.key ? bar - this.breakFrom.bar : -1;
    if (breakBar >= 0 && breakBar < BREAK_BARS) return { play: { kind: 'break', part: breakBar }, extras: {}, style, fill: true, reason: 'dhol break (cue)' };
    if (breakBar === BREAK_BARS) extras.accent = true;

    if (rolling) {
      // One crescendo over the whole roll: this bar's share of it
      const span = 4 - cueRoll!.fromBeat + 4 * (cueRoll!.bars - 1);
      const start = rollPart === 0 ? 0 : (4 - cueRoll!.fromBeat + 4 * (rollPart - 1)) / span;
      const end = (4 - cueRoll!.fromBeat + 4 * rollPart) / span;
      extras.roll = { fromBeat: rollPart === 0 ? cueRoll!.fromBeat : 0, from: start, to: end };
    }
    if (landing) extras.accent = true;
    // A cut landing on the next bar line: roll into it (the strokes already past are skipped), so
    // the dhol carries the crowd straight into the new song's first downbeat
    const rollingIn = this.landingBar?.gridKey === grid.key && this.landingBar.bar === bar + 1;
    // (`deck` is the new song here; the song on air in `clock` is the old one until the crossfade turns)
    if (rollingIn && !this.landingBar!.rolled && !extras.roll && (this.dholWanted(deck) || this.dholWanted(clock ?? undefined))) {
      return { play: { kind: 'rest' }, extras: { ...extras, roll: { fromBeat: 1 } }, style: this.dholWanted(deck) ? style : this.styleFor(clock ?? undefined), fill: true, reason: 'rolling into the next song' };
    }

    if (this.dhamaal) {
      // Go big: the full dhamaal wherever the music plays, an accent every 4 bars, a roll every 8
      const s = this.score[bar];
      if (s && s.role === 'out' && s.reason.startsWith('intro')) return { ...rest, reason: 'Dhamaal: waiting for the music' };
      if (bar % 4 === 0) extras.accent = true;
      if (bar % 8 === 7 && !extras.roll) extras.roll = { fromBeat: 2 };
      return { play: { kind: 'groove', variation: bar }, extras, style, fill: !!extras.roll, reason: 'going big (cue): full power' };
    }

    // During a beatmatched blend: a light groove that carries the crowd from one song to the next,
    // even over the old song's quiet outro (it went silent for a whole 12 s blend), no fireworks
    if (clock?.transition === 'blend') {
      const incoming = clock.incoming;
      if (!this.dholWanted(deck) && !this.dholWanted(incoming)) return { ...rest, reason: 'mixing: no dhol on either song' };
      const blendStyle = this.dholWanted(deck) ? style : this.styleFor(incoming);
      return { play: { kind: 'light' }, extras: extras.roll ? extras : {}, style: blendStyle, fill: !!extras.roll, reason: 'mixing: light groove carrying the crowd' };
    }

    const cued = !!extras.roll || !!extras.accent;
    if (!this.dholWanted(deck)) {
      const why = deck.plan ? `no dhol on this song: ${deck.plan.reason}` : 'AI is listening to this song…';
      // A roll or a bridge landing on a song without dhol: just that, then the dhol hands over
      return cued ? { play: { kind: 'rest' }, extras, style, fill: !!extras.roll, reason: extras.roll ? 'roll (cue)' : 'handing over to the song' } : { ...rest, reason: why };
    }
    const s = this.score[bar];
    if (!s) return cued ? { play: { kind: 'groove', variation: bar }, extras, style, fill: !!extras.roll, reason: 'cue' } : { ...rest, reason: 'outside the song' };

    if (s.roll && !extras.roll) extras.roll = { fromBeat: 2 };
    if (s.tihai) extras.tihai = true;
    if (s.accent) extras.accent = true;
    // Out: nothing, except a roll or landing (e.g. rolling in from a quiet intro)
    const play: BarPlay = s.role === 'out' ? { kind: 'rest' } : s.role === 'light' ? { kind: 'light', answer: s.answer } : { kind: 'groove', variation: s.variation };
    return { play, extras, style, fill: !!(extras.roll || extras.tihai), reason: s.reason };
  }

  private enqueueBar(grid: Grid, bar: number, now: number, bridgeUntil: number | null) {
    const barStart = this.timeOfBeat(grid, bar * 4);
    const bridging = bridgeUntil !== null;
    const { play, extras, style } = this.barPlan(grid, bar, bridging);
    const hits = barHits(style, play, extras, bar, grid.beatSeconds / grid.clock.rate);
    for (const h of hits) {
      const time = this.timeOfBeat(grid, bar * 4 + h.beat);
      if (time < now + 0.005) continue; // already past (locking on mid-bar)
      // The break gives way to the bridge roll, which lands on the new song's first downbeat
      if (bridgeUntil !== null && time >= bridgeUntil - BRIDGE_ROLL_SECONDS) continue;
      this.queue.push({ time, voice: h.voice, velocity: h.velocity, muted: h.muted, gridKey: grid.key, bar });
    }
    void barStart;
  }

  /** Re-plans bars already in the queue (a cue or a mix changed them); a bridge roll stays. */
  private rebuildAhead() {
    const grid = this.grid;
    if (!grid || this.nextBar === null) return;
    const now = this.ctx.currentTime;
    const firstBar = this.barAt(grid, now);
    this.dropQueued(now + 0.01);
    this.nextBar = firstBar;
  }

  /** Drops queued strokes from `from` on; the bridge roll too only with `all` (Rest). */
  private dropQueued(from: number, all = false) {
    this.queue = this.queue.filter((q) => q.time < from || (!all && q.gridKey === BRIDGE));
  }

  /**
   * The bridge's last moments: a roll timed in seconds (the old and new songs' beats don't agree,
   * so it's on neither grid) rising to the new song's first downbeat, where its accent lands.
   */
  private queueBridgeRoll(clock: SongClock, until: number, now: number) {
    const incoming = clock.incoming;
    if (this.restTrackId || (!this.dholWanted(clock) && !this.dholWanted(incoming))) return;
    const style = this.dholWanted(clock) ? this.styleFor(clock) : this.styleFor(incoming);
    const start = Math.max(now + 0.05, until - BRIDGE_ROLL_SECONDS);
    const end = until - 0.03;
    if (end - start < 0.2) return;
    let i = 0;
    for (let t = start; t < end; t += ROLL_STROKE_SECONDS, i++) {
      const p = (t - start) / (end - start);
      this.queue.push({ time: t, voice: style.treble, velocity: rollVelocity(p), gridKey: BRIDGE, bar: -1 });
      if (i % 4 === 0) this.queue.push({ time: t, voice: style.bass, velocity: 0.55 + 0.4 * p, gridKey: BRIDGE, bar: -1 });
    }
  }

  private flush(now: number) {
    this.queue.sort((a, b) => a.time - b.time);
    while (this.queue.length && this.queue[0].time < now + LOOKAHEAD_SECONDS) {
      const q = this.queue.shift()!;
      if (q.time < now) continue;
      // A human touch: ±3 ms (not on the 1) and ±7 % velocity
      const onBeat = Math.abs(this.beatAt(this.grid!, q.time) % 1) < 0.01;
      const t = q.time + (onBeat ? 0 : (Math.random() * 2 - 1) * 0.003);
      this.playHit(q.voice, Math.max(now, t), q.velocity * (0.93 + Math.random() * 0.14), q.muted);
    }
  }

  private showStatus(grid: Grid, deck: DeckClock, bar: number, bridgeUntil: number | null) {
    const { reason, fill, play, style } = this.barPlan(grid, bar, bridgeUntil !== null);
    this.shownStyle = style.id;
    const tempo = Math.round((60 / grid.beatSeconds) * grid.clock.rate);
    const who = this.mode === 'ai' && !this.dhamaal ? '🤖 ' : '';
    const half = grid.halfTime ? ' (half-time)' : '';
    const section: RhythmSection | 'fill' = fill ? 'fill' : play.kind === 'rest' ? 'off' : play.kind === 'light' ? 'light' : 'full';
    this.setStatus(section, `${who}${style.name}${half}: ${reason}`, play.kind === 'rest' ? null : tempo);
    void deck;
  }

  private playHit(voice: VoiceId, when: number, velocity: number, muted?: boolean) {
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
    // Velocity on a curve so ghost strokes are clearly softer
    const level = Math.pow(Math.min(1.15, velocity), 1.6) * dbToGain(VOICES[voice].trimDb);
    gain.gain.setValueAtTime(level, when);
    if (muted) {
      // A damped stroke: the hand stops the head
      const decay = VOICES[voice].mutedDecay;
      gain.gain.setTargetAtTime(0, when + decay * 0.4, decay / 3);
    }
    src.connect(gain).connect(input);
    src.onended = () => {
      this.active.delete(src);
      gain.disconnect();
    };
    this.active.add(src);
    src.start(when);
    if (muted) src.stop(when + VOICES[voice].mutedDecay * 3);
  }

  // --- Settings (per browser) ---

  private loadSettings() {
    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY) ?? window.localStorage.getItem('ai_dj_rhythm_settings_v2');
      if (!raw) return;
      const s = JSON.parse(raw);
      if (isRhythmStyleId(s.manualStyleId)) this.manualStyleId = s.manualStyleId;
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
