/**
 * MixPointPlanner — decides WHERE to blend two songs instead of mixing immediately.
 *
 * Exit (outgoing song): scans bar starts in the look-ahead window and prefers phrase
 * starts (every 8 / 4 bars), section changes (energy jumps such as a breakdown or
 * outro starting), calm and vocal-light stretches, and never fades out over its hook.
 *
 * Entry (incoming song): scans bar starts in its first part and prefers phrase starts
 * with a calm, vocal-light intro, timed so the energy rise (drop / hook) lands right
 * when the blend finishes.
 *
 * All times are in each song's own seconds. Rules: DJ_KNOWLEDGE_AND_MIXING_RULES.md §5, §7.
 */

export interface EnergyProfile {
  rate: number; // frames per second
  full: Float32Array; // overall RMS loudness
  mid: Float32Array; // 300 Hz – 3 kHz RMS, a rough proxy for vocals and leads
}

export interface MixSongInfo {
  profile: EnergyProfile;
  bpm: number; // natural BPM of the song
  downbeat: number; // time of a bar downbeat ("1")
  duration: number;
  hookTime?: number;
  musicStartTime?: number; // point where music starts, skipping conversation/skit
}

export interface MixOption {
  time: number;
  why: string;
  score: number;
}

export interface MixPlan {
  exitTime: number; // outgoing song position where the blend starts (a bar start)
  entryTime: number; // incoming song position it starts from (a bar start)
  reason: string; // short human explanation for the status line
  // The best rule-abiding alternatives (best first), for the AI DJ to choose between
  exitOptions: MixOption[];
  entryOptions: MixOption[];
}

/** Top `count` options, dropping any scoring far below the best (those break the rules). */
function topOptions(options: MixOption[], count: number): MixOption[] {
  const sorted = [...options].sort((a, b) => b.score - a.score);
  const floor = (sorted[0]?.score ?? 0) - 1;
  return sorted.filter((o) => o.score >= floor).slice(0, count);
}

const PROFILE_RATE = 10;

/** Loudness and mid-band (vocal-ish) envelopes at 10 frames/s for the whole song. */
export function computeEnergyProfile(buffer: AudioBuffer): EnergyProfile {
  const sampleRate = buffer.sampleRate;
  const data = buffer.getChannelData(0);
  const hop = Math.floor(sampleRate / PROFILE_RATE);
  const frames = Math.floor(data.length / hop);
  const full = new Float32Array(frames);
  const mid = new Float32Array(frames);
  // Band-pass 300 Hz – 3 kHz as a one-pole high-pass followed by a one-pole low-pass
  const hpAlpha = Math.exp((-2 * Math.PI * 300) / sampleRate);
  const lpAlpha = 1 - Math.exp((-2 * Math.PI * 3000) / sampleRate);
  let hpPrevIn = 0;
  let hpOut = 0;
  let lpOut = 0;
  for (let f = 0; f < frames; f++) {
    let sumFull = 0;
    let sumMid = 0;
    const base = f * hop;
    for (let i = 0; i < hop; i += 2) {
      const x = data[base + i];
      hpOut = hpAlpha * (hpOut + x - hpPrevIn);
      hpPrevIn = x;
      lpOut += lpAlpha * (hpOut - lpOut);
      sumFull += x * x;
      sumMid += lpOut * lpOut;
    }
    full[f] = Math.sqrt(sumFull / (hop / 2));
    mid[f] = Math.sqrt(sumMid / (hop / 2));
  }
  return { rate: PROFILE_RATE, full, mid };
}

function average(values: Float32Array, rate: number, from: number, to: number): number {
  const a = Math.max(0, Math.floor(from * rate));
  const b = Math.min(values.length, Math.ceil(to * rate));
  if (b <= a) return 0;
  let sum = 0;
  for (let i = a; i < b; i++) sum += values[i];
  return sum / (b - a);
}

function songMean(values: Float32Array): number {
  let sum = 0;
  for (const v of values) sum += v;
  return values.length ? sum / values.length : 1;
}

/** Bar starts (song seconds) in [from, to], with their bar index counted from the downbeat. */
function barStarts(song: MixSongInfo, from: number, to: number) {
  const bar = (4 * 60) / song.bpm;
  const first = Math.ceil((from - song.downbeat) / bar);
  const result: Array<{ time: number; index: number }> = [];
  for (let k = Math.max(first, 0); song.downbeat + k * bar <= to; k++) {
    result.push({ time: song.downbeat + k * bar, index: k });
  }
  return result;
}

const phraseBonus = (barIndex: number) => (barIndex % 8 === 0 ? 1 : barIndex % 4 === 0 ? 0.5 : 0);

