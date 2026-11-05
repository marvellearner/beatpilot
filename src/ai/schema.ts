import { z } from 'zod';
import { RHYTHM_STYLE_IDS } from '../audio/rhythm/styles';

export const AICommandSchema = z.object({
  action: z.enum([
    'execute_transition',
    'control_percussion',
    'adjust_eq',
    'tempo_sync',
    'playback_control',
    'queue_control',
    'unknown',
  ]),
  target_deck: z.enum(['A', 'B', 'both', 'none']).default('none'),
  transition: z
    .object({
      target_deck: z.enum(['A', 'B']),
      style: z
        .enum([
          'filter_bass_swap',
          'loop_roll_riser',
          'vinyl_brake_drop',
          'echo_freeze_throw',
          'showcase_3band_handoff',
          'reverb_wash_drop',
          'drop_cut',
          'bass_swap',
          'smooth_crossfade',
          'tempo_ramp',
        ])
        .default('filter_bass_swap'),
      duration_seconds: z.number().min(0.2).max(32).default(8),
    })
    .optional(),
  // Live Rhythm Enhancer (the dhol wala): on/off, taal, level, and live cues (roll, dhol break,
  // dhamaal = go big, rest). It follows the song on air by itself
  percussion: z
    .object({
      active: z.boolean(),
      style_id: z.enum(RHYTHM_STYLE_IDS).optional(),
      level: z.number().min(0).max(1).optional(),
      cue: z.enum(['roll', 'break', 'dhamaal', 'rest']).optional(),
    })
    .optional(),
  eq: z
    .object({
      deck: z.enum(['A', 'B']),
      low: z.number().min(-40).max(6).optional(),
      mid: z.number().min(-40).max(6).optional(),
      high: z.number().min(-40).max(6).optional(),
    })
    .optional(),
  playback: z
    .object({
      deck: z.enum(['A', 'B', 'both']),
      command: z.enum(['play', 'pause', 'stop']),
    })
    .optional(),
  // Songs and Up Next: play only / more of some artists, back to normal, or play a song now
  queue: z
    .object({
      focus_artists: z.array(z.string().min(1)).max(5).optional(),
      vibe: z.enum(['dance', 'romantic', 'chill', 'bhangra']).optional(),
      language: z.enum(['punjabi', 'hindi', 'english', 'spanish']).optional(),
      era: z.enum(['old', '90s', '2000s', 'new']).optional(),
      only: z.boolean().optional(), // true: nothing else plays; false: just more of them
      clear_focus: z.boolean().optional(),
      play_song: z.string().min(1).optional(),
    })
    .optional(),
  explanation: z.string().describe('Short explanation of DJ mixing decision and musical reasoning'),
});

export type AICommandPlan = z.infer<typeof AICommandSchema>;
