/**
 * Runs the key-locked WSOLA time-stretch (TimeStretch.ts) in a Web Worker, so stretching
 * a whole song (~1 s of CPU) never blocks the UI. Audio playback runs on its own thread
 * either way.
 */

let worker: Worker | null = null;
let nextId = 0;
const waiting = new Map<number, { resolve: (channels: Float32Array[]) => void; reject: (err: unknown) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./timeStretch.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ id: number; channels: Float32Array[] }>) => {
      waiting.get(event.data.id)?.resolve(event.data.channels);
      waiting.delete(event.data.id);
    };
    worker.onerror = (err) => {
      for (const job of waiting.values()) job.reject(err);
      waiting.clear();
      worker = null; // recreate on next use
    };
  }
  return worker;
}

/** Returns a copy of `buffer` at `tempoRatio` × the tempo, with the original pitch. */
export function stretchAudioBuffer(ctx: BaseAudioContext, buffer: AudioBuffer, tempoRatio: number): Promise<AudioBuffer> {
  const id = nextId++;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice());
  return new Promise((resolve, reject) => {
    waiting.set(id, {
      resolve: (output) => {
        const stretched = ctx.createBuffer(output.length, output[0].length, buffer.sampleRate);
        output.forEach((data, c) => stretched.getChannelData(c).set(data));
        resolve(stretched);
      },
      reject,
    });
    getWorker().postMessage({ id, channels, tempoRatio }, channels.map((c) => c.buffer));
  });
}
