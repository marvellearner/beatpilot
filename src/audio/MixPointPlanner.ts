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
 * Pair: the exit and the entry are chosen together, so the stretches that overlap in the blend
 * don't both carry vocals (two singers at once is the clearest sign of a bad mix).
 *
 * Best Parts mode (MIXING_RULES.md "Best Parts Mode") narrows both: the exit comes no earlier
 * than `earliestExit` (after the outgoing hook has played) and the entry lies in `entryRange`
 * (the build-up just before the incoming hook) instead of the intro.
 *
 * All times are in each song's own seconds. Rules: DJ_KNOWLEDGE_AND_MIXING_RULES.md §5, §7.
 */

import { isStrictStartSong } from './songMatch';

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
  title?: string;
  artist?: string;
  isStrictStart?: boolean;
}

export interface MixOption {
  time: number;
  why: string;
  score: number;
  vocals?: number; // 0 = instrumental, 1 = vocal-heavy, over the blend window (see vocalActivity)
}

// Pairs where both songs sing during the blend lose this much (an 8-bar phrase start is worth 1).
// On 24 real song pairs it halved the blends with two vocals at once (10 -> 5); higher removed
// no more (the rest had vocals in every candidate window) and cost more phrase/energy score.
const VOCAL_OVERLAP_PENALTY = 3;

/**
 * Vocal activity over [from, to]: the 300 Hz–3 kHz band's share of the loudness there, relative
 * to the song's own average share, mapped to 0 (clearly below: instrumental, breakdown, drums)
 * … 1 (well above: vocals or a lead on top). Relative to the song's share rather than its level,
 * so a loud chorus without singing doesn't count as vocal.
 */
