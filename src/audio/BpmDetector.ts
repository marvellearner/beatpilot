/**
 * Web Audio BPM, Beat-Grid & Confidence Analyzer
 *
 * 1. Low-pass (~150 Hz) the PCM to isolate kicks and dhol strikes.
 * 2. Build a 5 ms energy envelope and its onset strength (rises in log energy).
 * 3. Autocorrelate the onset strength over 70–180 BPM beat periods, weighted by a
 *    tempo prior centred on 120 BPM, then refine the period with sub-frame
 *    interpolation on the 4-beat (1 bar) peak for ~0.1 BPM precision.
 * 4. Find the beat-grid phase as the peak of an onset histogram folded over one beat.
 * 5. Estimate which beat is the bar downbeat from where the strongest low-end hits fall.
 *
 * Precision matters: a 1 BPM error drifts a 8-bar blend by ~1/4 beat, which is an
 * audible flam, so BPM is returned with two decimals rather than rounded.
 */

export interface BpmAnalysisResult {
  bpm: number;
  confidence: number; // 0.0 to 1.0
  isRegularBeat: boolean;
  firstDownbeatTime: number; // Time of the first estimated bar downbeat (beat "1"), within the first bar
}

const NO_BEAT: BpmAnalysisResult = { bpm: 128, confidence: 0.1, isRegularBeat: false, firstDownbeatTime: 0 };

