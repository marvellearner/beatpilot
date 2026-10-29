import { z } from 'zod';
import { AICommandSchema, type AICommandPlan } from './schema';
import type { AudioEngine } from '../audio/AudioEngine';

export interface AIResponseResult {
  plan: AICommandPlan;
  latencyMs: number;
  source: 'gemini_flash' | 'ollama_qwen' | 'fallback_heuristic';
  provider?: 'gemini' | 'ollama' | 'heuristic';
  model?: string;
  rawResponse?: string;
}

export interface AgentHealthStatus {
  online: boolean;
  provider?: 'gemini' | 'ollama' | 'none';
  model?: string | null;
  gemini?: { configured: boolean; model: string | null };
  ollama?: { online: boolean; model: string | null };
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

export interface PercussionSyncContext {
  mood: string;
  track: {
    title: string;
    artist: string;
    bpm: number;
    effectiveBpm: number;
    confidence: number;
    highlightTime?: number;
    duration?: number;
    currentTime?: number;
  };
}

export const PercussionSyncSchema = z.object({
  shouldPlay: z.boolean(),
  patternId: z.enum(['punjabi_dhol', 'bhangra_groove', 'electronic_drums', 'afrobeat', 'none']),
  intensity: z.coerce.number().min(0.5).max(1.5).default(1.0),
  volume: z.coerce.number().min(0.3).max(1.0).default(0.85),
  duckDuringVerse: z.boolean().default(true),
  reason: z.string().max(250),
});
export type AIPercussionSyncDecision = z.infer<typeof PercussionSyncSchema>;

export interface MoodReadingResult {
  detectedMood: string;
  energyLevel: 'low' | 'medium' | 'high' | 'peak';
  vibeDescription: string;
  top5Songs: Array<{ title: string; artist: string; searchPrompt: string }>;
  reason: string;
  source: 'ai' | 'heuristic';
}

const MoodReadingSchema = z.object({
  detectedMood: z.string().max(100),
  energyLevel: z.enum(['low', 'medium', 'high', 'peak']).default('high'),
  vibeDescription: z.string().max(250),
  top5Songs: z.array(
    z.object({
      title: z.string(),
      artist: z.string(),
      searchPrompt: z.string(),
    })
  ).min(1).max(10),
  reason: z.string().max(250),
});

const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

interface LlmJsonResponse {
  data: unknown;
  provider?: 'gemini' | 'ollama';
  model?: string;
}

export class OllamaDJAgent {
  // Proxied by the dev server (server/apiPlugin.ts), which handles Gemini & Ollama seamlessly
  private endpoint: string = '/api/llm';