export function planMix(params: {
  out: MixSongInfo;
  inc: MixSongInfo;
  outPosition: number; // current outgoing position
  blendBeats: number; // 32 for a beatmatched blend, ~4 for a cut
  lookAheadSeconds: number; // how far ahead the exit may be (song seconds)
  minLeadSeconds: number; // earliest exit, so the mix can be scheduled precisely
  preferIncomingHook: boolean; // land the incoming hook at the end of the blend
}): MixPlan | null {
  const { out, inc, outPosition, blendBeats } = params;
  const outBlend = (blendBeats * 60) / out.bpm;
  const incBlend = (blendBeats * 60) / inc.bpm;
  const outBar = (4 * 60) / out.bpm;
  const incBar = (4 * 60) / inc.bpm;

  // --- Exit point in the outgoing song ---
  const outMean = songMean(out.profile.full) || 1;
  const outMidMean = songMean(out.profile.mid) || 1;
  const exitLatest = Math.min(outPosition + params.lookAheadSeconds, out.duration - outBlend - 0.5);
  const exits = barStarts(out, outPosition + params.minLeadSeconds, exitLatest);
  if (exits.length === 0) return null;

  const exitOptions: MixOption[] = [];
  for (const candidate of exits) {
    const t = candidate.time;
    const avg = (from: number, to: number) => average(out.profile.full, out.profile.rate, from, to);
    const before = avg(t - 2 * outBar, t);
    const after = avg(t, t + 2 * outBar);
    const sectionChange = Math.abs(after - before) / (Math.max(before, after) || 1);
    const calm = Math.max(-1, Math.min(1, 1 - avg(t, t + outBlend) / outMean));
    const vocals = average(out.profile.mid, out.profile.rate, t, t + outBlend) / outMidMean;
    const overHook = out.hookTime !== undefined && out.hookTime > t - 4 && out.hookTime < t + outBlend;

    // Dropping into a calmer section (breakdown, outro) is the classic exit; jumping into a
    // louder one (a chorus) is weaker since the blend would throw that chorus away
    const changeWeight = after < before ? 1.5 : 0.6;

    const score =
      phraseBonus(candidate.index) +
      changeWeight * sectionChange +
      0.5 * calm -
      0.5 * Math.max(0, vocals - 1) -
      (overHook ? 1.5 : 0) -
      0.02 * (t - outPosition);
    const why =
      (sectionChange > 0.3
        ? after < before
          ? 'current song drops into a calmer section'
          : 'current song gets louder (new section)'
        : phraseBonus(candidate.index) === 1
          ? 'start of an 8-bar phrase'
          : phraseBonus(candidate.index) > 0
            ? 'start of a 4-bar phrase'
            : 'bar boundary') + (vocals > 1.2 ? ', vocal-heavy' : vocals < 0.8 ? ', few vocals' : '');
    exitOptions.push({ time: t, why, score });
  }

  // --- Entry point in the incoming song ---
  const incMean = songMean(inc.profile.full) || 1;
  const incMidMean = songMean(inc.profile.mid) || 1;
  const minEntry = inc.musicStartTime && inc.musicStartTime > 0 ? inc.musicStartTime : 0;
  const entryLatest = Math.min(120, inc.duration * 0.6, inc.duration - incBlend - 30);
  const entries = barStarts(inc, minEntry, Math.max(minEntry, entryLatest));
  const entryOptions: MixOption[] = [];
  for (const candidate of entries) {
    const e = candidate.time;
    const avg = (from: number, to: number) => average(inc.profile.full, inc.profile.rate, from, to);
    const during = avg(e, e + incBlend);
    const afterBlend = avg(e + incBlend, e + incBlend + 2 * incBar);
    const dropAtEnd = Math.max(0, (afterBlend - during) / incMean);
    const calm = Math.max(-1, Math.min(1, 1 - during / incMean));
    const vocals = average(inc.profile.mid, inc.profile.rate, e, e + incBlend) / incMidMean;
    const hookFit =
      params.preferIncomingHook && inc.hookTime !== undefined
        ? Math.exp(-Math.abs(e + incBlend - inc.hookTime) / 4)
        : 0;

    const score =
      phraseBonus(candidate.index) +
      1.5 * dropAtEnd +
      0.5 * calm -
      0.5 * Math.max(0, vocals - 1) +
      hookFit -
      0.005 * e;
    const why =
      hookFit > 0.5
        ? 'timed so its hook lands as the blend ends'
        : dropAtEnd > 0.3
          ? 'timed so its drop lands as the blend ends'
          : calm > 0.2
            ? 'on a calm intro phrase'
            : 'on a phrase start';
    entryOptions.push({ time: e, why, score });
  }
  if (entryOptions.length === 0) entryOptions.push({ time: inc.downbeat, why: 'from the first beat', score: 0 });

  const bestExits = topOptions(exitOptions, 3);
  const bestEntries = topOptions(entryOptions, 3);
  return {
    exitTime: bestExits[0].time,
    entryTime: bestEntries[0].time,
    reason: `${bestExits[0].why}; new song enters ${bestEntries[0].why}`,
    exitOptions: bestExits,
    entryOptions: bestEntries,
  };
}
