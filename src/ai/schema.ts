import { z } from 'zod';

export const AICommandSchema = z.object({
  action: z.enum([
    'execute_transition',
    'control_percussion',
    'adjust_eq',
    'tempo_sync',
    'playback_control',
    'unknown',
  ]),
  target_deck: z.enum(['A', 'B', 'both', 'none']).default('none'),
  transition: z
    .object({
      target_deck: z.enum(['A', 'B']),
      style: z.enum(['bass_swap', 'smooth_crossfade', 'drop_cut']).default('bass_swap'),
      duration_seconds: z.number().min(2).max(32).default(8),
      sync_percussion: z.boolean().default(true),
    })
    .optional(),
  percussion: z
    .object({
      active: z.boolean(),
      pattern_id: z.enum(['punjabi_dhol', 'bhangra_groove', 'electronic_drums', 'afrobeat']).optional(),
      volume: z.number().min(0).max(1).optional(),
      sync_to_deck: z.enum(['A', 'B', 'manual']).optional(),
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
  explanation: z.string().describe('Short explanation of DJ mixing decision and musical reasoning'),
});

export type AICommandPlan = z.infer<typeof AICommandSchema>;
