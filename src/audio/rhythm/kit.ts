/**
 * The dhol wala's sample kit: real recorded one-shots (all CC0, see public/percussion/CREDITS.md),
 * several takes per stroke so repeated hits don't sound machine-gunned. Each head gets a level
 * trim, a low cut and a stereo position so the dhol sits around the song instead of on top of
 * its kick and 808.
 */

export type VoiceId =
  | 'dholBass' // dhol "dagga" side: the deep boom (played with the bent stick)
  | 'dholCrack' // dhol "tilli" side: the thin-stick crack
  | 'dholakGe' // dholak bass head
  | 'dholakNa'; // dholak treble head

interface VoiceSpec {
  files: string[];
  trimDb: number; // balances the peak-normalized samples by ear-level loudness
  lowCutHz: number; // keeps the song's own kick/808 range clear
  pan: number; // -1 left … 1 right
  mutedDecay: number; // seconds: a damped ("m") stroke is cut short to this
}

const takes = (name: string, count: number) => Array.from({ length: count }, (_, i) => `${name}_${i + 1}.wav`);

export const VOICES: Record<VoiceId, VoiceSpec> = {
  dholBass: { files: takes('dhol_bass', 4), trimDb: -2, lowCutHz: 75, pan: 0, mutedDecay: 0.09 },
  // The tilli "tak": the dhol's own treble head (body around 200–450 Hz). Cut at 140 Hz only, to
  // drop the previous dagga stroke ringing under it; a higher cut thinned it into a click
  dholCrack: { files: takes('dhol_crack', 4), trimDb: -4, lowCutHz: 140, pan: 0.12, mutedDecay: 0.05 },
  dholakGe: { files: takes('dholak_ge', 4), trimDb: -3, lowCutHz: 70, pan: -0.08, mutedDecay: 0.08 },
  dholakNa: { files: takes('dholak_na', 4), trimDb: -5, lowCutHz: 200, pan: -0.15, mutedDecay: 0.05 },
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