  /** Sends a prompt to the AI server and parses its JSON reply; null if unavailable or too slow. */
  private async askJson(prompt: string, maxTokens: number, timeoutMs: number): Promise<LlmJsonResponse | null> {
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, maxTokens, timeoutMs }),
        signal: AbortSignal.timeout(timeoutMs + 1000),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return {
        data: JSON.parse(data.response),
        provider: data.provider,
        model: data.model,
      };
    } catch {
      return null;
    }
  }

  /** Detailed status of Gemini and Ollama backends. */
  public async getHealth(): Promise<AgentHealthStatus> {
    try {
      const res = await fetch('/api/llm/health', { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return { online: false };
      return (await res.json()) as AgentHealthStatus;
    } catch {
      return { online: false };
    }
  }

  /** Whether any AI brain backend (Gemini or Ollama) is online and ready. */
  public async checkHealth(): Promise<boolean> {
    const health = await this.getHealth();
    return health.online === true;
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
DJ RULES: never start from the hook because buildup is essential; incoming songs must start from their intro/buildup; don't throw away a chorus or hook on the outgoing song; prefer mixing out where the current song calms down; short mixes for vocal-heavy Desi songs; long smooth blends for chill moods; high energy for parties. In party mood, never decrease the BPM of the original song.
Reply ONLY with JSON: {"exit": <number>, "entry": <number>, "style": "blend"|"cut", "bars": 4|8|16, "reason": "<max 12 words>"}`;

    const res = await this.askJson(prompt, 60, 12_000);
    if (!res) return null;
    const parsed = MixDecisionSchema.safeParse(res.data);
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

    const res = await this.askJson(prompt, 40, 12_000);
    if (!res) return null;
    const parsed = NextSongSchema.safeParse(res.data);
    if (!parsed.success || parsed.data.pick > ctx.options.length) return null;
    return parsed.data;
  }

  /**
   * Asks the AI DJ (Ollama primary / Gemini backup) to evaluate and synchronize
   * live percussion enhancement (Deck P) for the active song.
   */
  public async syncPercussion(ctx: PercussionSyncContext): Promise<AIPercussionSyncDecision | null> {
    const prompt = `You are an expert club DJ and live percussionist.
Analyze this active track on air and decide how to sync live percussion (Deck P) to enhance the party energy.

ACTIVE TRACK:
- Title: "${ctx.track.title}" by ${ctx.track.artist}
- Tempo: ${Math.round(ctx.track.effectiveBpm)} BPM (natural: ${Math.round(ctx.track.bpm)} BPM)
- Beat Confidence: ${Math.round(ctx.track.confidence * 100)}%
- Mood: ${ctx.mood}
${ctx.track.highlightTime ? `- Viral Hook / Chorus Drop at: ${Math.round(ctx.track.highlightTime)}s\n` : ''}
AVAILABLE LIVE PERCUSSION PATTERNS:
1) "punjabi_dhol" - Authentic Punjabi Dhol Chaap (heavy curved Dagga + sharp Thapi slap, ideal for high-energy Punjabi/Desi/Bollywood club bangers >= 126 BPM)
2) "bhangra_groove" - Traditional Bhangra Dholak & Chimta (bouncy swing groove, ideal for Bhangra, folk, or medium tempo Desi hits 90-125 BPM)
3) "electronic_drums" - Club 4-on-the-Floor (punchy 909 kick, snappy 808 clap on 2 & 4, 16th hats, ideal for EDM, house, club dance, techno)
4) "afrobeat" - Syncopated wooden congas, organic shakers, and deep polyrhythmic bounce (ideal for Afrobeat, Amapiano, Latin, Reggaeton)
5) "none" - Muted/silent (use when track is acoustic, ballad, ambient, classical, vocal breakdown, or beat confidence is low)

RULES:
- If acoustic, slow/mellow ballad, or beat confidence < 60%, set shouldPlay: false, patternId: "none".
- For high-energy Punjabi bangers (Sidhu Moosewala, Diljit, Karan Aujla, AP Dhillon, etc.), lock onto "punjabi_dhol" or "bhangra_groove".
- For House, EDM, Club Remixes, lock onto "electronic_drums".
- For Burna Boy, Rema, Wizkid, Amapiano, Latin, lock onto "afrobeat".
- Set duckDuringVerse: true so drums sit quietly in verses and unleash full punch right when the viral hook drops.

Respond ONLY with valid JSON in this exact schema:
{
  "shouldPlay": true,
  "patternId": "punjabi_dhol",
  "intensity": 1.0,
  "volume": 0.85,
  "duckDuringVerse": true,
  "reason": "short explanation of the rhythmic sync choice and energy arrangement"
}`;

    const res = await this.askJson(prompt, 180, 5000);
    if (!res) return null;
    const parsed = PercussionSyncSchema.safeParse(res.data);
    return parsed.success ? parsed.data : null;
  }

  /**
   * Reads the user's mood from a searched/played song and recommends the top 5
   * songs matching that exact mood and momentum to push to the top of the queue.
   */
  public async readMoodAndRecommendTop5(track: {
    title: string;
    artist: string;
    bpm?: number;
  }): Promise<MoodReadingResult> {
    const prompt = `You are an elite party AI DJ with deep musical psychology and genre expertise.
A user just searched for and played this song:
TRACK: "${track.title}" by "${track.artist || 'Unknown'}"${track.bpm ? ` (${Math.round(track.bpm)} BPM)` : ''}.

TASK:
1. READ THE USER'S MOOD: Analyze the musical vibe, lyrical emotion, cultural context, danceability, and energy of this song to determine what mood the user is in.
2. RECOMMEND TOP 5 SONGS: Pick the 5 best, most musically compatible songs that match this exact mood and momentum to play immediately next in the DJ set.
Do NOT suggest the same song that is currently playing. Provide 5 distinct, high-quality songs matching the vibe. All songs MUST be standard radio length (under 5 minutes, avoid long 8+ minute extended mixes or compilations).

