/**
 * Moods and the master equalizer.
 *
 * A mood is a one-tap preset for the whole party: how the mix sounds (EQ), how songs
 * are blended (blend length, hook cueing), and what auto-curation looks for.
 */

export type EqBandId = 'bass' | 'lowMid' | 'mid' | 'presence' | 'treble';
export type EqGains = Record<EqBandId, number>; // dB, -12 … +12

export interface EqBand {
  id: EqBandId;
  label: string;
  hint: string;
  type: BiquadFilterType;
  frequency: number;
  q?: number;
}

/** Master EQ bands, low to high. Bass is a shelf so it lifts the whole kick / 808 range. */
export const EQ_BANDS: EqBand[] = [
  { id: 'bass', label: 'Bass', hint: 'Kick, 808, dhol dagga', type: 'lowshelf', frequency: 100 },
  { id: 'lowMid', label: 'Low-Mid', hint: 'Warmth (too much = muddy)', type: 'peaking', frequency: 300, q: 1 },
  { id: 'mid', label: 'Mid', hint: 'Vocals and melody', type: 'peaking', frequency: 1000, q: 1 },
  { id: 'presence', label: 'Presence', hint: 'Clarity, dhol thapi crack', type: 'peaking', frequency: 3500, q: 1 },
  { id: 'treble', label: 'Treble', hint: 'Hi-hats, sparkle', type: 'highshelf', frequency: 10000 },
];

export const EQ_MIN_DB = -12;
export const EQ_MAX_DB = 12;

export const FLAT_EQ: EqGains = { bass: 0, lowMid: 0, mid: 0, presence: 0, treble: 0 };

export type MoodId = 'normal' | 'party' | 'bhangra' | 'chill' | 'romantic';

export interface Mood {
  id: MoodId;
  label: string;
  emoji: string;
  description: string;
  eq: EqGains;
  blendBars: number; // length of a beatmatched blend
  hookCue: boolean; // start incoming songs just before their hook
  autoDrums: boolean; // turn on AI drums (dhol) when this mood is chosen
  // Lock the whole set to one tempo inside this range, time-stretching songs with key lock
  // (tempo changes, pitch doesn't). Undefined = songs keep their natural tempo.
  tempoLock?: { min: number; max: number; preferred: number };
}

/**
 * Party tempo range. People's natural movement tempo is just above 120 BPM (~2 Hz) and
 * dance music clusters at 125–130 BPM (Moelants 2002, 2008), so 120–130 keeps a floor dancing.
 */
export const PARTY_TEMPO = { min: 120, max: 130, preferred: 124 };

export const MOODS: Mood[] = [
  {
    id: 'normal',
    label: 'Normal',
    emoji: '🎵',
    description: 'Flat sound, standard 8-bar blends',
    eq: FLAT_EQ,
    blendBars: 8,
    hookCue: true,
    autoDrums: false,
  },
  {
    id: 'party',
    label: 'Party',
    emoji: '🎉',
    description: 'Whole set locked to a 120–130 BPM dance tempo (key-locked), punchy bass',
    eq: { bass: 4, lowMid: -1, mid: 0, presence: 1.5, treble: 2 },
    blendBars: 8,
    hookCue: true,
    autoDrums: false,
    tempoLock: PARTY_TEMPO,
  },
  {
    id: 'bhangra',
    label: 'Bhangra',
    emoji: '🥁',
    description: 'Heavy bass, live dhol on, short punchy mixes',
    eq: { bass: 5, lowMid: 0, mid: 1, presence: 2, treble: 1 },
    blendBars: 4, // Punjabi vocals clash on long overlaps
    hookCue: true,
    autoDrums: true,
  },
  {
    id: 'chill',
    label: 'Chill',
    emoji: '🌙',
    description: 'Warm and soft, long smooth blends, songs from the start',
    eq: { bass: 2, lowMid: 0, mid: -1, presence: -1, treble: -2 },
    blendBars: 16,
    hookCue: false,
    autoDrums: false,
  },
  {
    id: 'romantic',
    label: 'Romantic',
    emoji: '💕',
    description: 'Warm vocals, long blends, songs from the start',
    eq: { bass: 1, lowMid: 1, mid: 1, presence: 0, treble: -1 },
    blendBars: 16,
    hookCue: false,
    autoDrums: false,
  },
];

export const getMood = (id: MoodId): Mood => MOODS.find((m) => m.id === id) ?? MOODS[0];
