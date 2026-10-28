import { z } from 'zod';
import { AICommandSchema, type AICommandPlan } from './schema';
import type { AudioEngine } from '../audio/AudioEngine';

export interface AIResponseResult {
  plan: AICommandPlan;
  latencyMs: number;
  source: 'ollama_qwen' | 'fallback_heuristic';
  rawResponse?: string;
}

/** What the AI DJ sees when choosing how to mix: only options that already obey the mixing rules. */
export interface MixDecisionContext {
  mood: string;
  sessionBpm: number | null;
  current: { title: string; artist: string; bpm: number; position: number; duration: number };
  next: { title: string; artist: string; bpm: number; keyLocked: boolean };
  canBlend: boolean; // false when tempos are too far apart: only a cut is allowed
  exitOptions: Array<{ inSeconds: number; at: number; why: string }>;
  entryOptions: Array<{ at: number; why: string }>;
}

export interface NextSongContext {
  mood: string;
  sessionBpm: number | null;
  current: { title: string; artist: string; bpm: number };
  recentlyPlayed: string[];
  options: Array<{ title: string; artist: string; bpm: number; requested: boolean }>;
}

const MixDecisionSchema = z.object({
  exit: z.coerce.number().int().min(1),
  entry: z.coerce.number().int().min(1),
  style: z.enum(['blend', 'cut']),
  bars: z.coerce.number().refine((b) => [4, 8, 16].includes(b)),
  reason: z.string().max(200),
});
export type MixDecision = z.infer<typeof MixDecisionSchema>;

const NextSongSchema = z.object({
  pick: z.coerce.number().int().min(1),
  reason: z.string().max(200),
});
export type NextSongDecision = z.infer<typeof NextSongSchema>;

