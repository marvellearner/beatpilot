// Transition QA: drives the running app (npm run dev) in headless Chrome, lets it mix N times
// (alternating the Mix button and an automatic mix at the song's end), records the master output
// around every mix, measures it, and has Music Flamingo listen to each clip (qa/musicFlamingo.mjs).
//
//   npm run qa:transitions -- --mixes 6            (default 6 mixes, Music Flamingo on)
//   npm run qa:transitions -- --no-flamingo        (measurements only, nothing leaves the laptop)
//   options: --url http://127.0.0.1:5173/  --headed  --before 10  --after 20
//
// Output in qa/out/<date-time>/: mix-01.wav … (mono 16 kHz), report.json and report.md.
// Uses the installed Chrome. Don't edit project files while it runs: Vite reloads the page.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewTransition } from './musicFlamingo.mjs';
import { beatOffset } from './beatPhase.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const MIXES = Number(opt('mixes', 6));
const URL_ = opt('url', 'http://127.0.0.1:5173/');
const FLAMINGO = !args.includes('--no-flamingo');
const BEFORE = Number(opt('before', 10)); // seconds of the old song in each clip, before the mix starts
const AFTER = Number(opt('after', 20)); // seconds after the mix starts (at least 6 s after it ends)
const MAX_CLIP = 60; // a 16-bar showcase blend at 96 BPM lasts 40 s

// --review qa/out/<run>: Music Flamingo listens again to a saved run's clips (no app needed)
const REVIEW_DIR = opt('review', null);
const root = REVIEW_DIR
  ? path.resolve(REVIEW_DIR)
  : path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
fs.mkdirSync(root, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = REVIEW_DIR
  ? JSON.parse(fs.readFileSync(path.join(root, 'report.json'), 'utf8'))
  : { started: new Date().toISOString(), url: URL_, flamingo: FLAMINGO, mixes: [], errors: [] };
const save = () => {
  fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(root, 'report.md'), markdown(report));
};

if (REVIEW_DIR) {
  for (const mix of report.mixes.filter((m) => m.clip)) {
    try {
      const { review: r, raw } = await reviewTransition(path.join(root, mix.clip.file), { mixAt: mix.clip.mixAt, mixSeconds: mix.transitionSeconds, from: mix.from?.title, to: mix.to?.title, style: mix.style });
      mix.flamingo = { ...(r ?? {}), raw: r ? undefined : raw.slice(0, 1500) };
      console.log(`🦩 #${mix.n}: ${r ? `score ${r.score}${r.abrupt ? ', ABRUPT' : ''} — ${r.verdict ?? ''}` : raw.slice(0, 120)}`);
    } catch (err) {
      mix.flamingo = { error: err.message };
      console.log(`🦩 #${mix.n}: ${err.message}`);
    }
    save();
  }
  report.summary = summarize(report.mixes);
  save();
  console.log(`\n${report.summary.text}\nReport: ${path.join(root, 'report.md')}`);
  process.exit(0);
}

const browser = await chromium.launch({ channel: 'chrome', headless: !args.includes('--headed'), args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => report.errors.push(e.message.slice(0, 200)));
page.on('console', (m) => m.type() === 'error' && report.errors.push('console: ' + m.text().slice(0, 200)));

try {
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.locator('#party-console-refresh-queue-btn').waitFor({ timeout: 60_000 });
  await sleep(6000);
  await page.evaluate(installProbe);
} catch (err) {
  console.error(`Could not open the app at ${URL_} (is "npm run dev" running?): ${err.message}`);
  await browser.close();
  process.exit(1);
}

const state = () => page.evaluate(() => window.__qa.state());
async function waitFor(fn, timeoutMs, stepMs = 250) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const s = await state();
    if (fn(s)) return s;
    await sleep(stepMs);
  }
  return null;
}

