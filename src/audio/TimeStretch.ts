/**
 * Key-locked tempo change ("master tempo"): WSOLA time-stretching.
 *
 * Changing playbackRate changes pitch with tempo. WSOLA (Waveform Similarity Overlap-Add)
 * instead re-assembles the audio from overlapping 46 ms grains taken at a different
 * spacing than they are written, nudging each grain (±11 ms) to where the waveform best
 * continues the previous one. Tempo changes; pitch does not.
 *
 * Runs offline on a whole song (in a Web Worker, see timeStretch.worker.ts). Good for
 * roughly ±25%; beyond that grains start to audibly repeat or skip.
 */

const FRAME = 2048; // ~46 ms at 44.1 kHz
const HOP_OUT = FRAME / 2; // 50% overlap with a periodic Hann window sums to exactly 1
const TOLERANCE = 512; // how far each grain may be nudged to stay in phase (~11.6 ms)
const COARSE_STEP = 8;

/**
 * @param channels   Input PCM per channel (all equal length)
 * @param tempoRatio New tempo / old tempo (1.2 = 20% faster, output 1/1.2 as long)
 */
export function wsolaStretch(channels: Float32Array[], tempoRatio: number): Float32Array[] {
  const inLength = channels[0].length;
  if (Math.abs(tempoRatio - 1) < 1e-4) return channels.map((c) => c.slice());

  const outLength = Math.floor(inLength / tempoRatio);
  const hopIn = HOP_OUT * tempoRatio;
  const window = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME);

  // Mono guide signal for choosing grain positions, so all channels stay phase-coherent
  const mono = new Float32Array(inLength);
  for (const ch of channels) for (let i = 0; i < inLength; i++) mono[i] += ch[i] / channels.length;

  const outputs = channels.map(() => new Float32Array(outLength + FRAME));
  const overlap = FRAME - HOP_OUT;

  // Similarity of the candidate grain at `pos` to the natural continuation at `target`
  const similarity = (pos: number, target: number, step: number) => {
    let sum = 0;
    for (let i = 0; i < overlap; i += step) sum += mono[pos + i] * mono[target + i];
    return sum;
  };

  let previousPos = 0;
  for (let outPos = 0, k = 0; outPos < outLength; outPos += HOP_OUT, k++) {
    const nominal = Math.round(k * hopIn);
    let bestPos = nominal;

    if (k > 0) {
      // Where the previous grain would naturally have continued
      const continuation = previousPos + HOP_OUT;
      const lo = Math.max(0, nominal - TOLERANCE);
      const hi = Math.min(inLength - FRAME - 1, nominal + TOLERANCE);
      if (continuation + overlap < inLength && hi > lo) {
        // Coarse search on every 8th offset/sample, then refine around the winner
        let bestScore = -Infinity;
        for (let p = lo; p <= hi; p += COARSE_STEP) {
          const s = similarity(p, continuation, COARSE_STEP);
          if (s > bestScore) {
            bestScore = s;
            bestPos = p;
          }
        }
        const coarse = bestPos;
        bestScore = -Infinity;
        for (let p = Math.max(lo, coarse - COARSE_STEP + 1); p <= Math.min(hi, coarse + COARSE_STEP - 1); p++) {
          const s = similarity(p, continuation, 2);
          if (s > bestScore) {
            bestScore = s;
            bestPos = p;
          }
        }
      }
    }
    if (bestPos + FRAME > inLength) break;

    for (let c = 0; c < channels.length; c++) {
      const input = channels[c];
      const output = outputs[c];
      for (let i = 0; i < FRAME; i++) output[outPos + i] += input[bestPos + i] * window[i];
    }
    previousPos = bestPos;
  }

  return outputs.map((o) => o.subarray(0, outLength));
}
