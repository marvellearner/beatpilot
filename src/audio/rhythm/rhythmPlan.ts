/**
 * Per-song rhythm decision: whether the Live Rhythm Enhancer plays on a song, in which style
 * and how loud. Nobody has to choose anything.
 *
 * Who decides what (tested on the app's local model, qwen2.5:3b, with 20 real songs):
 * - The AI DJ identifies the song's language. With the answer constrained to one value it
 *   got 17/20 right (all English/Spanish songs; misses were Punjabi <-> Hindi), in ~3 s.
 *   Asked to choose the style itself it put dhol on almost everything, called "Blinding
 *   Lights" bhangra and ignored the audio, so it isn't asked for the style.
 * - The style and level then follow from the language, the mood and the song's measured
 *   audio (`planRhythm`). Without the AI, the language is guessed from the title and artist.
 *
 * Audio thresholds are calibrated on 60 songs from this app's cache (mostly Punjabi,
 * Bollywood and pop): roughly the 25th and 75th percentiles of each measure.
 */
import { RHYTHM_STYLES, type RhythmStyleId } from './styles';
import type { EnergyProfile } from '../MixPointPlanner';
import type { MoodId } from '../Moods';
import type { SongLanguage } from '../../../shared/songLanguage';
export { SONG_LANGUAGES, guessLanguage, type SongLanguage } from '../../../shared/songLanguage';

export interface RhythmPlan {
  play: boolean;
  styleId: RhythmStyleId;
  level: number; // 0.3–1, how present the layer is on this song (0.7 = normal)
  reason: string;
  source: 'ai' | 'known' | 'guess'; // who identified the song: the AI DJ, a known artist/script, or a guess
}


export interface SongRhythmFeatures {
  midShare: number; // 300 Hz–3 kHz share of the loudness: vocals and leads
  contrastDb: number; // loud parts vs quieter parts (8 s windows, 90th vs 30th percentile)
  punch: number; // how hard the low end hits (kick, 808, dhol), relative to its level
}

/** One pass over the audio (about 30 ms for a 4-minute song). */
export function computeRhythmFeatures(buffer: AudioBuffer, profile: EnergyProfile): SongRhythmFeatures {
  const mean = (a: ArrayLike<number>, from = 0, to = a.length) => {
    let s = 0;
    for (let i = from; i < to; i++) s += a[i];
    return to > from ? s / (to - from) : 0;
  };
  const midShare = mean(profile.mid) / (mean(profile.full) || 1);

  const win = Math.max(1, Math.round(profile.rate * 8));
  const windows: number[] = [];
  for (let i = 0; i + win <= profile.full.length; i += win) windows.push(mean(profile.full, i, i + win));
  windows.sort((a, b) => a - b);
  const q = (p: number) => windows[Math.min(windows.length - 1, Math.floor(windows.length * p))] ?? 0;
  const contrastDb = windows.length ? 20 * Math.log10((q(0.9) || 1e-9) / (q(0.3) || 1e-9)) : 0;

  // Low band (< 150 Hz) in ~23 ms blocks; punch = average rise between blocks / average level
  const data = buffer.getChannelData(0);
  const block = Math.max(1, Math.round(buffer.sampleRate * 0.0232));
  const a = 1 - Math.exp((-2 * Math.PI * 150) / buffer.sampleRate);
  let lo = 0, acc = 0, n = 0, prev = -1, rise = 0, levels = 0, count = 0;
  for (let i = 0; i < data.length; i++) {
    lo += a * (data[i] - lo);
    acc += lo * lo;
    if (++n === block) {
      const level = Math.sqrt(acc / block);
      if (prev >= 0) rise += Math.max(0, level - prev);
      prev = level;
      levels += level;
      count++;
      acc = 0;
      n = 0;
    }
  }
  const punch = count > 1 ? rise / count / (levels / count || 1e-9) : 0;
  return { midShare, contrastDb, punch };
}

