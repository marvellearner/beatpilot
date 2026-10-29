/**
 * The Live Rhythm Enhancer's sample kit: real recorded one-shots (all CC0, see
 * public/percussion/CREDITS.md), several takes per sound so repeated hits don't sound
 * machine-gunned. Each voice gets a level trim, a low cut and a stereo position so the
 * layer sits around the song instead of on top of its kick and 808.
 */

export type VoiceId =
  | 'dholBass' // dhol "dagga" side: the deep boom
  | 'dholCrack' // dhol "tilli" side: the thin-stick crack
  | 'dholakGe' // dholak bass head
  | 'dholakNa' // dholak treble head
  | 'stick'
  | 'tambourine'
  | 'shaker'
  | 'maraca'
  | 'clap'
  | 'kick'
  | 'conga'
  | 'frameDrum';

interface VoiceSpec {
  files: string[];
  trimDb: number; // balances the peak-normalized samples by ear-level loudness
  lowCutHz: number; // keeps the song's own kick/808 range clear
  pan: number; // -1 left … 1 right
}

const takes = (name: string, count: number) => Array.from({ length: count }, (_, i) => `${name}_${i + 1}.wav`);

export const VOICES: Record<VoiceId, VoiceSpec> = {
  dholBass: { files: takes('dhol_bass', 4), trimDb: -2, lowCutHz: 75, pan: 0 },
  dholCrack: { files: takes('dhol_crack', 4), trimDb: -5, lowCutHz: 300, pan: 0.12 },
  dholakGe: { files: takes('dholak_ge', 4), trimDb: -3, lowCutHz: 70, pan: -0.08 },
  dholakNa: { files: takes('dholak_na', 4), trimDb: -5, lowCutHz: 200, pan: -0.15 },
  stick: { files: takes('stick', 3), trimDb: -10, lowCutHz: 400, pan: 0.25 },
  tambourine: { files: ['tambourine.wav'], trimDb: -13, lowCutHz: 500, pan: -0.3 },
  shaker: { files: ['shaker.wav'], trimDb: -14, lowCutHz: 600, pan: 0.3 },
  maraca: { files: ['maraca.wav'], trimDb: -12, lowCutHz: 500, pan: -0.2 },
  clap: { files: ['clap.wav'], trimDb: -8, lowCutHz: 250, pan: 0 },
  kick: { files: ['kick.wav'], trimDb: -6, lowCutHz: 35, pan: 0 },
  conga: { files: ['conga.wav'], trimDb: -6, lowCutHz: 120, pan: -0.25 },
  frameDrum: { files: ['frame_drum.wav'], trimDb: -6, lowCutHz: 70, pan: 0.15 },
};

const BASE_URL = '/percussion/';

/** Decodes every take once; a voice whose files fail to load just stays silent. */
export async function loadKit(ctx: BaseAudioContext): Promise<Map<VoiceId, AudioBuffer[]>> {
  const kit = new Map<VoiceId, AudioBuffer[]>();
  await Promise.all(
    (Object.keys(VOICES) as VoiceId[]).map(async (voice) => {
      const buffers = await Promise.all(
        VOICES[voice].files.map(async (file) => {
          try {
            const res = await fetch(BASE_URL + file);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await ctx.decodeAudioData(await res.arrayBuffer());
          } catch (err) {
            console.warn(`Rhythm sample ${file} failed to load:`, err);
            return null;
          }
        })
      );
      kit.set(voice, buffers.filter((b): b is AudioBuffer => b !== null));
    })
  );
  return kit;
}
