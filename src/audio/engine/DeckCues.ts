/**
 * Hot cues and beat loops for the Pro decks.
 *
 * Hot cues: 4 points per song (saved by song, see HotCues.ts), snapped to the beat. Loops: whole
 * bars from the start of the bar playing now, on the deck's own source (VirtualDeck.setLoop), so
 * anything locked to the song's beat grid stays on the beat while it loops.
 */
import type { DeckId } from '../../types';
import type { VirtualDeck } from '../VirtualDeck';
import { HOT_CUE_SLOTS, loadHotCues, saveHotCues } from '../HotCues';
import { songStorageKey } from '../songMatch';

export interface DeckCuesDeps {
  deck: (id: DeckId) => VirtualDeck;
  isOnAir: (deck: VirtualDeck) => boolean;
  isTransitioning: () => boolean;
  /** The song on air jumped: re-lock the drums, re-plan the mix, remember the position. */
  onAirJumped: () => void;
  /** A loop started on the song on air: a planned mix can't happen while it holds the song. */
  onAirLoopStarted: (bars: number, title: string) => void;
  /** The song on air left a loop: its clock jumped back by the loop's repeats. */
  onAirLoopEnded: () => void;
  onChange: () => void;
}

const barSeconds = (bpm: number | undefined) => (4 * 60) / (bpm || 120);

export class DeckCues {
  constructor(private deps: DeckCuesDeps) {}

  public getHotCues(deckId: DeckId): Array<number | null> {
    const track = this.deps.deck(deckId).getTrack();
    return track ? loadHotCues(songStorageKey(track)) : Array(HOT_CUE_SLOTS).fill(null);
  }

  /** An empty slot saves the current position (on the nearest beat); a saved one jumps to it. */
  public hotCue(deckId: DeckId, slot: number) {
    const deck = this.deps.deck(deckId);
    const track = deck.getTrack();
    if (!track || slot < 0 || slot >= HOT_CUE_SLOTS) return;
    const cues = loadHotCues(songStorageKey(track));
    const saved = cues[slot];
    if (saved === null) {
      const beat = barSeconds(track.bpm) / 4;
      const downbeat = track.firstDownbeatTime ?? 0;
      const position = deck.getCurrentTime();
      cues[slot] = Math.max(0, Math.min(track.duration - 0.5, downbeat + Math.round((position - downbeat) / beat) * beat));
      saveHotCues(songStorageKey(track), cues);
    } else {
      deck.seek(saved);
      if (this.deps.isOnAir(deck)) this.deps.onAirJumped();
    }
    this.deps.onChange();
  }

  public clearHotCue(deckId: DeckId, slot: number) {
    const track = this.deps.deck(deckId).getTrack();
    if (!track) return;
    const cues = loadHotCues(songStorageKey(track));
    cues[slot] = null;
    saveHotCues(songStorageKey(track), cues);
    this.deps.onChange();
  }

  /** Bars in the deck's current loop, or 0. */
  public getLoopBars(deckId: DeckId): number {
    const deck = this.deps.deck(deckId);
    const loop = deck.getLoop();
    const track = deck.getTrack();
    if (!loop || !track) return 0;
    return Math.round((loop.end - loop.start) / barSeconds(track.bpm));
  }

  /** Loops `bars` bars from the start of the bar playing now; the same length again leaves the loop. */
  public toggleBeatLoop(deckId: DeckId, bars: number) {
    const deck = this.deps.deck(deckId);
    const track = deck.getTrack();
    if (!track) return;
    const onAir = this.deps.isOnAir(deck);
    if (deck.getLoop()) {
      const same = this.getLoopBars(deckId) === bars;
      deck.exitLoop();
      if (onAir) this.deps.onAirLoopEnded();
      if (same) {
        this.deps.onChange();
        return;
      }
    }
    if (!deck.getPlaybackState().isPlaying || (onAir && this.deps.isTransitioning())) return;
    const bar = barSeconds(track.bpm);
    const downbeat = track.firstDownbeatTime ?? 0;
    const start = downbeat + Math.floor((deck.getCurrentTime() - downbeat) / bar) * bar;
    if (!deck.setLoop(Math.max(0, start), start + bars * bar)) return;
    if (onAir) this.deps.onAirLoopStarted(bars, track.title);
    this.deps.onChange();
  }

  /** Sets the loop IN point at current playback position (quantized to beat). */
  public setLoopIn(deckId: DeckId) {
    const deck = this.deps.deck(deckId);
    if (!deck.getTrack()) return;
    deck.setLoopIn();
    this.deps.onChange();
  }

  /** Sets the loop OUT point and starts seamless looping until DJ exits. */
  public setLoopOut(deckId: DeckId) {
    const deck = this.deps.deck(deckId);
    const track = deck.getTrack();
    if (!track) return;
    const wasLooping = !!deck.getLoop();
    const ok = deck.setLoopOut();
    const onAir = this.deps.isOnAir(deck);
    if (wasLooping && !deck.getLoop()) {
      if (onAir) this.deps.onAirLoopEnded();
    } else if (ok && deck.getLoop()) {
      const bars = Math.max(1, this.getLoopBars(deckId));
      if (onAir) this.deps.onAirLoopStarted(bars, track.title);
    }
    this.deps.onChange();
  }

  /** Leaves the active loop and plays on normally. */
  public exitLoop(deckId: DeckId) {
    const deck = this.deps.deck(deckId);
    if (!deck.getLoop()) return;
    deck.exitLoop();
    if (this.deps.isOnAir(deck)) this.deps.onAirLoopEnded();
    this.deps.onChange();
  }

  /** Toggles loop exit or re-enters previous loop. */
  public reloop(deckId: DeckId) {
    const deck = this.deps.deck(deckId);
    const track = deck.getTrack();
    if (!track) return;
    const wasLooping = !!deck.getLoop();
    const ok = deck.reloop();
    const onAir = this.deps.isOnAir(deck);
    if (wasLooping && !deck.getLoop()) {
      if (onAir) this.deps.onAirLoopEnded();
    } else if (ok && deck.getLoop()) {
      const bars = Math.max(1, this.getLoopBars(deckId));
      if (onAir) this.deps.onAirLoopStarted(bars, track.title);
    }
    this.deps.onChange();
  }
}