Reply ONLY with valid JSON in this exact structure:
{
  "detectedMood": "<short mood label, e.g. High-Energy Punjabi Club, Late Night Melodic R&B, Euphoric House, Romantic Acoustic>",
  "energyLevel": "low" | "medium" | "high" | "peak",
  "vibeDescription": "<one sentence describing the mood>",
  "top5Songs": [
    { "title": "<Song Title 1>", "artist": "<Artist 1>", "searchPrompt": "<Artist 1> - <Song Title 1>" },
    { "title": "<Song Title 2>", "artist": "<Artist 2>", "searchPrompt": "<Artist 2> - <Song Title 2>" },
    { "title": "<Song Title 3>", "artist": "<Artist 3>", "searchPrompt": "<Artist 3> - <Song Title 3>" },
    { "title": "<Song Title 4>", "artist": "<Artist 4>", "searchPrompt": "<Artist 4> - <Song Title 4>" },
    { "title": "<Song Title 5>", "artist": "<Artist 5>", "searchPrompt": "<Artist 5> - <Song Title 5>" }
  ],
  "reason": "<short explanation, max 15 words>"
}`;

    try {
      const res = await this.askJson(prompt, 350, 15_000);
      if (res && res.data) {
        const parsed = MoodReadingSchema.safeParse(res.data);
        if (parsed.success && parsed.data.top5Songs.length >= 3) {
          return {
            ...parsed.data,
            top5Songs: parsed.data.top5Songs.slice(0, 5),
            source: 'ai',
          };
        }
      }
    } catch (err) {
      console.warn('AI mood reading failed, falling back to heuristic:', err);
    }

    return this.heuristicMoodFallback(track);
  }

  /**
   * Deterministic heuristic mood classifier and top 5 recommendation fallback.
   */
  private heuristicMoodFallback(track: { title: string; artist: string; bpm?: number }): MoodReadingResult {
    const combined = `${track.title} ${track.artist}`.toLowerCase();

    // 1. Punjabi / Bhangra / Desi Hype
    if (
      /moose|sidhu|diljit|aujla|dhillon|shubh|punjabi|bhangra|karan|ap dhillon|amrinder|badshah|honey singh|guru randhawa|mankirt|jassi|channi/i.test(
        combined
      )
    ) {
      return {
        detectedMood: 'High-Energy Punjabi Club Bangers',
        energyLevel: 'peak',
        vibeDescription: 'Heavy bass, dholak rhythm, and high-octane modern Punjabi bangers',
        top5Songs: [
          { title: 'Softly', artist: 'Karan Aujla', searchPrompt: 'Karan Aujla - Softly' },
          { title: 'Brown Munde', artist: 'AP Dhillon', searchPrompt: 'AP Dhillon - Brown Munde' },
          { title: 'Same Beef', artist: 'Sidhu Moose Wala', searchPrompt: 'Sidhu Moose Wala - Same Beef' },
          { title: 'Cheques', artist: 'Shubh', searchPrompt: 'Shubh - Cheques' },
          { title: 'Born to Shine', artist: 'Diljit Dosanjh', searchPrompt: 'Diljit Dosanjh - Born to Shine' },
        ],
        reason: 'Matched authentic Punjabi dancefloor momentum and heavy rhythm',
        source: 'heuristic',
      };
    }

    // 2. Bollywood Dance / Party
    if (
      /arijit|neha|badshah|bollywood|mika|jubin|chull|aankh marey|kala chashma|nashe si|ghungroo|salman|shahrukh/i.test(
        combined
      )
    ) {
      return {
        detectedMood: 'Bollywood Party Dance Anthems',
        energyLevel: 'high',
        vibeDescription: 'Celebratory, upbeat Bollywood club dance hits for singing and dancing along',
        top5Songs: [
          { title: 'Kala Chashma', artist: 'Badshah', searchPrompt: 'Badshah - Kala Chashma' },
          { title: 'Ghungroo', artist: 'Arijit Singh', searchPrompt: 'Arijit Singh - Ghungroo' },
          { title: 'Blue Eyes', artist: 'Yo Yo Honey Singh', searchPrompt: 'Yo Yo Honey Singh - Blue Eyes' },
          { title: 'Subha Hone Na De', artist: 'Mika Singh', searchPrompt: 'Mika Singh - Subha Hone Na De' },
          { title: 'Kar Gayi Chull', artist: 'Badshah', searchPrompt: 'Badshah - Kar Gayi Chull' },
        ],
        reason: 'Selected chart-topping Bollywood party tracks to keep the energy soaring',
        source: 'heuristic',
      };
    }

    // 3. Electronic / House / EDM
    if (/calvin harris|david guetta|tiesto|house|edm|techno|fisher|peggy gou|remix|fred again|meduza|john summit/i.test(combined)) {
      return {
        detectedMood: 'Euphoric Club House & EDM',
        energyLevel: 'high',
        vibeDescription: 'Driving four-on-the-floor kick drums and energetic festival anthems',
        top5Songs: [
          { title: 'Losing It', artist: 'Fisher', searchPrompt: 'Fisher - Losing It' },
          { title: '(It Goes Like) Nanana', artist: 'Peggy Gou', searchPrompt: 'Peggy Gou - Nanana' },
          { title: 'One Kiss', artist: 'Calvin Harris', searchPrompt: 'Calvin Harris - One Kiss' },
          { title: 'adore u', artist: 'Fred again..', searchPrompt: 'Fred again.. - adore u' },
          { title: 'Piece Of Your Heart', artist: 'Meduza', searchPrompt: 'Meduza - Piece Of Your Heart' },
        ],
        reason: 'Selected pulsating club house tracks to preserve seamless four-on-the-floor momentum',
        source: 'heuristic',
      };
    }

    // 4. Afrobeat / Amapiano
    if (/burna|rema|wizkid|asake|afro|amapiano|davido|tyla|amapiano/i.test(combined)) {
      return {
        detectedMood: 'Vibrant Afrobeat & Amapiano Groove',
        energyLevel: 'medium',
        vibeDescription: 'Hypnotic syncopated log drums and tropical dance bounce',
        top5Songs: [
          { title: 'Last Last', artist: 'Burna Boy', searchPrompt: 'Burna Boy - Last Last' },
          { title: 'Calm Down', artist: 'Rema', searchPrompt: 'Rema - Calm Down' },
          { title: 'Lonely At The Top', artist: 'Asake', searchPrompt: 'Asake - Lonely At The Top' },
          { title: 'Essence', artist: 'Wizkid', searchPrompt: 'Wizkid - Essence' },
          { title: 'Water', artist: 'Tyla', searchPrompt: 'Tyla - Water' },
        ],
        reason: 'Sequenced tropical polyrhythmic Afrobeat grooves for infectious dance vibe',
        source: 'heuristic',
      };
    }

    // 5. Default Global Pop / Party Club
    return {
      detectedMood: 'Upbeat Pop & Global Club Bangers',
      energyLevel: 'high',
      vibeDescription: 'Modern chart-topping pop and dance hits with undeniable crowd appeal',
      top5Songs: [
        { title: 'Blinding Lights', artist: 'The Weeknd', searchPrompt: 'The Weeknd - Blinding Lights' },
        { title: 'Levitating', artist: 'Dua Lipa', searchPrompt: 'Dua Lipa - Levitating' },
        { title: 'Shape of You', artist: 'Ed Sheeran', searchPrompt: 'Ed Sheeran - Shape of You' },
        { title: 'Cruel Summer', artist: 'Taylor Swift', searchPrompt: 'Taylor Swift - Cruel Summer' },
        { title: 'As It Was', artist: 'Harry Styles', searchPrompt: 'Harry Styles - As It Was' },
      ],
      reason: 'Delivered universally loved high-energy anthems to match current vibe',
      source: 'heuristic',
    };
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
      // Allow up to 30s before falling back to heuristic
      const res = await this.askJson(systemPrompt, 160, 30_000);
      if (res === null) throw new Error('AI brain unavailable or timed out');

      // Validate with Zod
      const validatedPlan = AICommandSchema.parse(res.data);
      const latencyMs = Math.round(performance.now() - startTime);

      return {
        plan: validatedPlan,
        latencyMs,
        source: res.provider === 'gemini' ? 'gemini_flash' : 'ollama_qwen',
        provider: res.provider === 'gemini' ? 'gemini' : 'ollama',
        model: res.model,
        rawResponse: JSON.stringify(res.data),
      };
    } catch (err) {
      console.warn('AI LLM unavailable or schema error, using deterministic fallback:', err);
      const fallbackPlan = this.heuristicFallback(userInput, currentContext);
      const latencyMs = Math.round(performance.now() - startTime);

      return {
        plan: fallbackPlan,
        latencyMs,
        source: 'fallback_heuristic',
        provider: 'heuristic',
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
