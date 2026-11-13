/**
 * MixCoordinator: owns a running mix between Deck A and Deck B, from the moment its fade is
 * scheduled until it completes or is cancelled.
 *
 * Responsibilities:
 * - Scheduling the crossfader move on the audio clock (through AudioGraph).
 * - Tracking progress (0 to 1) and the fader position while the mix runs.
 * - Timers tied to the mix (e.g. phase-lock checks), cleared when it ends.
 * - Completion (old deck paused, EQs reset) and cancellation (freeze where it is).
 *
 * What kind of mix to do (tempo, length, FX, start point) is decided by AudioEngine.
 * The fader position itself lives in AudioGraph only.
 */

import type { DeckId, TrackMetadata } from '../../types';
import type { VirtualDeck } from '../VirtualDeck';
import type { AudioGraph } from './AudioGraph';

/**
 * Hermite smoothstep interpolation: zero 1st derivative at both ends,
 * preventing sudden volume acceleration or audible clicks at transition boundaries.
 */
export function smoothStep(progress: number): number {
  const p = Math.max(0, Math.min(1, progress));
  return p * p * (3 - 2 * p);
}

export function interpolateCrossfader(start: number, target: number, progress: number): number {
  return start + (target - start) * smoothStep(progress);
}

export interface MixCoordinatorCallbacks {
  /** Every 100 ms while the mix runs (the fader position is already updated). */
  onTick: (progress: number, onAirDeck: DeckId) => void;
  /** The mix finished: the target deck is on air alone. */
  onComplete: (targetTrack: TrackMetadata, targetDeck: DeckId) => void;
}

export interface MixRequest {
  sourceDeckId: DeckId;
  targetDeckId: DeckId;
  targetTrack: TrackMetadata;
  /** Audio-clock time the fade starts. */
  startTime: number;
  durationSeconds: number;
  /** A straight linear fade over this many seconds instead of the smooth equal-power curve. */
  linearFadeSeconds?: number;
  /** A custom fader path: position (-1 A … 1 B) for 0…1 of the mix, instead of the smooth fade. */
  crossfaderAt?: (progress: number) => number;
}

export class MixCoordinator {
  public isTransitioning: boolean = false;
  /** The mix running now (the rhythm layer reads when the new song starts, to bridge into it). */
  public current: MixRequest | null = null;
  public transitionProgress: number = 0; // 0 to 1
  private transitionTimer: number | null = null;
  private mixTimers: number[] = [];

  constructor(
    private readonly graph: AudioGraph,
    private readonly deck: (id: DeckId) => VirtualDeck
  ) {}

  /**
   * Starts a mix: schedules the fade on the audio clock and follows it until it completes.
   * Requires the target deck to be loaded (and playing, or scheduled to start at `startTime`).
   */
  public begin(req: MixRequest, callbacks: MixCoordinatorCallbacks): void {
    this.stopTimers();
    const { graph } = this;
    const sourceDeck = this.deck(req.sourceDeckId);
    const targetDeck = this.deck(req.targetDeckId);
    const startCrossfader = graph.crossfaderPosition;
    const targetCrossfader = req.targetDeckId === 'B' ? 1 : -1;
    const positionAt = req.crossfaderAt ?? ((p: number) => interpolateCrossfader(startCrossfader, targetCrossfader, p));

    if (req.linearFadeSeconds !== undefined) {
      graph.scheduleLinearCrossfade(req.sourceDeckId, req.startTime, req.linearFadeSeconds);
    } else {
      graph.scheduleCrossfadeCurve(positionAt, req.startTime, req.durationSeconds);
    }

    this.isTransitioning = true;
    this.current = req;
    this.transitionProgress = 0;

    this.transitionTimer = window.setInterval(() => {
      const elapsed = graph.ctx.currentTime - req.startTime;
      const progress = Math.max(0, Math.min(1, elapsed / req.durationSeconds));
      this.transitionProgress = progress;
      // Bookkeeping only: the gains follow the schedule set above. Setting them here would cancel
      // it. The position is kept so a cancelled mix freezes where it is.
      graph.crossfaderPosition = positionAt(progress);

      if (progress < 1) {
        callbacks.onTick(progress, graph.crossfaderPosition < 0 ? 'A' : 'B');
        return;
      }

      this.stopTimers();
      this.isTransitioning = false;
      this.current = null;
      graph.applyCrossfader(targetCrossfader);
      sourceDeck.pause();
      sourceDeck.setEQ(0, 0, 0);
      sourceDeck.resetFilterSweep();
      targetDeck.setEQ(0, 0, 0);
      callbacks.onComplete(req.targetTrack, req.targetDeckId);
    }, 100);
  }

  /** Runs `fn` at `delayMs` only while the current mix is still running; dropped when it ends. */
  public addMixTimer(delayMs: number, fn: () => void): void {
    const timer = window.setTimeout(() => {
      this.mixTimers = this.mixTimers.filter((t) => t !== timer);
      if (this.isTransitioning) fn();
    }, Math.max(0, delayMs));
    this.mixTimers.push(timer);
  }

  /** Stops a running mix where it is (both songs keep their current level), EQs back to flat. */
  public cancel(): void {
    this.stopTimers();
    if (this.isTransitioning) {
      this.isTransitioning = false;
      this.current = null;
      this.graph.applyCrossfader(this.graph.crossfaderPosition);
      for (const id of ['A', 'B'] as const) {
        this.deck(id).setEQ(0, 0, 0);
        this.deck(id).resetFilterSweep();
      }
    }
    this.transitionProgress = 0;
  }

  public dispose(): void {
    this.stopTimers();
    this.isTransitioning = false;
    this.current = null;
    this.transitionProgress = 0;
  }

  private stopTimers(): void {
    if (this.transitionTimer !== null) {
      window.clearInterval(this.transitionTimer);
      this.transitionTimer = null;
    }
    for (const t of this.mixTimers) window.clearTimeout(t);
    this.mixTimers = [];
  }
}