// Music Flamingo reviews run one at a time in the background while the next mixes play
let reviews = Promise.resolve();
const review = (mix, file) => {
  reviews = reviews.then(async () => {
    try {
      const t0 = Date.now();
      const { review: r, raw } = await reviewTransition(file, { mixAt: mix.clip.mixAt, mixSeconds: mix.transitionSeconds, from: mix.from.title, to: mix.to.title, style: mix.style });
      mix.flamingo = { ...(r ?? {}), raw: r ? undefined : raw.slice(0, 1500), seconds: Math.round((Date.now() - t0) / 1000) };
      console.log(`   🦩 #${mix.n}: ${r ? `score ${r.score}${r.abrupt ? ', ABRUPT' : ''} — ${r.verdict ?? ''}` : raw.slice(0, 120)}`);
    } catch (err) {
      mix.flamingo = { error: err.message };
      console.log(`   🦩 #${mix.n}: ${err.message}`);
    }
    save();
  });
};

let s = await waitFor((x) => x.ready > 0, 180_000, 1000);
if (!s) {
  report.fatal = 'no song ready in 3 min';
  save();
  await browser.close();
  process.exit(1);
}
if (!(await state()).playing) {
  await page.evaluate(() => window.__qa.engine.nextTrack());
  await waitFor((x) => x.playing, 60_000);
}
console.log(`Transition QA: ${MIXES} mixes${FLAMINGO ? ', Music Flamingo listening' : ''} → ${root}`);

for (let i = 1; i <= MIXES; i++) {
  await sleep(12_000); // a stretch of the song on air before each mix
  const before = await state();
  const mix = { n: i, path: i % 2 ? 'mix-button' : 'auto-outro', from: { title: before.title, bpm: before.bpm, key: before.key } };
  report.mixes.push(mix);
  if (!(await waitFor((x) => x.ready > 0, 120_000, 1000))) {
    mix.problem = 'no song ready within 2 min';
    save();
    break;
  }
  const mixesBefore = (await state()).mixCount;
  if (mix.path === 'mix-button') await page.evaluate(() => window.__qa.engine.nextTrack());
  else await page.evaluate(() => window.__qa.seekNearEnd(70));

  const started = await waitFor((x) => x.mixCount > mixesBefore, 150_000, 100);
  if (!started) {
    mix.problem = 'transition never started (150 s)';
    save();
    continue;
  }
  const done = await waitFor((x) => !x.transitioning && x.closedMixes > mixesBefore, 90_000, 100);
  if (!done) {
    mix.problem = 'transition stuck (90 s)';
    save();
    continue;
  }
  const info = await page.evaluate(() => window.__qa.lastMix());
  // Record until AFTER s past the start, and at least 6 s past the end
  const until = Math.max(info.start + AFTER, info.end + 6);
  await sleep(Math.max(0, (until - (await page.evaluate(() => window.__qa.now()))) * 1000) + 300);
  const after = await state();
  Object.assign(mix, {
    to: { title: after.title, bpm: after.bpm, key: after.key },
    transitionSeconds: Math.round((info.end - info.start) * 10) / 10,
    style: info.style,
    status: info.status,
  });
  const from = Math.max(info.start - BEFORE, until - MAX_CLIP);
  const clip = await page.evaluate(([a, b]) => window.__qa.clip(a, b), [from, until]);
  const file = path.join(root, `mix-${String(i).padStart(2, '0')}.wav`);
  fs.writeFileSync(file, Buffer.from(clip.wav, 'base64'));
  mix.clip = { file: path.basename(file), seconds: Math.round(clip.seconds * 10) / 10, mixAt: Math.round((info.start - clip.from) * 10) / 10 };
  mix.audio = measure(Buffer.from(clip.wav, 'base64'), mix.clip.mixAt, mix.transitionSeconds);
  // Where the two songs' beats really fall against each other, over the middle of the blend
  if (info.end - info.start >= 4) {
    const d = info.end - info.start;
    const env = await page.evaluate(([a, b]) => window.__qa.deckEnvelopes(a, b), [info.start + 0.25 * d, info.start + 0.75 * d]);
    if (env && info.bpm) mix.beat = beatOffset(env.a, env.b, env.hopSec, 60 / info.bpm);
  }
  mix.flags = flags(mix);
  console.log(
    `#${i} ${mix.path}: ${(mix.from.title || '').slice(0, 28)} → ${(mix.to.title || '').slice(0, 28)} | ${mix.transitionSeconds}s ${mix.style} | ` +
      `dropout ${mix.audio.longestDropoutMs} ms, jump ${mix.audio.maxJumpDb} dB${mix.beat ? `, beats ${mix.beat.offsetMs} ms (${mix.beat.clarity})` : ''}${mix.flags.length ? ` | ⚠ ${mix.flags.join('; ')}` : ''}`
  );
  save();
  if (FLAMINGO) review(mix, file);
}

