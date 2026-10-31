/**
 * Per-song Live Rhythm Enhancer plans (see rhythm/rhythmPlan.ts for how a plan is decided).
 *
 * A plan is made from the song's language, the mood and the song's audio. The language comes
 * from a known artist/script, else from the AI DJ (asked once per song, one question at a time,
 * after any time-critical mix question, and remembered across sessions), else a guess.
 */
import type { DJAgent } from '../../ai/DJAgent';
import type { TrackMetadata } from '../../types';
import type { MoodId } from '../Moods';
import { songStorageKey } from '../songMatch';
import {
  computeRhythmFeatures,
  guessLanguage,
  planRhythm,
  type RhythmPlan,
  type SongLanguage,
  type SongRhythmFeatures,
} from '../rhythm/rhythmPlan';

const SONG_LANGUAGES_KEY = 'ai_dj_song_languages'; // the AI DJ's answer per song, so it's asked once
const MAX_REMEMBERED = 1000;

export interface SongRhythmPlansDeps {
  agent: DJAgent;
  mood: () => MoodId;
  aiOnline: () => boolean;
  aiBusy: () => boolean; // a mix or next-song question is in flight: wait for it
  onChange: () => void;
}

export class SongRhythmPlans {
  private languages = new Map<string, SongLanguage>();
  private languagesLoaded = false;
  private plans = new Map<string, RhythmPlan>(); // by "<song>|<mood>|<language>"
  private features = new Map<string, SongRhythmFeatures>();
  private asked = new Set<string>();
  private queue: TrackMetadata[] = [];
  private busy = false;

  constructor(private deps: SongRhythmPlansDeps) {}

  /** The song's audio measures, worked out elsewhere (the analysis worker). */
  public setFeatures(track: TrackMetadata, features: SongRhythmFeatures) {
    this.features.set(songStorageKey(track), features);
  }

  /**
   * The song's plan for the current mood, made on first use (cheap afterwards: the rhythm layer
   * calls this every tick). Songs the built-in guess isn't sure about are queued for the AI
   * (urgent = the song on air, asked first). Null until the song has been analysed.
   */
  public planFor(track: TrackMetadata, urgent = false): RhythmPlan | null {
    const song = songStorageKey(track);
    const mood = this.deps.mood();
    const guess = guessLanguage(track.title, track.artist);
    const fromAi = guess.sure ? undefined : this.languageFromAi(song);
    const useAi = fromAi !== undefined && fromAi !== 'unknown';
    const language = useAi ? fromAi! : guess.language;
    const key = `${song}|${mood}|${useAi ? language : '-'}`;

    let plan = this.plans.get(key) ?? null;
    if (!plan) {
      let features = this.features.get(song) ?? null;
      if (!features && track.audioBuffer && track.energyProfile) {
        features = computeRhythmFeatures(track.audioBuffer, track.energyProfile);
        this.features.set(song, features);
      }
      if (!features) return null; // not analysed yet
      plan = planRhythm(
        { title: track.title, artist: track.artist, bpm: track.bpm, bpmConfidence: track.bpmConfidence ?? 0 },
        mood,
        features,
        language,
        useAi ? 'ai' : guess.sure ? 'known' : 'guess'
      );
      this.plans.set(key, plan);
    }

    if (!guess.sure && fromAi === undefined && this.deps.aiOnline()) {
      if (!this.asked.has(song)) {
        this.asked.add(song);
        if (urgent) this.queue.unshift(track);
        else this.queue.push(track);
        void this.processQueue();
      } else if (urgent) {
        // Already waiting behind other songs: the song on air goes first
        const i = this.queue.findIndex((t) => songStorageKey(t) === song);
        if (i > 0) this.queue.unshift(...this.queue.splice(i, 1));
      }
    }
    return plan;
  }

  /** Asks the AI DJ about one song at a time (~3 s each), after any time-critical mix question. */
  private async processQueue() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length) {
        while (this.deps.aiBusy()) await new Promise((r) => window.setTimeout(r, 500));
        const track = this.queue.shift()!;
        const song = songStorageKey(track);
        if (this.languageFromAi(song) !== undefined) continue;
        const language = await this.deps.agent.identifySong(track.title, track.artist);
        if (!language) continue; // no answer: the built-in guess stays (asked again next session)
        this.languages.set(song, language);
        this.saveLanguages();
        this.deps.onChange();
      }
    } finally {
      this.busy = false;
    }
  }

  private languageFromAi(song: string): SongLanguage | undefined {
    if (!this.languagesLoaded) {
      this.languagesLoaded = true;
      try {
        const saved = JSON.parse(window.localStorage.getItem(SONG_LANGUAGES_KEY) || '{}');
        for (const [k, v] of Object.entries(saved)) if (typeof v === 'string') this.languages.set(k, v as SongLanguage);
      } catch {
        // unreadable: start empty
      }
    }
    return this.languages.get(song);
  }

  private saveLanguages() {
    try {
      // Keep the newest songs (Map keeps insertion order)
      const entries = [...this.languages.entries()].slice(-MAX_REMEMBERED);
      window.localStorage.setItem(SONG_LANGUAGES_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {
      // storage unavailable: songs are just asked about again next session
    }
  }
}
