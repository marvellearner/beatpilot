/**
 * Runs a song's analysis (trackAnalysis.ts) in a Web Worker, so loading a song never freezes
 * the UI. Same pattern as stretchInWorker.ts.
 */

import type { IntroAnalysisResult } from '../IntroSkitDetector';
import type { AnalysisFields } from './trackAnalysis';
import type { SongRhythmFeatures } from '../rhythm/rhythmPlan';

interface AnalysisReply {
  id: number;
  fields?: AnalysisFields;
  intro?: IntroAnalysisResult;
  rhythmFeatures?: SongRhythmFeatures;
  error?: string;
}

let worker: Worker | null = null;
let nextId = 0;
const waiting = new Map<number, { resolve: (reply: AnalysisReply) => void; reject: (err: unknown) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<AnalysisReply>) => {
      const job = waiting.get(event.data.id);
      waiting.delete(event.data.id);
      if (event.data.error) job?.reject(new Error(event.data.error));
      else job?.resolve(event.data);
    };
    worker.onerror = (err) => {
      for (const job of waiting.values()) job.reject(err);
      waiting.clear();
      worker = null; // recreate on next use
    };
  }
  return worker;
}

// A 4-minute stereo song is ~85 MB of samples: copied for the worker in pieces, with a pause
// between them, so the copy itself doesn't stall the page (~60 ms in one go)
const COPY_CHUNK = 1 << 21; // samples (8 MB)

async function copyChannels(buffer: AudioBuffer): Promise<Float32Array[]> {
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const source = buffer.getChannelData(c);
    const copy = new Float32Array(source.length);
    for (let i = 0; i < source.length; i += COPY_CHUNK) {
      copy.set(source.subarray(i, i + COPY_CHUNK), i);
      await new Promise((r) => setTimeout(r, 0));
    }
    channels.push(copy);
  }
  return channels;
}

/** Analyses `buffer` off the main thread, starting from what `fields` already knows. */
export async function analyzeInWorker(
  buffer: AudioBuffer,
  fields: AnalysisFields,
  strict: boolean
): Promise<{ fields: AnalysisFields; intro?: IntroAnalysisResult; rhythmFeatures?: SongRhythmFeatures }> {
  const id = nextId++;
  const channels = await copyChannels(buffer);
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve: (reply) => resolve({ fields: reply.fields!, intro: reply.intro, rhythmFeatures: reply.rhythmFeatures }), reject });
    getWorker().postMessage({ id, channels, sampleRate: buffer.sampleRate, fields, strict }, channels.map((c) => c.buffer));
  });
}
