import { runAnalysis, AnalysisFields } from './trackAnalysis';
import { computeRhythmFeatures } from '../rhythm/rhythmPlan';

interface AnalysisRequest {
  id: number;
  channels: Float32Array[];
  sampleRate: number;
  fields: AnalysisFields;
  strict: boolean;
}

// Typed locally so the app's DOM-only tsconfig doesn't need the WebWorker lib
const worker = self as unknown as {
  onmessage: ((event: MessageEvent<AnalysisRequest>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

worker.onmessage = (event) => {
  const { id, channels, sampleRate, fields, strict } = event.data;
  try {
    // The detectors only read samples, so plain arrays stand in for the AudioBuffer
    const buffer = {
      sampleRate,
      length: channels[0].length,
      duration: channels[0].length / sampleRate,
      numberOfChannels: channels.length,
      getChannelData: (c: number) => channels[c],
    } as unknown as AudioBuffer;
    const { intro } = runAnalysis(buffer, fields, strict);
    const profile = fields.energyProfile!;
    const rhythmFeatures = computeRhythmFeatures(buffer, profile);
    worker.postMessage({ id, fields, intro, rhythmFeatures }, [profile.full.buffer, profile.mid.buffer]);
  } catch (err) {
    worker.postMessage({ id, error: String(err) });
  }
};
