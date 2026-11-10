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
 * Gap: when the outgoing song stops dead after a high point (a fraction of a second to a few
 * seconds of silence before it comes back), that silence is an exit of its own: the old song
 * plays into its stop and the new song comes in on the beat where the old one would have come
 * back, with no overlap at all. It works whatever the tempos and keys.
 *
 * Pair: the exit and the entry are chosen together, so the stretches that overlap in the blend
 * don't both carry vocals (two singers at once is the clearest sign of a bad mix). When every
 * pair still has both singing (`vocalClash`), the mixer doesn't force a blend: it cuts quickly.
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
  hookTimes?: number[]; // every hook (each chorus, a drop): an exit never fades out over one
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
  gap?: boolean; // an exit into the silence after a high point: a cut, no blend
  low?: boolean; // the song is in a low part (verse, breakdown, intro, outro) at this point, not a high one
}

// Pairs where both songs sing during the blend lose this much (an 8-bar phrase start is worth 1).
// On 24 real song pairs it halved the blends with two vocals at once (10 -> 5); higher removed
// no more (the rest had vocals in every candidate window) and cost more phrase/energy score.
const VOCAL_OVERLAP_PENALTY = 3;

// Both sides at least ~0.7 vocal over the blend (0.7 × 0.7): two singers or two leads at once.
// A blend would only muddy both, so the mixer cuts quickly instead (MIXING_RULES.md rule 8).
const VOCAL_CLASH_LEVEL = 0.5;
const ENTRY_MIN_LEVEL = 0.25; // an entry's first 2 bars are at least this share of the song's loud level (no silent fade-in)

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
  exitTime: number; // outgoing song position where the blend starts (a bar start), or where the new song cuts in after a gap
  style: 'blend' | 'gap'; // 'gap': cut into the silence after a high point (see the top of this file)
  entryTime: number; // incoming song position it starts from (a bar start)
  reason: string; // short human explanation for the status line
  // The best rule-abiding alternatives (best first), for the AI DJ to choose between
  exitOptions: MixOption[];
  entryOptions: MixOption[];
}

// A gap: quieter than GAP_LEVEL × the song's average loudness for GAP_MIN–GAP_MAX seconds, right
// after 2 bars at least as loud as its average (a high point), with the music coming back after
const GAP_LEVEL = 0.15;
const GAP_MIN_SECONDS = 0.3;
const GAP_MAX_SECONDS = 4;
const HEARD_GAP_SECONDS = 1.2; // a stop of a beat or two is kept (a DJ uses it); a longer pause in the old song isn't waited out: the new song drops in as it starts
// A gap exit is worth more than an 8-bar phrase start (1) plus a drop into a calmer section:
// a stop after a high point is the cleanest place there is to change songs
const GAP_SCORE = 2.5;
// Quieter than this × the song's mean level for the rest of the song: its fade-out
const FADE_LEVEL = 0.5;
// A high part (chorus, drop): bars at least HIGH_PART × the song's loud level, which is the
// LOUD_PERCENTILE of its bar levels (its choruses). The rhythm layer uses the same idea (§3).
const HIGH_PART = 0.85;
const LOUD_PERCENTILE = 0.9;
// The Mix button looks LOOKAHEAD seconds ahead; when the old song is in a high part all that time,
// the exit may be up to this far ahead, where the high part ends
const HIGH_PART_EXTEND_SECONDS = 90;
// Leaving right as a high part ends, into a low part, is the classic exit
const END_OF_HIGH_BONUS = 1;

/** The song's loud level: the LOUD_PERCENTILE of its bar averages (from the music start). */
export function loudLevel(song: MixSongInfo, bar: number): number {
  const { full, rate } = song.profile;
  const bars: number[] = [];
  for (let t = Math.max(song.musicStartTime ?? 0, song.downbeat); t + bar <= song.duration; t += bar) bars.push(average(full, rate, t, t + bar));
  if (!bars.length) return songMean(full) || 1;
  bars.sort((a, b) => a - b);
  return bars[Math.min(bars.length - 1, Math.floor(LOUD_PERCENTILE * bars.length))] || 1;
}

/**
 * Where the song's music ends: the end of the last bar averaging at least FADE_LEVEL × its mean
 * level. Everything after is a fade-out or silence.
 */
export function lastLoudTime(song: MixSongInfo, bar: number): number {
  const { full, rate } = song.profile;
  const mean = songMean(full) || 1;
  for (let t = song.duration; t > bar; t -= 0.25) {
    if (average(full, rate, t - bar, t) >= FADE_LEVEL * mean) return t;
  }
  return song.duration;
}

/**
 * Silences after a high point that start in [from, to] (song seconds): where each starts and
 * where the music comes back.
 */
