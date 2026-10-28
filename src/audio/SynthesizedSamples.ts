/**
 * Procedural Audio & Percussion Buffer Generator
 * Generates authentic, high-fidelity rhythmic loops (Dhol, Bhangra, Drums)
 * and rich demo musical tracks so the prototype is 100% playable out of the box.
 */

export function createSynthesizedBuffer(
  ctx: AudioContext,
  patternId: string,
  bpm: number = 128
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const secondsPerBeat = 60 / bpm;
  // 4 bars of 4/4 time = 16 beats
  const totalBeats = 16;
  const totalDuration = secondsPerBeat * totalBeats;
  const numSamples = Math.floor(sampleRate * totalDuration);

  const buffer = ctx.createBuffer(2, numSamples, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  if (patternId === 'punjabi_dhol') {
    generatePunjabiDholLoop(left, right, sampleRate, secondsPerBeat, totalBeats);
  } else if (patternId === 'bhangra_groove') {
    generateBhangraGrooveLoop(left, right, sampleRate, secondsPerBeat, totalBeats);
  } else if (patternId === 'electronic_drums') {
    generateElectronicDrumLoop(left, right, sampleRate, secondsPerBeat, totalBeats);
  } else if (patternId === 'afrobeat') {
    generateAfrobeatLoop(left, right, sampleRate, secondsPerBeat, totalBeats);
  } else if (patternId === 'demo_track_a') {
    generateDemoTrack(left, right, sampleRate, bpm, 'anthem', 32);
  } else if (patternId === 'demo_track_b') {
    generateDemoTrack(left, right, sampleRate, bpm, 'banger', 32);
  }

  return buffer;
}

/**
 * Authentic Punjabi Dhol:
 * - Dagga: Heavy curved stick on bass skin (pitch envelope 110Hz -> 50Hz, deep punch)
 * - Thapi / Tilli: Sharp bamboo stick snap on treble skin (bandpass snap at 1.8kHz)
 */
function generatePunjabiDholLoop(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  spb: number,
  totalBeats: number
) {
  // 16th note interval
  const step = spb / 4;
  const totalSteps = totalBeats * 4;

  for (let s = 0; s < totalSteps; s++) {
    const time = s * step;
    const beatInBar = (s % 16) / 4;
    const stepInBeat = s % 4;

    // Traditional Dhol Chaap Pattern:
    // Dagga (Bass): On beats 0, 1.5, 2, 3 (Dha - Ge - Dha - Na)
    const isDagga =
      (beatInBar === 0 && stepInBeat === 0) ||
      (beatInBar === 1 && stepInBeat === 2) ||
      (beatInBar === 2 && stepInBeat === 0) ||
      (beatInBar === 3 && stepInBeat === 2);

    // Thapi (Treble crack): On 16th syncopations
    const isThapi =
      stepInBeat === 1 ||
      stepInBeat === 3 ||
      (beatInBar === 1 && stepInBeat === 0) ||
      (beatInBar === 3 && stepInBeat === 0);

    if (isDagga) {
      addDaggaHit(left, right, sampleRate, time, 0.85);
    }
    if (isThapi) {
      const accent = stepInBeat === 3 ? 0.65 : 0.45;
      addThapiHit(left, right, sampleRate, time, accent);
    }
  }
}

/**
 * Bhangra Groove Loop:
 * High-energy chimta accents + rolling dholak taps
 */
function generateBhangraGrooveLoop(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  spb: number,
  totalBeats: number
) {
  const step = spb / 4;
  const totalSteps = totalBeats * 4;

  for (let s = 0; s < totalSteps; s++) {
    const time = s * step;
    const stepInBeat = s % 4;
    const beat = Math.floor(s / 4) % 4;

    // Rolling bass hit
    if (beat === 0 && stepInBeat === 0) {
      addDaggaHit(left, right, sampleRate, time, 0.9);
    } else if (beat === 2 && stepInBeat === 0) {
      addDaggaHit(left, right, sampleRate, time, 0.8);
    } else if (beat === 3 && stepInBeat === 2) {
      addDaggaHit(left, right, sampleRate, time, 0.7);
    }

    // Chimta / Metallic snap
    if (stepInBeat === 2 || stepInBeat === 3) {
      addChimtaHit(left, right, sampleRate, time, 0.35);
    }

    // Mid dholak tap
    if (stepInBeat === 1 || (beat === 1 && stepInBeat === 2)) {
      addThapiHit(left, right, sampleRate, time, 0.5);
    }
  }
}

/**
 * Electronic Club Drums: 4-on-the-floor kick, clap on 2 & 4, 16th hats
 */
function generateElectronicDrumLoop(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  spb: number,
  totalBeats: number
) {
  const step = spb / 4;
  const totalSteps = totalBeats * 4;

  for (let s = 0; s < totalSteps; s++) {
    const time = s * step;
    const beat = Math.floor(s / 4) % 4;
    const stepInBeat = s % 4;

    // 4-on-the-floor Kick
    if (stepInBeat === 0) {
      addKickHit(left, right, sampleRate, time, 0.95);
    }

    // Snare / Clap on 2 and 4
    if ((beat === 1 || beat === 3) && stepInBeat === 0) {
      addClapHit(left, right, sampleRate, time, 0.75);
    }

    // Hi-hats
    const hatVolume = stepInBeat === 2 ? 0.45 : 0.25; // accented offbeat
    addHiHatHit(left, right, sampleRate, time, hatVolume);
  }
}

/**
 * Afrobeat Percussion: syncopated congas, shakers, woodblock
 */
function generateAfrobeatLoop(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  spb: number,
  totalBeats: number
) {
  const step = spb / 4;
  const totalSteps = totalBeats * 4;

  for (let s = 0; s < totalSteps; s++) {
    const time = s * step;
    const beat = Math.floor(s / 4) % 4;
    const stepInBeat = s % 4;

    if (s % 2 === 0) {
      addHiHatHit(left, right, sampleRate, time, 0.3);
    }
    if ((beat === 0 && stepInBeat === 0) || (beat === 2 && stepInBeat === 3)) {
      addKickHit(left, right, sampleRate, time, 0.8);
    }
    if ((beat === 1 && stepInBeat === 1) || (beat === 3 && stepInBeat === 2)) {
      addThapiHit(left, right, sampleRate, time, 0.6);
    }
  }
}

// --- Synthesized Percussion Component Hit Generators ---

function addDaggaHit(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  startTime: number,
  gain: number
) {
  const startSample = Math.floor(startTime * sampleRate);
  const duration = 0.28;
  const length = Math.floor(duration * sampleRate);

  for (let i = 0; i < length; i++) {
    const idx = startSample + i;
    if (idx >= left.length) break;

    const t = i / sampleRate;
    // Pitch drops from 120Hz to 45Hz
    const freq = 45 + 75 * Math.exp(-t * 18);
    // Exponential amplitude envelope
    const env = Math.exp(-t * 12);
    // Add sub-bass sine + slight 2nd harmonic saturation
    const osc = Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(4 * Math.PI * freq * t);
    const sample = Math.tanh(osc * 1.5) * env * gain * 0.9;

    left[idx] += sample;
    right[idx] += sample;
  }
}

function addThapiHit(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  startTime: number,
  gain: number
) {
  const startSample = Math.floor(startTime * sampleRate);
  const duration = 0.08;
  const length = Math.floor(duration * sampleRate);

  for (let i = 0; i < length; i++) {
    const idx = startSample + i;
    if (idx >= left.length) break;

    const t = i / sampleRate;
    const env = Math.exp(-t * 45);
    // Bandpassed noise + high tonal resonance (1800 Hz)
    const noise = (Math.random() * 2 - 1) * 0.7;
    const tonal = Math.sin(2 * Math.PI * 1850 * t) * 0.3;
    const sample = (noise + tonal) * env * gain;

    // Slight stereo widening
    left[idx] += sample * 0.95;
    right[idx] += sample * 1.05;
  }
}

function addChimtaHit(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  startTime: number,
  gain: number
) {
  const startSample = Math.floor(startTime * sampleRate);
  const duration = 0.09;
  const length = Math.floor(duration * sampleRate);

  for (let i = 0; i < length; i++) {
    const idx = startSample + i;
    if (idx >= left.length) break;

    const t = i / sampleRate;
    const env = Math.exp(-t * 30);
    // High metallic frequencies (3.2kHz, 4.8kHz, 6.5kHz)
    const bell =
      Math.sin(2 * Math.PI * 3200 * t) * 0.4 +
      Math.sin(2 * Math.PI * 4800 * t) * 0.3 +
      Math.sin(2 * Math.PI * 6500 * t) * 0.3;
    const sample = bell * env * gain;

    left[idx] += sample * 1.1;
    right[idx] += sample * 0.9;
  }
}

function addKickHit(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  startTime: number,
  gain: number
) {
  const startSample = Math.floor(startTime * sampleRate);
  const duration = 0.22;
  const length = Math.floor(duration * sampleRate);

  for (let i = 0; i < length; i++) {
    const idx = startSample + i;
    if (idx >= left.length) break;

    const t = i / sampleRate;
    const freq = 50 + 130 * Math.exp(-t * 32);
    const env = Math.exp(-t * 14);
    const sample = Math.sin(2 * Math.PI * freq * t) * env * gain;

    left[idx] += sample;
    right[idx] += sample;
  }
}

function addClapHit(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  startTime: number,
  gain: number
) {
  const startSample = Math.floor(startTime * sampleRate);
  const duration = 0.15;
  const length = Math.floor(duration * sampleRate);

  for (let i = 0; i < length; i++) {
    const idx = startSample + i;
    if (idx >= left.length) break;

    const t = i / sampleRate;
    // Multi-tap envelope for authentic handclap
    let env = Math.exp(-t * 22);
    if (t < 0.015) env *= 0.6;
    else if (t < 0.03) env *= 0.8;

    const noise = (Math.random() * 2 - 1) * 0.85;
    const sample = noise * env * gain;

    left[idx] += sample;
    right[idx] += sample;
  }
}

function addHiHatHit(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  startTime: number,
  gain: number
) {
  const startSample = Math.floor(startTime * sampleRate);
  const duration = 0.05;
  const length = Math.floor(duration * sampleRate);

  for (let i = 0; i < length; i++) {
    const idx = startSample + i;
    if (idx >= left.length) break;

    const t = i / sampleRate;
    const env = Math.exp(-t * 60);
    const noise = Math.random() * 2 - 1;
    const sample = noise * env * gain * 0.4;

    left[idx] += sample;
    right[idx] += sample;
  }
}

/**
 * Rich, melodic Demo Tracks for Deck A & B
 */
function generateDemoTrack(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  bpm: number,
  style: 'anthem' | 'banger',
  totalBeats: number
) {
  const spb = 60 / bpm;
  const length = Math.floor(totalBeats * spb * sampleRate);
  const notes = style === 'anthem' ? [55, 58, 62, 60] : [53, 57, 60, 58]; // A min or F maj bass

  for (let b = 0; b < totalBeats; b++) {
    const beatTime = b * spb;
    const noteMidi = notes[Math.floor(b / 4) % notes.length];
    const baseFreq = 440 * Math.pow(2, (noteMidi - 69) / 12);

    // Synth Bass
    const bassDuration = spb * 0.85;
    const bassLen = Math.floor(bassDuration * sampleRate);
    const startIdx = Math.floor(beatTime * sampleRate);

    for (let i = 0; i < bassLen; i++) {
      const idx = startIdx + i;
      if (idx >= left.length) break;
      const t = i / sampleRate;
      const env = Math.exp(-t * 4);
      // Sawtooth-like rich bass
      const saw =
        Math.sin(2 * Math.PI * (baseFreq / 2) * t) * 0.5 +
        Math.sin(2 * Math.PI * baseFreq * t) * 0.3 +
        Math.sin(2 * Math.PI * (baseFreq * 1.5) * t) * 0.15;
      const sample = Math.tanh(saw * 1.2) * env * 0.3;
      left[idx] += sample;
      right[idx] += sample;
    }

    // Groove Kick and Snare for the track
    addKickHit(left, right, sampleRate, beatTime, 0.7);
    if (b % 2 === 1) {
      addClapHit(left, right, sampleRate, beatTime, 0.5);
    }
  }

  // Normalize gently
  let peak = 0;
  for (let i = 0; i < length; i++) {
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  if (peak > 0.95) {
    const scale = 0.9 / peak;
    for (let i = 0; i < length; i++) {
      left[i] *= scale;
      right[i] *= scale;
    }
  }
}