export function detectBpmFromBuffer(buffer: AudioBuffer): BpmAnalysisResult {
  try {
    const sampleRate = buffer.sampleRate;
    const channelData = buffer.getChannelData(0);
    // Analyse up to 60 s from past the intro, where the groove is established
    const startOffsetSec = buffer.duration > 70 ? 20 : 0;
    const startSample = Math.floor(startOffsetSec * sampleRate);
    const numSamples = Math.min(Math.floor(Math.min(60, buffer.duration) * sampleRate), channelData.length - startSample);

    // 1. One-pole low-pass at ~150 Hz + RMS envelope at 5 ms hops
    const hop = Math.max(1, Math.round(sampleRate * 0.005));
    const frameRate = sampleRate / hop;
    const numFrames = Math.floor(numSamples / hop);
    if (numFrames < frameRate * 8) return NO_BEAT; // under 8 s of audio

    const alpha = 1 - Math.exp((-2 * Math.PI * 150) / sampleRate);
    const envelope = new Float32Array(numFrames);
    let lp = 0;
    let peakEnvelope = 0;
    for (let f = 0; f < numFrames; f++) {
      let sumSq = 0;
      const base = startSample + f * hop;
      for (let i = 0; i < hop; i++) {
        lp += alpha * (channelData[base + i] - lp);
        sumSq += lp * lp;
      }
      envelope[f] = Math.sqrt(sumSq / hop);
      if (envelope[f] > peakEnvelope) peakEnvelope = envelope[f];
    }
    if (peakEnvelope < 0.001) return NO_BEAT; // silence

    // 2. Onset strength: half-wave rectified rise in log-compressed energy
    const onset = new Float32Array(numFrames);
    let onsetMean = 0;
    let prevLog = Math.log1p((100 * envelope[0]) / peakEnvelope);
    for (let f = 1; f < numFrames; f++) {
      const curLog = Math.log1p((100 * envelope[f]) / peakEnvelope);
      onset[f] = Math.max(0, curLog - prevLog);
      onsetMean += onset[f];
      prevLog = curLog;
    }
    onsetMean /= numFrames;
    // Light smoothing (~15 ms) so a beat period that falls between two frames still
    // correlates fully; raw one-frame spikes made fast tempos lose to their half-time
    const smooth = new Float32Array(numFrames);
    for (let f = 1; f < numFrames - 1; f++) {
      smooth[f] = 0.25 * onset[f - 1] + 0.5 * onset[f] + 0.25 * onset[f + 1] - onsetMean;
    }
    const centered = smooth;

    // 3. Autocorrelation up to 4 beat periods (for bar-level refinement)
    const minLag = Math.floor((frameRate * 60) / 180);
    const maxLag = Math.ceil((frameRate * 60) / 70);
    const acLength = 4 * maxLag + 3;
    const ac = new Float32Array(acLength);
    for (let lag = 0; lag < acLength; lag++) {
      let sum = 0;
      for (let f = 0; f + lag < numFrames; f++) sum += centered[f] * centered[f + lag];
      ac[lag] = sum / (numFrames - lag);
    }
    if (ac[0] <= 0) return NO_BEAT;

    // Score each candidate beat period; a real beat also repeats at 2x the period.
    // The log-normal prior around 120 BPM resolves half/double-time ambiguity.
    let bestLag = minLag;
    let bestScore = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
      const bpm = (60 * frameRate) / lag;
      const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
      const score = (ac[lag] + 0.5 * ac[2 * lag]) * prior;
      if (score > bestScore) {
        bestScore = score;
        bestLag = lag;
      }
    }

    // Refine: locate the bar peak (4 beats) and interpolate it to sub-frame precision
    const refinedPeak = (approx: number) => {
      let l = Math.round(approx);
      for (let d = -2; d <= 2; d++) {
        const c = Math.round(approx) + d;
        if (c > 0 && c < acLength - 1 && ac[c] > ac[l]) l = c;
      }
      const a = ac[l - 1];
      const b = ac[l];
      const c = ac[l + 1];
      const denom = a - 2 * b + c;
      return denom < 0 ? l + (0.5 * (a - c)) / denom : l;
    };
    const beatLag = refinedPeak(bestLag);
    const barLag = refinedPeak(4 * beatLag);
    const periodFrames = Math.abs(barLag / 4 - beatLag) < 0.5 ? barLag / 4 : beatLag;
    const beatSeconds = periodFrames / frameRate;
    const bpm = Math.round((60 / beatSeconds) * 100) / 100;

    // Confidence: how strongly the onsets repeat at the beat period (normalised autocorrelation)
    const periodicity = Math.max(0, ac[Math.round(beatLag)]) / ac[0];
    const confidence = Math.min(1, periodicity / 0.3);

    // 4. Beat phase: fold onset strength into a histogram over one beat and take its peak.
    // The peak (most common attack position) is robust to off-beat hits, which pull an average.
    const bins = Math.max(8, Math.round(periodFrames));
    const histogram = new Float32Array(bins);
    for (let f = 1; f < numFrames; f++) {
      if (onset[f] <= 0) continue;
      const t = startOffsetSec + (f - 0.5) / frameRate; // rise happened between frames f-1 and f
      histogram[Math.floor(((t % beatSeconds) / beatSeconds) * bins) % bins] += onset[f];
    }
    const at = (i: number) => histogram[(i + bins) % bins];
    let peakBin = 0;
    for (let i = 1; i < bins; i++) {
      if (at(i - 1) + 2 * at(i) + at(i + 1) > at(peakBin - 1) + 2 * at(peakBin) + at(peakBin + 1)) peakBin = i;
    }
    const pa = at(peakBin - 1);
    const pb = at(peakBin);
    const pc = at(peakBin + 1);
    const pDenom = pa - 2 * pb + pc;
    const binOffset = pDenom < 0 ? (0.5 * (pa - pc)) / pDenom : 0;
    let phase = ((peakBin + 0.5 + binOffset) / bins) * beatSeconds;
    phase = ((phase % beatSeconds) + beatSeconds) % beatSeconds;

    // 5. Bar downbeat ("the one"): the beat position (mod 4) with the strongest low-end
    // attacks. Kick and bass changes usually land on beat 1. If no position clearly wins
    // (e.g. an even four-on-the-floor), keep the first beat.
    const barStrength = [0, 0, 0, 0];
    for (let m = 0; ; m++) {
      const f = Math.round((phase + m * beatSeconds - startOffsetSec) * frameRate + 0.5);
      if (f >= numFrames - 1) break;
      if (f < 1) continue;
      barStrength[m % 4] += Math.max(onset[f - 1], onset[f], onset[f + 1]);
    }
    const sortedStrength = [...barStrength].sort((a, b) => b - a);
    const strongest = barStrength.indexOf(sortedStrength[0]);
    const barOffset = sortedStrength[0] > sortedStrength[1] * 1.08 ? strongest : 0;
    const downbeat = phase + barOffset * beatSeconds;

    return {
      bpm,
      confidence: Number(confidence.toFixed(2)),
      isRegularBeat: confidence >= 0.65,
      firstDownbeatTime: Number(downbeat.toFixed(3)),
    };
  } catch (err) {
    console.warn('BPM detection error:', err);
    return { ...NO_BEAT, confidence: 0.3 };
  }
}
