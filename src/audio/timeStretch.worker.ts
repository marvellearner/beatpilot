import { wsolaStretch } from './TimeStretch';

interface StretchRequest {
  id: number;
  channels: Float32Array[];
  tempoRatio: number;
}

// Typed locally so the app's DOM-only tsconfig doesn't need the WebWorker lib
const worker = self as unknown as {
  onmessage: ((event: MessageEvent<StretchRequest>) => void) | null;
  postMessage: (message: unknown, transfer: Transferable[]) => void;
};

worker.onmessage = (event) => {
  const { id, channels, tempoRatio } = event.data;
  const output = wsolaStretch(channels, tempoRatio);
  worker.postMessage({ id, channels: output }, output.map((c) => c.buffer));
};