await reviews;
report.finished = new Date().toISOString();
report.summary = summarize(report.mixes);
save();
await browser.close();
console.log(`\n${report.summary.text}\nReport: ${path.join(root, 'report.md')}`);

// ---------------------------------------------------------------------------------------------

/** Runs in the page: finds the engine, records the master output into a 60 s ring, logs mixes. */
async function installProbe() {
  const root = document.getElementById('root');
  const key = Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
  const stack = [root[key]];
  let e = null;
  while (stack.length && !e) {
    const f = stack.pop();
    if (!f) continue;
    for (let h = f.memoizedState; h && typeof h === 'object' && 'next' in h; h = h.next) {
      const v = h.memoizedState?.current;
      if (v && typeof v.populateQueueTo50 === 'function') e = v;
    }
    if (f.child) stack.push(f.child);
    if (f.sibling) stack.push(f.sibling);
  }
  if (!e) throw new Error('audio engine not found on the page');
  const ctx = e.ctx;
  const sr = ctx.sampleRate;
  const RING = sr * 90;
  const ring = new Float32Array(RING);
  let written = 0;
  let firstTime = null;
  // Taps the master output (after the limiter and clipper) on the audio thread: a main-thread
  // ScriptProcessor stalled while the app decoded songs and lost seconds of audio. Every block
  // carries its audio-clock time, so samples land at the right place even when messages queue.
  const code = `class QaTap extends AudioWorkletProcessor {
    constructor() { super(); this.buf = new Float32Array(4096); this.n = 0; this.t = 0; }
    process(inputs) {
      const inp = inputs[0];
      if (inp && inp.length) {
        const L = inp[0], R = inp[1] || inp[0];
        if (this.n === 0) this.t = currentTime;
        for (let i = 0; i < L.length; i++) this.buf[this.n++] = (L[i] + R[i]) / 2;
        if (this.n >= 4096) { this.port.postMessage({ t: this.t, d: this.buf.slice(0, this.n) }); this.n = 0; }
      }
      return true;
    }
  }
  registerProcessor('qa-tap', QaTap);
  // Each deck on its own (after its EQ, before the crossfader), at a quarter of the sample rate:
  // where the two songs' beats really fall during a blend
  class QaDecks extends AudioWorkletProcessor {
    constructor() { super(); this.a = new Float32Array(2048); this.b = new Float32Array(2048); this.n = 0; this.t = 0; this.k = 0; }
    process(inputs) {
      const mono = (inp, i) => (inp && inp.length ? (inp[0][i] + (inp[1] || inp[0])[i]) / 2 : 0);
      const len = inputs[0] && inputs[0].length ? inputs[0][0].length : inputs[1] && inputs[1].length ? inputs[1][0].length : 128;
      for (let i = 0; i < len; i++) {
        if (this.k++ % 4) continue;
        if (this.n === 0) this.t = currentTime + i / sampleRate;
        this.a[this.n] = mono(inputs[0], i);
        this.b[this.n++] = mono(inputs[1], i);
        if (this.n >= 2048) { this.port.postMessage({ t: this.t, a: this.a.slice(), b: this.b.slice() }); this.n = 0; }
      }
      return true;
    }
  }
  registerProcessor('qa-decks', QaDecks);`;
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
  const dsr = sr / 4;
  const DRING = Math.round(dsr * 90);
  const ringA = new Float32Array(DRING);
  const ringB = new Float32Array(DRING);
  let deckFirst = null;
  const decks = new AudioWorkletNode(ctx, 'qa-decks', { numberOfInputs: 2, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
  // Before the EQ (both kicks heard even while one's bass is cut), as the app's phase lock hears them
  (e.deckA.inputNode ?? e.deckA.analyserNode).connect(decks, 0, 0);
  (e.deckB.inputNode ?? e.deckB.analyserNode).connect(decks, 0, 1);
  const deckMute = ctx.createGain();
  deckMute.gain.value = 0;
  decks.connect(deckMute).connect(ctx.destination);
  decks.port.onmessage = ({ data }) => {
    if (deckFirst === null) deckFirst = data.t;
    const at = Math.round((data.t - deckFirst) * dsr);
    for (let i = 0; i < data.a.length; i++) {
      ringA[(at + i) % DRING] = data.a[i];
      ringB[(at + i) % DRING] = data.b[i];
    }
  };
  const tap = new AudioWorkletNode(ctx, 'qa-tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
  const mute = ctx.createGain();
  mute.gain.value = 0; // keeps the tap pulled by the graph without adding sound
  e.masterAnalyser.connect(tap);
  tap.connect(mute).connect(ctx.destination);
  tap.port.onmessage = ({ data }) => {
    if (firstTime === null) firstTime = data.t;
    const at = Math.round((data.t - firstTime) * sr);
    for (let i = 0; i < data.d.length; i++) ring[(at + i) % RING] = data.d[i];
    written = Math.max(written, at + data.d.length);
  };

  const deckOf = () => (e.activeDeck === 'A' ? e.deckA : e.deckB);
  const mixes = [];
  let inMix = null;
  let lastTitle = deckOf().getTrack()?.title;
  setInterval(() => {
    const now = ctx.currentTime;
    const title = deckOf().getTrack()?.title;
    if (!inMix && e.isTransitioning && e.transitionProgress > 0) {
      inMix = { start: now, status: e.acquisitionStatus, bpm: deckOf().getPlaybackState().effectiveBpm };
    } else if (!inMix && title && lastTitle && title !== lastTitle) {
      inMix = { start: now, status: e.acquisitionStatus }; // a near-instant cut seen only as a new song
    }
    if (inMix && e.acquisitionStatus && e.acquisitionStatus !== inMix.status) inMix.status = e.acquisitionStatus;
    if (inMix && !e.isTransitioning) {
      inMix.end = now;
      mixes.push(inMix);
      inMix = null;
    }
    lastTitle = title;
  }, 25);

  const styleOf = (status) =>
    (status.match(/Showcase blend|slow wash fade|Beatmatched mix|fading over the low part|smooth \d+ s fade|Fading out|Cut into the silence|Quick cut|quick cut|Echo-out|Reverb wash|filter sweep/i) || ['blend'])[0];

  /** Each deck's loudness (RMS) in 5 ms frames from ctx time a to b, for qa/beatPhase.mjs. */
  const deckEnvelopes = (a, b) => {
    if (deckFirst === null) return null;
    const hop = Math.max(1, Math.round(dsr * 0.005));
    const i0 = Math.round((a - deckFirst) * dsr);
    const frames = Math.floor((Math.round((b - deckFirst) * dsr) - i0) / hop);
    if (frames < 200) return null;
    // Kick and bass only (a one-pole low-pass at 150 Hz), like the app's phase lock
    const k = 1 - Math.exp((-2 * Math.PI * 150) / dsr);
    const env = (ring) => {
      const out = new Array(frames);
      let lp = 0;
      for (let f = 0; f < frames; f++) {
        let s = 0;
        for (let i = 0; i < hop; i++) {
          lp += k * (ring[(i0 + f * hop + i) % DRING] - lp);
          s += lp * lp;
        }
        out[f] = Math.sqrt(s / hop);
      }
      return out;
    };
    return { a: env(ringA), b: env(ringB), hopSec: hop / dsr };
  };

  window.__qa = {
    engine: e,
    now: () => ctx.currentTime,
    deckEnvelopes,
    state: () => {
      const s = deckOf().getPlaybackState();
      const t = s.track;
      return {
        playing: s.isPlaying,
        title: t?.title,
        bpm: t?.bpm,
        key: t?.key,
        transitioning: e.isTransitioning,
        ready: e.queue.filter((q) => q.status === 'ready' && q.audioBuffer).length,
        mixCount: mixes.length + (inMix ? 1 : 0),
        closedMixes: mixes.length,
      };
    },
    seekNearEnd: (seconds) => {
      const d = deckOf();
      const t = d.getTrack();
      e.seekTo(Math.max(d.getCurrentTime(), (t.musicEndTime ?? t.duration) - seconds));
    },
    lastMix: () => {
      const m = mixes[mixes.length - 1];
      return { ...m, style: styleOf(m.status || '') };
    },
    /** The master output from ctx time a to b as a base64 mono 16 kHz 16-bit WAV. */
    clip: (a, b) => {
      const idx = (t) => Math.round((t - firstTime) * sr);
      const i0 = Math.max(idx(a), written - RING + 1, 0);
      const i1 = Math.min(idx(b), written);
      const outRate = 16000;
      const n = Math.max(0, Math.floor(((i1 - i0) * outRate) / sr));
      const pcm = new Int16Array(n);
      const step = sr / outRate;
      for (let k = 0; k < n; k++) {
        // average the input samples this output sample covers (a simple low-pass before decimating)
        const from = i0 + Math.floor(k * step);
        const to = Math.max(from + 1, i0 + Math.floor((k + 1) * step));
        let sum = 0;
        for (let i = from; i < to; i++) sum += ring[i % RING];
        pcm[k] = Math.max(-32768, Math.min(32767, Math.round((sum / (to - from)) * 32767)));
      }
      const buf = new ArrayBuffer(44 + n * 2);
      const v = new DataView(buf);
      const str = (o, s) => [...s].forEach((c, j) => v.setUint8(o + j, c.charCodeAt(0)));
      str(0, 'RIFF');
      v.setUint32(4, 36 + n * 2, true);
      str(8, 'WAVEfmt ');
      v.setUint32(16, 16, true);
      v.setUint16(20, 1, true);
      v.setUint16(22, 1, true);
      v.setUint32(24, outRate, true);
      v.setUint32(28, outRate * 2, true);
      v.setUint16(32, 2, true);
      v.setUint16(34, 16, true);
      str(36, 'data');
      v.setUint32(40, n * 2, true);
      new Int16Array(buf, 44).set(pcm);
      let bin = '';
      const bytes = new Uint8Array(buf);
      for (let o = 0; o < bytes.length; o += 0x8000) bin += String.fromCharCode(...bytes.subarray(o, o + 0x8000));
      return { wav: btoa(bin), from: (i0 / sr) + firstTime, seconds: n / outRate };
    },
  };
}

/** Our own numbers from the clip: drop-outs, loudness jumps, old vs new song level, peaks. */
function measure(wav, mixAt, mixSeconds) {
  const rate = wav.readUInt32LE(24);
  const samples = new Int16Array(wav.buffer, wav.byteOffset + 44, (wav.length - 44) / 2);
  const win = Math.round(rate * 0.25);
  const rms = [];
  let peak = 0;
  for (let o = 0; o + win <= samples.length; o += win) {
    let sum = 0;
    for (let i = o; i < o + win; i++) {
      const x = samples[i] / 32768;
      sum += x * x;
      peak = Math.max(peak, Math.abs(x));
    }
    rms.push(Math.sqrt(sum / win));
  }
  const db = (x) => (x > 0 ? 20 * Math.log10(x) : -120);
  const at = (t) => Math.max(0, Math.min(rms.length - 1, Math.floor(t / 0.25)));
  const level = (a, b) => {
    const part = rms.slice(at(a), at(b) + 1);
    return part.length ? db(Math.sqrt(part.reduce((s, x) => s + x * x, 0) / part.length)) : -120;
  };
  // Silence below -45 dBFS during the mix ± 2 s
  let longest = 0;
  let run = 0;
  for (let k = at(mixAt - 2); k <= at(mixAt + mixSeconds + 2); k++) {
    run = db(rms[k]) < -45 ? run + 250 : 0;
    longest = Math.max(longest, run);
  }
  // The biggest change between neighbouring 1 s stretches around the mix (a sudden stop or burst)
  let maxJump = 0;
  for (let t = Math.max(1, mixAt - 3); t + 1 <= Math.min(rms.length * 0.25, mixAt + mixSeconds + 3); t += 0.25) {
    maxJump = Math.max(maxJump, Math.abs(level(t, t + 1) - level(t - 1, t)));
  }
  const r1 = (x) => Math.round(x * 10) / 10;
  return {
    oldSongDb: r1(level(Math.max(0, mixAt - 8), mixAt - 1)),
    duringDb: r1(level(mixAt, mixAt + Math.max(1, mixSeconds))),
    newSongDb: r1(level(mixAt + mixSeconds + 1, rms.length * 0.25)),
    longestDropoutMs: longest,
    maxJumpDb: r1(maxJump),
    peak: Math.round(peak * 1000) / 1000,
  };
}

/** What our own measurements call a problem (independent of Music Flamingo). */
function flags(mix) {
  const a = mix.audio;
  const out = [];
  if (mix.transitionSeconds < 1 && !/silence/i.test(mix.style)) out.push(`abrupt: ${mix.transitionSeconds} s with no pause in the old song`);
  if (a.longestDropoutMs >= 500) out.push(`drop-out ${a.longestDropoutMs} ms`);
  if (a.maxJumpDb >= 8) out.push(`loudness jump ${a.maxJumpDb} dB`);
  if (a.duringDb - Math.max(a.oldSongDb, a.newSongDb) >= 3) out.push(`overlap ${Math.round(a.duringDb - Math.max(a.oldSongDb, a.newSongDb))} dB louder`);
  if (a.peak >= 0.999) out.push('clipping');
  // Beatmatched blends: kicks more than 25 ms apart are heard as two (a flam)
  if (/Beatmatched|Showcase/i.test(mix.style ?? '') && mix.beat && mix.beat.clarity >= 2 && Math.abs(mix.beat.offsetMs) > 25) out.push(`beats ${mix.beat.offsetMs} ms apart`);
  return out;
}

function summarize(mixes) {
  const done = mixes.filter((m) => m.audio);
  const scored = done.filter((m) => typeof m.flamingo?.score === 'number');
  const avg = scored.length ? Math.round((scored.reduce((s, m) => s + m.flamingo.score, 0) / scored.length) * 10) / 10 : null;
  const weak = done.filter((m) => m.flags.length || (typeof m.flamingo?.score === 'number' && m.flamingo.score <= 5) || m.flamingo?.abrupt === true);
  const text = [
    `${done.length}/${mixes.length} mixes recorded; ${done.filter((m) => !m.flags.length).length} clean by our measurements.`,
    scored.length ? `Music Flamingo: average ${avg}/10 over ${scored.length}; it called ${scored.filter((m) => m.flamingo.abrupt).length} abrupt.` : 'Music Flamingo: no scores.',
    weak.length ? `To listen to: ${weak.map((m) => `#${m.n}`).join(', ')}.` : 'Nothing flagged.',
  ].join(' ');
  return { recorded: done.length, flamingoAverage: avg, flagged: weak.map((m) => m.n), text };
}

function markdown(r) {
  const rows = r.mixes.map((m) => {
    const f = m.flamingo;
    const fl = !f ? '' : f.error ? `error: ${f.error}` : typeof f.score === 'number' ? `${f.score}/10${f.abrupt ? ' **abrupt**' : ''}${f.beatsAligned === false ? ', beats off' : ''}${f.keyClash && f.keyClash !== 'none' ? `, key clash ${f.keyClash}` : ''} — ${f.verdict ?? ''}` : (f.raw ?? '').slice(0, 160);
    return `| ${m.n} | ${m.path} | ${(m.from?.title ?? '').slice(0, 30)} → ${(m.to?.title ?? '').slice(0, 30)} | ${m.style ?? m.problem ?? ''} | ${m.transitionSeconds ?? ''} | ${m.audio ? `${m.audio.longestDropoutMs} ms / ${m.audio.maxJumpDb} dB` : ''} | ${m.beat ? `${m.beat.offsetMs} ms (${m.beat.clarity})` : ''} | ${(m.flags ?? []).join('; ')} | ${fl.replace(/\|/g, '/')} | ${m.clip?.file ?? ''} |`;
  });
  return [
    `# Transition QA — ${r.started}`,
    '',
    r.summary?.text ?? '(running)',
    '',
    '| # | How | Songs | Style | Length (s) | Drop-out / jump | Beat offset | Our flags | Music Flamingo | Clip |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
    r.errors.length ? `Page errors: ${r.errors.length} (first: ${r.errors[0]})` : 'No page errors.',
  ].join('\n');
}