export function findGaps(song: MixSongInfo, from: number, to: number): Array<{ start: number; end: number }> {
  const { full, rate } = song.profile;
  const mean = songMean(full) || 1;
  const bar = 240 / song.bpm;
  const quiet = (i: number) => full[i] < GAP_LEVEL * mean;
  const gaps: Array<{ start: number; end: number }> = [];
  const last = Math.min(full.length - 1, Math.ceil(to * rate));
  for (let i = Math.max(1, Math.floor(from * rate)); i <= last; i++) {
    if (!quiet(i) || quiet(i - 1)) continue;
    let j = i;
    while (j < full.length && quiet(j)) j++;
    const start = i / rate;
    const end = j / rate;
    const length = end - start;
    const comesBack = j < full.length && average(full, rate, end, end + bar) >= 0.5 * mean;
    const highPoint = average(full, rate, start - 2 * bar, start) >= mean;
    if (length >= GAP_MIN_SECONDS && length <= GAP_MAX_SECONDS && comesBack && highPoint) gaps.push({ start, end });
    i = j;
  }
  return gaps;
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
  latestExit?: number; // Best Parts play limit: the old song is half faded by this (outgoing song seconds)
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
  const exitFrom = outPosition + params.minLeadSeconds;
  // Hard limit (Best Parts): no exit, not even the high-part or gap search, may start after the
  // point where half the blend would run past it; at least the next bar stays possible
  const hardLimit = params.latestExit !== undefined ? Math.max(params.latestExit - outBlend / 2, exitFrom + outBar) : Infinity;
  const exitLatest = Math.min(outPosition + params.lookAheadSeconds, out.duration - outBlend - 0.5, hardLimit);
  let exits = barStarts(out, Math.max(exitFrom, params.earliestExit ?? 0), exitLatest);
  // The window may have closed (e.g. no song was ready in time): then the next good bar from here
  if (exits.length === 0 && params.earliestExit !== undefined && outPosition >= params.earliestExit) {
    exits = barStarts(out, exitFrom, exitLatest);
  }

  // Never wait into the old song's fade-out: the old song is still playing for at least the first
  // half of the mix, so an exit starts a bar (or half the blend) before its music ends. One a bar
  // after it left seconds of silence (QA: Despacito ended 1.5 s before a mix began)
  const musicEnd = lastLoudTime(out, outBar);
  const beforeFade = exits.filter((c) => c.time <= musicEnd - Math.max(outBar, outBlend / 2));
  exits = beforeFade.length ? beforeFade : exits.slice(0, 1);

  const outHooks = out.hookTimes ?? (out.hookTime !== undefined ? [out.hookTime] : []);
  // High parts: never leave in the middle of one, or just as one begins (MIXING_RULES.md "Never
  // in a high part"). If the whole window is high, look further ahead for where it ends.
  const outLoud = loudLevel(out, outBar);
  const outAvg = (from: number, to: number) => average(out.profile.full, out.profile.rate, from, to);
  const outHigh = (from: number, to: number) => outAvg(from, to) >= HIGH_PART * outLoud;
  const inHighPart = (t: number) => {
    if (outHigh(t - outBar, t) && outHigh(t, t + outBar)) return true; // in the middle of one
    const firstHalf = Math.max(outBar, outBlend / 2);
    for (let b = t; b < t + firstHalf; b += outBar) if (outHigh(b, b + outBar)) return true; // one starts in the mix
    return false;
  };
  let allowed = exits.filter((c) => !inHighPart(c.time));
  if (!allowed.length && exits.length) {
    const further = barStarts(out, exits[0].time, Math.min(outPosition + HIGH_PART_EXTEND_SECONDS, out.duration - outBlend - 0.5, musicEnd - Math.max(outBar, outBlend / 2), hardLimit));
    allowed = further.filter((c) => !inHighPart(c.time));
  }
  if (allowed.length) exits = allowed;

  const exitOptions: MixOption[] = [];
  for (const candidate of exits) {
    const t = candidate.time;
    const avg = outAvg;
    const before = avg(t - 2 * outBar, t);
    const after = avg(t, t + 2 * outBar);
    const sectionChange = Math.abs(after - before) / (Math.max(before, after) || 1);
    const calm = Math.max(-1, Math.min(1, 1 - avg(t, t + outBlend) / outMean));
    const vocals = average(out.profile.mid, out.profile.rate, t, t + outBlend) / outMidMean;
    const overHook = outHooks.some((h) => h > t - 4 && h < t + outBlend);
    const low = !outHigh(t, t + Math.max(outBar, Math.min(outBlend, 2 * outBar)));
    const endOfHigh = low && outHigh(t - 2 * outBar, t);

    // Dropping into a calmer section (breakdown, outro) is the classic exit; entering a mix
    // when the song is rising back up or getting louder throws away the new buildup and sounds awkward
    const isRising = after > before * 1.08;
    const changeWeight = after < before ? 1.8 : isRising ? -2.5 : 0;

    const score =
      phraseBonus(candidate.index) +
      changeWeight * sectionChange +
      0.5 * calm -
      0.5 * Math.max(0, vocals - 1) -
      (overHook ? 1.5 : 0) +
      (endOfHigh ? END_OF_HIGH_BONUS : 0) -
      0.01 * (t - outPosition); // Scaled for up to 45s lookahead window per MIXING_RULES.md
    const why =
      (endOfHigh
        ? "current song's high part just ended"
        : sectionChange > 0.3
        ? after < before
          ? 'current song drops into a calmer section'
          : 'current song starts rising towards high'
        : phraseBonus(candidate.index) === 1
          ? 'start of an 8-bar phrase'
          : phraseBonus(candidate.index) > 0
            ? 'start of a 4-bar phrase'
            : 'bar boundary') + (vocals > 1.2 ? ', vocal-heavy' : vocals < 0.8 ? ', few vocals' : '');
    exitOptions.push({ time: t, why, score, vocals: vocalActivity(out.profile, t, t + outBlend, outShare), low });
  }

  // Gaps: the new song cuts in on the beat where the old one would come back, or, when the old
  // song's pause is long, on the first beat of it: more than HEARD_GAP_SECONDS of silence is dead
  // air on a dance floor (QA: 1.75 s after Blinding Lights stopped)
  const beat = 60 / out.bpm;
  for (const gap of findGaps(out, Math.max(exitFrom, params.earliestExit ?? 0) - 0.5, Math.min(outPosition + params.lookAheadSeconds, out.duration - 1, hardLimit + outBar))) {
    const long = gap.end - gap.start > HEARD_GAP_SECONDS;
    const t = long
      ? out.downbeat + Math.ceil((gap.start - out.downbeat) / beat - 0.05) * beat
      : out.downbeat + Math.round((gap.end - out.downbeat) / beat) * beat;
    if ((long ? t < gap.start - 0.05 : t <= gap.start) || t < exitFrom || t > musicEnd + outBar || t > hardLimit) continue;
    // A stop right before a chorus is a build-up to it: the crowd is waiting for that chorus
    if (outHooks.some((h) => h >= gap.start && h < Math.max(t, gap.end) + 2 * outBar)) continue;
    const score = GAP_SCORE - 0.01 * (t - outPosition);
    const why = long
      ? `current song stops after a high point: the new song drops in the moment it stops (no ${(gap.end - gap.start).toFixed(1)} s of silence)`
      : `current song stops after a high point (${(gap.end - gap.start).toFixed(1)} s of silence): the new song comes in where it would come back`;
    exitOptions.push({ time: t, why, score, vocals: 0, gap: true, low: true });
  }
  if (exitOptions.length === 0) return null;

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
  const incLoud = loudLevel(inc, incBar);
  // Never on a near-silent fade-in: the new song is heard from its first bars (QA: Titanium came
  // in at -70 dB while the old song had ended: 3 s of silence)
  const audible = (t: number) => average(inc.profile.full, inc.profile.rate, t, t + 2 * incBar) >= ENTRY_MIN_LEVEL * incLoud;
  const entryOptions: MixOption[] = [];
  for (const candidate of entries) {
    const e = candidate.time;
    if (!isStrict && !audible(e)) continue;
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
    const low = avg(e, e + Math.max(incBar, Math.min(incBlend, 2 * incBar))) < HIGH_PART * incLoud;
    entryOptions.push({ time: e, why, score, vocals: vocalActivity(inc.profile, e, e + incBlend, incShare), low });
  }
  if (isStrict) {
    entryOptions.length = 0;
    entryOptions.push({ time: 0, why: 'strictly from the beginning (0:00) as requested', score: 10 });
  } else if (entryOptions.length === 0) {
    // The whole window is a quiet fade-in: the first bar it can be heard from (before the hook)
    const hookLimit = inc.hookTime !== undefined ? inc.hookTime - 4 * incBar : inc.duration * 0.4;
    const firstAudible = barStarts(inc, entryFirst, Math.max(entryFirst, hookLimit)).find((c) => audible(c.time))?.time ?? entryFirst;
    entryOptions.push({ time: firstAudible, why: range ? 'at the build-up to its hook (best part)' : 'from the music start (full build-up)', score: 0 });
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
    style: best.exit.gap ? 'gap' : 'blend',
    reason: `${best.exit.why}; new song enters ${best.entry.why}${vocalNote}`,
    exitOptions: bestExits,
    entryOptions: bestEntries,
  };
}

/** Whether the plan's chosen exit and entry both carry strong vocals or leads over the blend. */
export function vocalClash(plan: Pick<MixPlan, 'exitTime' | 'entryTime' | 'exitOptions' | 'entryOptions'>): boolean {
  const at = (options: MixOption[], t: number) => options.find((o) => Math.abs(o.time - t) < 0.01);
  const exit = at(plan.exitOptions, plan.exitTime);
  const entry = at(plan.entryOptions, plan.entryTime);
  if (!exit || !entry || exit.gap) return false;
  return (exit.vocals ?? 0) * (entry.vocals ?? 0) >= VOCAL_CLASH_LEVEL;
}

/** Whether the plan's chosen exit and entry are in each song's low part (see MixOption.low). */
export function lowParts(plan: Pick<MixPlan, 'exitTime' | 'entryTime' | 'exitOptions' | 'entryOptions'>): { exit: boolean; entry: boolean } {
  const at = (options: MixOption[], t: number) => options.find((o) => Math.abs(o.time - t) < 0.01);
  return { exit: !!at(plan.exitOptions, plan.exitTime)?.low, entry: !!at(plan.entryOptions, plan.entryTime)?.low };
}