const DEVOTIONAL = /\b(chalisa|aarti|bhajan|mantra|shabad|gurbani|kirtan|naat|stotram|hymn|devotional|bhakti)\b/i;


const MOOD_PHRASE: Record<MoodId, string> = {
  normal: 'normal mood',
  party: 'party mood',
  bhangra: 'bhangra mood',
  chill: 'chill mood',
  romantic: 'romantic mood',
};

const LANGUAGE_LABEL: Record<SongLanguage, string> = {
  punjabi: 'Punjabi',
  hindi: 'Hindi',
  english: 'English',
  spanish: 'Spanish',
  other: '',
  unknown: '',
};

/**
 * The decision. Style from language + mood; level and a few style changes from the audio
 * (hard-hitting drums -> lighter, vocal-heavy -> lighter, soft drums at a party -> add a kick).
 */
export function planRhythm(
  song: { title: string; artist: string; bpm: number; bpmConfidence: number },
  mood: MoodId,
  features: SongRhythmFeatures | null,
  language: SongLanguage,
  source: RhythmPlan['source']
): RhythmPlan {
  const lang = LANGUAGE_LABEL[language];
  const what = `${lang ? `${lang} ` : ''}song`;
  const plan = (play: boolean, styleId: RhythmStyleId, level: number, reason: string): RhythmPlan => ({ play, styleId, level, reason, source });

  if (song.bpmConfidence < 0.5) return plan(false, 'light_shaker', 0.5, 'beat not clear enough to play along');
  if (DEVOTIONAL.test(`${song.title} ${song.artist}`)) return plan(false, 'light_shaker', 0.5, 'devotional song: left as it is');
  if (song.bpm < 75 && mood !== 'party' && mood !== 'bhangra') return plan(false, 'light_shaker', 0.5, 'slow song: left as it is');

  const desi = language === 'punjabi' || language === 'hindi';
  const clubTempo = song.bpm >= 118 && song.bpm <= 132;
  let styleId: RhythmStyleId;
  switch (mood) {
    case 'bhangra':
      styleId = 'dhol_dhamaal';
      break;
    case 'party':
      styleId =
        language === 'punjabi' ? 'dhol_dhamaal'
        : language === 'hindi' ? 'dholak_keherwa'
        : language === 'spanish' ? 'afro_groove'
        : clubTempo ? 'club_tops'
        : 'clap_tambourine';
      break;
    case 'chill':
    case 'romantic':
      styleId = desi ? 'dholak_keherwa' : 'light_shaker';
      break;
    default:
      styleId =
        language === 'punjabi' ? 'dhol_dhamaal'
        : language === 'hindi' ? 'dholak_keherwa'
        : language === 'spanish' ? 'afro_groove'
        : 'clap_tambourine';
  }

  let level = mood === 'chill' || mood === 'romantic' ? 0.45 : 0.7;
  const lighter: string[] = [];
  let extra = '';
  if (features) {
    if (features.punch > 0.13) {
      // The song's drums are already busy: stay lighter, and no extra boom on top of them
      level = Math.min(level, 0.5);
      if (styleId === 'dhol_dhamaal') styleId = 'dholak_keherwa';
      lighter.push('its drums are already strong');
    } else if (features.punch < 0.095 && mood === 'party' && !desi && language !== 'spanish') {
      styleId = 'club_drive';
      level = 0.8;
      extra = ', adding a kick because its drums are soft';
    }
    if (features.midShare > 0.58) {
      level = Math.min(level, 0.55);
      lighter.push('vocal-heavy');
    }
  }
  const name = RHYTHM_STYLES.find((s) => s.id === styleId)!.name;
  const why = lighter.length ? `, kept light (${lighter.join(', ')})` : extra;
  return plan(true, styleId, level, `${what}, ${MOOD_PHRASE[mood]}: ${name}${why}`);
}