const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class OllamaDJAgent {
  // Proxied by the dev server (server/apiPlugin.ts), which keeps the model warm in RAM
  private endpoint: string = '/api/llm';

  /** Sends a prompt to the local model and parses its JSON reply; null if unavailable or too slow. */
  private async askJson(prompt: string, maxTokens: number, timeoutMs: number): Promise<unknown> {
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, maxTokens, timeoutMs }),
        signal: AbortSignal.timeout(timeoutMs + 1000),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return JSON.parse(data.response);
    } catch {
      return null;
    }
  }

  /** Whether Ollama is running with the model installed. */
  public async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch('/api/llm/health', { signal: AbortSignal.timeout(4000) });
      return res.ok && (await res.json()).online === true;
    } catch {
      return false;
    }
  }

  /**
   * Asks the AI DJ which of the rule-abiding exit/entry points to use, and blend vs cut.
   * Returns null (keep the analysis' first choice) if the model is slow, offline or off-script.
   */
  public async chooseMix(ctx: MixDecisionContext): Promise<MixDecision | null> {
    const prompt = `You are an expert ${ctx.mood} DJ deciding how to mix into the next song.
NOW PLAYING: "${ctx.current.title}" by ${ctx.current.artist}, ${Math.round(ctx.current.bpm)} BPM, at ${formatTime(ctx.current.position)} of ${formatTime(ctx.current.duration)}.
NEXT SONG: "${ctx.next.title}" by ${ctx.next.artist}, ${Math.round(ctx.next.bpm)} BPM${ctx.next.keyLocked ? ' (tempo-matched, key-locked)' : ''}.
${ctx.sessionBpm ? `The whole set is locked to ${ctx.sessionBpm} BPM for dancing.\n` : ''}WHERE TO START MIXING OUT OF THE CURRENT SONG:
${ctx.exitOptions.map((o, i) => `${i + 1}) in ${Math.round(o.inSeconds)}s at ${formatTime(o.at)}: ${o.why}`).join('\n')}
WHERE THE NEXT SONG STARTS:
${ctx.entryOptions.map((o, i) => `${i + 1}) at ${formatTime(o.at)}: ${o.why}`).join('\n')}
STYLE: ${ctx.canBlend ? '"blend" (beatmatched overlap of 4, 8 or 16 bars) or "cut" (instant switch on the beat)' : 'tempos are too far apart, so style must be "cut"'}.
DJ RULES: don't throw away a chorus or hook; prefer mixing out where the current song calms down; land the next song's drop or hook as the mix ends; short mixes for vocal-heavy Desi songs; long smooth blends for chill moods; high energy for parties.
Reply ONLY with JSON: {"exit": <number>, "entry": <number>, "style": "blend"|"cut", "bars": 4|8|16, "reason": "<max 12 words>"}`;

    const parsed = MixDecisionSchema.safeParse(await this.askJson(prompt, 60, 12_000));
    if (!parsed.success) return null;
    const d = parsed.data;
    if (d.exit > ctx.exitOptions.length || d.entry > ctx.entryOptions.length) return null;
    if (!ctx.canBlend) d.style = 'cut';
    return d;
  }

  /** Asks the AI DJ which ready song should play next for the best energy flow. */
  public async chooseNextSong(ctx: NextSongContext): Promise<NextSongDecision | null> {
    const prompt = `You are an expert ${ctx.mood} DJ picking the next song to keep the dance floor flowing.
NOW PLAYING: "${ctx.current.title}" by ${ctx.current.artist}, ${Math.round(ctx.current.bpm)} BPM.
RECENTLY PLAYED: ${ctx.recentlyPlayed.length ? ctx.recentlyPlayed.map((t) => `"${t}"`).join(', ') : 'none'}.
${ctx.sessionBpm ? `The set is locked to ${ctx.sessionBpm} BPM.\n` : ''}READY SONGS:
${ctx.options.map((o, i) => `${i + 1}) "${o.title}" by ${o.artist}, ${Math.round(o.bpm)} BPM${o.requested ? ' (requested by a guest)' : ''}`).join('\n')}
Consider energy flow, genre and language continuity, and the mood. Guest requests should usually come soon. Avoid two songs by the same artist back to back.
Reply ONLY with JSON: {"pick": <number>, "reason": "<max 12 words>"}`;

    const parsed = NextSongSchema.safeParse(await this.askJson(prompt, 40, 12_000));
    if (!parsed.success || parsed.data.pick > ctx.options.length) return null;
    return parsed.data;
  }

  /**
   * Processes a natural language DJ command with the local Qwen 2.5 3B model,
   * validates it against the Zod schema, and returns a verified mixing plan.
   */
  public async interpretCommand(
    userInput: string,
    engine: AudioEngine
  ): Promise<AIResponseResult> {
    const startTime = performance.now();

    // Extract current DJ system context
    const stateA = engine.deckA.getPlaybackState();
    const stateB = engine.deckB.getPlaybackState();
    const stateP = engine.percussionDeck.getState();
    const crossfader = engine.getCrossfader();

    const currentContext = {
      deckA: {
        title: stateA.track?.title || 'Empty',
        bpm: stateA.effectiveBpm,
        isPlaying: stateA.isPlaying,
        volume: stateA.volume,
        lowGain: stateA.lowGain,
      },
      deckB: {
        title: stateB.track?.title || 'Empty',
        bpm: stateB.effectiveBpm,
        isPlaying: stateB.isPlaying,
        volume: stateB.volume,
        lowGain: stateB.lowGain,
      },
      percussionDeckP: {
        pattern: stateP.activePatternId,
        bpm: stateP.currentBpm,
        isPlaying: stateP.isPlaying,
        volume: stateP.volume,
      },
      crossfader: crossfader < -0.3 ? 'Deck A (Left)' : crossfader > 0.3 ? 'Deck B (Right)' : 'Center',
    };

    const systemPrompt = `You are an expert club & wedding AI DJ mixing agent governed by strict musical principles:
1. Music first, effects second. Protect the listening experience and maintain set flow.
2. Bass management: Never play two competing basslines or kicks at full volume; use 'bass_swap' to cut outgoing bass before bringing in the incoming bass.
3. Continuous Percussion (Deck P): Punjabi Dhol and drum grooves must continue playing underneath transitions without restarting the loop timeline.
4. Transitions: Choose musically appropriate durations (4s for drop cuts, 8s for standard phrase blends, 16s/32s for smooth harmonic blends).
5. User Intent: Always honor explicit user requests (e.g. cutting bass, specific percussion styles).

CURRENT CONSOLE STATE:
${JSON.stringify(currentContext, null, 2)}

TASK:
Interpret the user's natural language instruction and output a STRICT JSON object conforming to this specification:
{
  "action": "execute_transition" | "control_percussion" | "adjust_eq" | "tempo_sync" | "playback_control",
  "target_deck": "A" | "B" | "both" | "none",
  "transition": {
    "target_deck": "A" | "B",
    "style": "bass_swap" | "smooth_crossfade" | "drop_cut",
    "duration_seconds": 4 | 8 | 16 | 32,
    "sync_percussion": true
  },
  "percussion": {
    "active": true | false,
    "pattern_id": "punjabi_dhol" | "bhangra_groove" | "electronic_drums" | "afrobeat",
    "volume": 0.0 to 1.0,
    "sync_to_deck": "A" | "B" | "manual"
  },
  "eq": {
    "deck": "A" | "B",
    "low": -40 to 6,
    "mid": -40 to 6,
    "high": -40 to 6
  },
  "playback": {
    "deck": "A" | "B" | "both",
    "command": "play" | "pause" | "stop"
  },
  "explanation": "Brief DJ reason for the action"
}

USER INSTRUCTION: "${userInput}"

Output ONLY the JSON object. Do not include markdown code blocks or explanations outside the JSON.`;

    try {
      // ~150 output tokens at ~7 tokens/s on this CPU: allow up to 30 s before falling back
      const parsed = await this.askJson(systemPrompt, 160, 30_000);
      if (parsed === null) throw new Error('Local LLM unavailable or timed out');

      // Validate with Zod
      const validatedPlan = AICommandSchema.parse(parsed);
      const latencyMs = Math.round(performance.now() - startTime);

      return {
        plan: validatedPlan,
        latencyMs,
        source: 'ollama_qwen',
        rawResponse: JSON.stringify(parsed),
      };
    } catch (err) {
      console.warn('Ollama unavailable or schema error, using deterministic fallback:', err);
      const fallbackPlan = this.heuristicFallback(userInput, currentContext);
      const latencyMs = Math.round(performance.now() - startTime);

      return {
        plan: fallbackPlan,
        latencyMs,
        source: 'fallback_heuristic',
      };
    }
  }

  /**
   * Deterministic rule-based fallback ensuring the music never stops
   * even if the local LLM is temporarily busy or unavailable.
   */
  private heuristicFallback(input: string, _context: Record<string, unknown>): AICommandPlan {
    const text = input.toLowerCase();

    // 1. Percussion controls
    if (text.includes('dhol') || text.includes('percussion') || text.includes('drum')) {
      const isStop = text.includes('stop') || text.includes('pause') || text.includes('kill');
      let pattern: 'punjabi_dhol' | 'bhangra_groove' | 'electronic_drums' | 'afrobeat' = 'punjabi_dhol';

      if (text.includes('bhangra')) pattern = 'bhangra_groove';
      else if (text.includes('house') || text.includes('club') || text.includes('electronic')) pattern = 'electronic_drums';
      else if (text.includes('afro')) pattern = 'afrobeat';

      return {
        action: 'control_percussion',
        target_deck: 'none',
        percussion: {
          active: !isStop,
          pattern_id: pattern,
          volume: 0.85,
        },
        explanation: isStop
          ? 'Paused continuous percussion deck.'
          : `Activated ${pattern} rhythmic loop synced with master timeline.`,
      };
    }

    // 2. Transitions
    if (text.includes('mix') || text.includes('transition') || text.includes('crossfade') || text.includes('switch')) {
      const targetDeck = /\b(deck|song)\s*a\b/.test(text) ? 'A' : 'B';
      const isSmooth = text.includes('smooth') || text.includes('harmonic');
      const isDrop = text.includes('drop') || text.includes('cut') || text.includes('fast');

      return {
        action: 'execute_transition',
        target_deck: targetDeck,
        transition: {
          target_deck: targetDeck,
          style: isDrop ? 'drop_cut' : isSmooth ? 'smooth_crossfade' : 'bass_swap',
          duration_seconds: isDrop ? 4 : isSmooth ? 16 : 8,
          sync_percussion: true,
        },
        explanation: `Executing ${isDrop ? 'quick drop-cut' : isSmooth ? 'harmonic 16s crossfade' : '8s club bass-swap'} transition into Deck ${targetDeck}.`,
      };
    }

    // 3. EQ / Bass Kill
    if (text.includes('bass') || text.includes('low') || text.includes('eq')) {
      // Match "deck b" explicitly: a bare 'b' would match the word "bass" itself
      const targetDeck = /\b(deck|song)\s*b\b/.test(text) ? 'B' : 'A';
      const isCut = text.includes('cut') || text.includes('kill') || text.includes('lower') || text.includes('drop');

      return {
        action: 'adjust_eq',
        target_deck: targetDeck,
        eq: {
          deck: targetDeck,
          low: isCut ? -40 : 0,
        },
        explanation: isCut
          ? `Killed low bass frequencies on Deck ${targetDeck} to clean mix.`
          : `Restored neutral bass on Deck ${targetDeck}.`,
      };
    }

    // Default general transition
    return {
      action: 'execute_transition',
      target_deck: 'B',
      transition: {
        target_deck: 'B',
        style: 'bass_swap',
        duration_seconds: 8,
        sync_percussion: true,
      },
      explanation: 'Interpreted request as standard 8-bar club bass-swap transition with continuous Dhol sync.',
    };
  }

  /**
   * Executes a validated AI mixing plan deterministically on the AudioEngine.
   */
  public executePlanOnEngine(plan: AICommandPlan, engine: AudioEngine) {
    // 1. Execute Transitions
    if (plan.action === 'execute_transition' && plan.transition) {
      // "Mix" means the next song: the off-air deck usually still holds the previous one
      const nextReady = engine.queue.find((q) => q.status === 'ready' && q.audioBuffer);
      if (nextReady) {
        engine.mixQueuedTrack(nextReady.id, plan.transition.duration_seconds);
      } else {
        const sourceDeck = plan.transition.target_deck === 'A' ? 'B' : 'A';
        engine.startTransition({
          sourceDeck,
          targetDeck: plan.transition.target_deck,
          durationSeconds: plan.transition.duration_seconds,
          style: plan.transition.style === 'drop_cut' ? 'smooth_crossfade' : plan.transition.style,
          syncPercussion: plan.transition.sync_percussion,
        });
      }
    }

    // 2. Control Percussion
    if (plan.percussion) {
      if (plan.percussion.active) {
        if (plan.percussion.pattern_id) {
          engine.percussionDeck.switchPattern(plan.percussion.pattern_id);
        }
        if (plan.percussion.volume !== undefined) {
          engine.percussionDeck.setVolume(plan.percussion.volume);
        }
        // Start locked to the beat of the song on air (no-op if already playing)
        if (!engine.percussionDeck.getState().isPlaying) {
          engine.togglePercussion();
        }
      } else {
        engine.percussionDeck.pause();
      }
    }

    // 3. Adjust EQ
    if (plan.eq) {
      const target = plan.eq.deck === 'A' ? engine.deckA : engine.deckB;
      const cur = target.getPlaybackState();
      const newLow = plan.eq.low !== undefined ? plan.eq.low : cur.lowGain;
      const newMid = plan.eq.mid !== undefined ? plan.eq.mid : cur.midGain;
      const newHigh = plan.eq.high !== undefined ? plan.eq.high : cur.highGain;
      target.setEQ(newLow, newMid, newHigh);
    }

    // 4. Playback controls
    if (plan.playback) {
      const applyDeck = (deck: typeof engine.deckA) => {
        if (plan.playback?.command === 'play') deck.play();
        else if (plan.playback?.command === 'pause') deck.pause();
        else if (plan.playback?.command === 'stop') deck.stop();
      };

      if (plan.playback.deck === 'A' || plan.playback.deck === 'both') applyDeck(engine.deckA);
      if (plan.playback.deck === 'B' || plan.playback.deck === 'both') applyDeck(engine.deckB);
    }
  }
}