function vocalActivity(profile: EnergyProfile, from: number, to: number, songShare: number): number {
  const full = average(profile.full, profile.rate, from, to);
  if (full <= 0) return 0;
  const share = average(profile.mid, profile.rate, from, to) / full / (songShare || 1);
  return Math.max(0, Math.min(1, (share - 0.85) / 0.35));
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
  earliestExit?: number; // Best Parts: don't leave before this (outgoing song seconds)
  entryRange?: { from: number; to: number }; // Best Parts: enter in this build-up (incoming song seconds)
}): MixPlan | null {
  const { out, inc, outPosition, blendBeats } = params;
  const outBlend = (blendBeats * 60) / out.bpm;
  const incBlend = (blendBeats * 60) / inc.bpm;
  const outBar = (4 * 60) / out.bpm;
  const incBar = (4 * 60) / inc.bpm;

  // --- Exit point in the outgoing song ---
  const outMean = songMean(out.profile.full) || 1;
  const outMidMean = songMean(out.profile.mid) || 1;
  const outShare = outMidMean / outMean;
  const exitLatest = Math.min(outPosition + params.lookAheadSeconds, out.duration - outBlend - 0.5);
  const exitFrom = outPosition + params.minLeadSeconds;
  let exits = barStarts(out, Math.max(exitFrom, params.earliestExit ?? 0), exitLatest);
  // The window may have closed (e.g. no song was ready in time): then the next good bar from here
  if (exits.length === 0 && params.earliestExit !== undefined) exits = barStarts(out, exitFrom, exitLatest);
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
      0.01 * (t - outPosition); // Scaled for up to 45s lookahead window per MIXING_RULES.md
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
    exitOptions.push({ time: t, why, score, vocals: vocalActivity(out.profile, t, t + outBlend, outShare) });
  }

  // --- Entry point in the incoming song ---
  const incMean = songMean(inc.profile.full) || 1;
  const incMidMean = songMean(inc.profile.mid) || 1;
  const incShare = incMidMean / incMean;
  const isStrict = isStrictStartSong(inc) || inc.isStrictStart === true;
  const minEntry = isStrict ? 0 : (inc.musicStartTime && inc.musicStartTime > 0 ? inc.musicStartTime : 0);
  const range = isStrict ? { from: 0, to: 0 } : params.entryRange;
  // Never start from hook because build up is also important!
  // Entry point must stay within the intro/build-up (first 4-8 bars of music start),
  // or in Best Parts mode within the build-up before the hook (the range already stops short of it)
  const maxIntroLimit = inc.hookTime ? Math.max(minEntry, inc.hookTime - 20) : minEntry + 16 * incBar;
  const entryFirst = range ? Math.max(minEntry, range.from) : minEntry;
  const entryLatest = range ? Math.min(range.to, inc.duration - incBlend - 1) : Math.min(minEntry + 8 * incBar, maxIntroLimit, inc.duration * 0.25);
  const entries = barStarts(inc, entryFirst, Math.max(entryFirst, entryLatest));
  const entryOptions: MixOption[] = [];
  for (const candidate of entries) {
    const e = candidate.time;
    // Don't start at or near the hook - the natural musical buildup must be preserved
    if (!range && inc.hookTime && e >= inc.hookTime - 8) continue;
    // Best Parts: the blend should be over when the hook hits, so it isn't heard under the old song
    const hookInBlend = range && inc.hookTime !== undefined && e + incBlend > inc.hookTime;
    const avg = (from: number, to: number) => average(inc.profile.full, inc.profile.rate, from, to);
    const during = avg(e, e + incBlend);
    const afterBlend = avg(e + incBlend, e + incBlend + 2 * incBar);
    const dropAtEnd = Math.max(0, (afterBlend - during) / incMean);
    const calm = Math.max(-1, Math.min(1, 1 - during / incMean));
    const vocals = average(inc.profile.mid, inc.profile.rate, e, e + incBlend) / incMidMean;

    const score =
      phraseBonus(candidate.index) +
      1.5 * dropAtEnd +
      0.5 * calm -
      0.5 * Math.max(0, vocals - 1) -
      (hookInBlend ? 1.5 : 0) -
      0.005 * e;
    const why = range && inc.hookTime !== undefined
      ? `${Math.round((inc.hookTime - e) / incBar)} bars before its hook (best part)`
      : calm > 0.2
        ? 'on a calm intro phrase (allowing build-up)'
        : dropAtEnd > 0.3
          ? 'on an intro rise'
          : 'on a phrase start (intro build-up)';
    entryOptions.push({ time: e, why, score, vocals: vocalActivity(inc.profile, e, e + incBlend, incShare) });
  }
  if (isStrict) {
    entryOptions.length = 0;
    entryOptions.push({ time: 0, why: 'strictly from the beginning (0:00) as requested', score: 10 });
  } else if (entryOptions.length === 0) {
    entryOptions.push({ time: entryFirst, why: range ? 'at the build-up to its hook (best part)' : 'from the music start (full build-up)', score: 0 });
  }

  // Best pair: each side's own score, minus the penalty when both sing during the blend
  let best = { exit: exitOptions[0], entry: entryOptions[0], total: -Infinity };
  for (const x of exitOptions) {
    for (const n of entryOptions) {
      const total = x.score + n.score - VOCAL_OVERLAP_PENALTY * (x.vocals ?? 0) * (n.vocals ?? 0);
      if (total > best.total) best = { exit: x, entry: n, total };
    }
  }
  // The chosen pair first, then the best alternatives (for the AI DJ to choose from)
  const withFirst = (first: MixOption, all: MixOption[]) => [first, ...topOptions(all.filter((o) => o !== first), 2)];
  const bestExits = withFirst(best.exit, exitOptions);
  const bestEntries = withFirst(best.entry, entryOptions);
  const naive = (topOptions(exitOptions, 1)[0].vocals ?? 0) * (topOptions(entryOptions, 1)[0].vocals ?? 0);
  const overlap = (best.exit.vocals ?? 0) * (best.entry.vocals ?? 0);
  const vocalNote = naive > 0.25 && overlap < naive ? '; chosen so the two vocals don\'t overlap' : '';
  return {
    exitTime: best.exit.time,
    entryTime: best.entry.time,
    reason: `${best.exit.why}; new song enters ${best.entry.why}${vocalNote}`,
    exitOptions: bestExits,
    entryOptions: bestEntries,
  };
}
