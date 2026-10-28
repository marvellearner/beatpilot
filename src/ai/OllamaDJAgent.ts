import { AICommandSchema, AICommandPlan } from './schema';
import { AudioEngine } from '../audio/AudioEngine';

export interface AIResponseResult {
  plan: AICommandPlan;
  latencyMs: number;
  source: 'ollama_qwen' | 'fallback_heuristic';
  rawResponse?: string;
}

export class OllamaDJAgent {
  private endpoint: string = 'http://localhost:11434/api/generate';
  private model: string = 'qwen2.5:3b';

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
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: systemPrompt,
          stream: false,
          format: 'json',
          options: {
            num_gpu: 0, // Safe CPU execution avoiding VRAM watchdog timeouts
            temperature: 0.1,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const rawText = data.response;
      const parsed = JSON.parse(rawText);

      // Validate with Zod
      const validatedPlan = AICommandSchema.parse(parsed);
      const latencyMs = Math.round(performance.now() - startTime);

      return {
        plan: validatedPlan,
        latencyMs,
        source: 'ollama_qwen',
        rawResponse: rawText,
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
          sync_to_deck: 'A',
        },
        explanation: isStop
          ? 'Paused continuous percussion deck.'
          : `Activated ${pattern} rhythmic loop synced with master timeline.`,
      };
    }

    // 2. Transitions
    if (text.includes('mix') || text.includes('transition') || text.includes('crossfade') || text.includes('switch')) {
      const targetDeck = text.includes('deck a') || text.includes('song a') ? 'A' : 'B';
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
      const targetDeck = text.includes('b') ? 'B' : 'A';
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
      const sourceDeck = plan.transition.target_deck === 'A' ? 'B' : 'A';
      engine.startTransition({
        sourceDeck,
        targetDeck: plan.transition.target_deck,
        durationSeconds: plan.transition.duration_seconds,
        style: plan.transition.style === 'drop_cut' ? 'smooth_crossfade' : plan.transition.style,
        syncPercussion: plan.transition.sync_percussion,
      });
    }

    // 2. Control Percussion
    if (plan.percussion) {
      if (plan.percussion.active) {
        if (plan.percussion.pattern_id) {
          engine.percussionDeck.switchPattern(plan.percussion.pattern_id);
        }
        if (plan.percussion.sync_to_deck) {
          engine.percussionDeck.setSyncDeck(plan.percussion.sync_to_deck);
        }
        if (plan.percussion.volume !== undefined) {
          engine.percussionDeck.setVolume(plan.percussion.volume);
        }
        engine.percussionDeck.play();
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
      };

      if (plan.playback.deck === 'A' || plan.playback.deck === 'both') applyDeck(engine.deckA);
      if (plan.playback.deck === 'B' || plan.playback.deck === 'both') applyDeck(engine.deckB);
    }
  }
}
