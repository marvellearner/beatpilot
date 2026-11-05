// QA for the dhol wala (Live Rhythm Enhancer) in the running app, in its own headless tab.
// Logs every dhol stroke the app plays and checks: the score (light under singing, roll into the
// chorus, accent), the four cue buttons, and the bridge through a cut between songs at different
// tempos. Records what the app plays to .webm clips to listen to.
//   node qa/dholQa.mjs [outDir]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || path.join('qa', 'out', 'dhol');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const until = async (fn, ms, step = 500) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(step);
  }
  return null;
};

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.locator('#party-console-prev-button').waitFor({ timeout: 60_000 });
await sleep(2500);
check(
  'engine found',
  await page.evaluate(() => {
    const root = document.getElementById('root');
    const key = Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
    const stack = [root[key]];
    while (stack.length && !window.__e) {
      const f = stack.pop();
      if (!f) continue;
      for (let h = f.memoizedState; h && typeof h === 'object' && 'next' in h; h = h.next) {
        const v = h.memoizedState?.current;
        if (v && typeof v.nextTrack === 'function' && v.deckA) window.__e = v;
      }
      if (f.child) stack.push(f.child);
      if (f.sibling) stack.push(f.sibling);
    }
    return !!window.__e;
  })
);

// Log every stroke; record the master output
await page.evaluate(() => {
  const r = window.__e.rhythm;
  window.__hits = [];
  const orig = r.playHit.bind(r);
  r.playHit = (voice, when, velocity, muted) => {
    // Where the stroke falls on the grid it was played on (the song can be re-timed later,
    // which renumbers bars: measure with the grid of the moment)
    const g = r.grid;
    window.__hits.push({ voice, when, velocity, muted: !!muted, key: g?.key, beat: g ? r.beatAt(g, when) : null });
    return orig(voice, when, velocity, muted);
  };
  // Dhol on, AI mode, normal level (the test tab's own settings)
  const s = r.getState();
  if (!s.enabled) r.command({ kind: 'toggle' });
  if (s.mode !== 'ai') r.command({ kind: 'mode' });
  window.__rec = { start() {
    const e = window.__e;
    const dest = e.ctx.createMediaStreamDestination();
    e.masterAnalyser.connect(dest);
    const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus' });
    const chunks = [];
    rec.ondataavailable = (ev) => chunks.push(ev.data);
    rec.start();
    return { stop: () => new Promise((res) => { rec.onstop = async () => { e.masterAnalyser.disconnect(dest); const b = new Blob(chunks); const buf = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000)); res(btoa(s)); }; rec.stop(); }) };
  } };
});
async function record(name, ms) {
  await page.evaluate(() => (window.__recording = window.__rec.start()));
  await sleep(ms);
  const b64 = await page.evaluate(() => window.__recording.stop());
  const file = path.join(OUT, `${name}.webm`);
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  console.log(`      clip: ${file}`);
}
const hitsSince = (t) => page.evaluate((t) => window.__hits.filter((h) => h.when >= t), t);
const now = () => page.evaluate(() => window.__e.ctx.currentTime);
const rhythm = () => page.evaluate(() => window.__e.rhythm.getState());

// --- A Punjabi song on air ---
const PUNJABI = /diljit|aujla|sidhu|moose|shubh|dhillon|mankirt|jassi|gill|randhawa|badshah|honey singh|guru|bhangra|punjabi|jazzy|navaan|sandhu/i;
// Songs in Up Next are ready on disk but loaded into memory only when needed: load one, start it
const songTitle = await page.evaluate(async (re) => {
  const rx = new RegExp(re, 'i');
  for (let i = 0; i < 240; i++) {
    const e = window.__e;
    const item = e.queue.find((q) => q.status === 'ready' && rx.test(`${q.title} ${q.artist}`));
    if (item && (await e.ensureTrackBuffer(item))) {
      e.startQueuedMixNow(item);
      return item.title;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}, PUNJABI.source);
check('a Punjabi song is playing', !!songTitle && !!(await until(() => page.evaluate(() => window.__e.isAnyDeckPlaying()), 30_000)), songTitle);

// Wait for its analysis (score + plan)
const plan = await until(async () => {
  const s = await rhythm();
  return s.plan ? s.plan : null;
}, 60_000, 1000);
check('the AI mode plan gives this song the dhol', !!plan?.play, plan ? `${plan.styleId}: ${plan.reason}` : 'no plan');

// --- The score: seek to 6 s before the first roll into a chorus, listen through it ---
const target = await until(() => page.evaluate(() => {
  const r = window.__e.rhythm;
  if (!r.grid || !r.score?.length) return null;
  const bar = r.score.findIndex((b, i) => i > 4 && b.roll && r.score[i + 1]?.role === 'groove');
  if (bar < 0) return { none: true, roles: r.score.map((b) => b.role[0]).join('') };
  const g = r.grid;
  return { bar, songTime: g.clock.downbeat + bar * g.barSeconds - 6 * g.clock.rate, barSeconds: g.barSeconds / g.clock.rate };
}), 30_000, 1000);
if (target?.none) {
  check('the score has a roll into a chorus', false, `bars: ${target.roles}`);
} else if (target) {
  await page.evaluate((t) => {
    const e = window.__e;
    const deck = e.activeDeck === 'A' ? e.deckA : e.deckB;
    deck.seek(t);
  }, target.songTime);
  await sleep(500);
  const t0 = await now();
  const clip = record('1-score-roll-into-chorus', 13000);
  const statuses = new Set();
  for (let i = 0; i < 12; i++) {
    statuses.add((await rhythm()).status);
    await sleep(1000);
  }
  await clip;
  const hits = (await hitsSince(t0)).filter((h) => h.beat !== null);
  // By beat position (bar numbers don't change when a song is re-timed for a set tempo)
  const bar = target.bar;
  const roll = hits.filter((h) => /Crack|Na/.test(h.voice) && h.beat >= bar * 4 + 2 - 0.01 && h.beat < bar * 4 + 3.95).sort((a, b) => a.beat - b.beat);
  const rising = roll.length >= 8 && roll[roll.length - 1].velocity > roll[0].velocity * 1.8;
  check('roll into the chorus: dense strokes getting louder up to the bar line', rising, `${roll.length} strokes, ${roll[0]?.velocity.toFixed(2)} -> ${roll[roll.length - 1]?.velocity.toFixed(2)}`);
  const accent = hits.find((h) => /Bass|Ge/.test(h.voice) && Math.abs(h.beat - (bar + 1) * 4) < 0.01);
  check('the chorus lands with a big accent on its 1', !!accent && accent.velocity > 0.95, accent ? `velocity ${accent.velocity.toFixed(2)}` : 'none');
  const chorusHits = hits.filter((h) => h.beat >= (bar + 1) * 4 && h.beat < (bar + 2) * 4).length;
  const beforeHits = hits.filter((h) => h.beat >= (bar - 1) * 4 && h.beat < bar * 4).length;
  check('the chorus plays the full taal (more strokes than the bars before)', chorusHits > beforeHits, `${beforeHits} -> ${chorusHits} strokes per bar`);
  console.log('      statuses:', [...statuses].slice(0, 6).join(' | '));
}

// --- Cues ---
// Roll
let t0 = await now();
await page.locator('#rhythm-cue-roll').first().click();
await sleep(1500);
const rollStarted = (await hitsSince(t0)).filter((h) => /Crack|Na/.test(h.voice)).length;
await sleep(4500);
let hits = await hitsSince(t0);
const treble = hits.filter((h) => /Crack|Na/.test(h.voice));
let burst = 0;
for (let i = 1; i < treble.length; i++) if (treble[i].when - treble[i - 1].when < 0.1) burst++;
check('Roll cue: a fast burst of strokes, starting right away', burst >= 8 && rollStarted >= 4, `${burst} strokes under 0.1 s apart, ${rollStarted} in the first 1.5 s`);

// Break
t0 = await now();
await page.locator('#rhythm-cue-break').first().click();
const breakState = (await rhythm()).cues;
await sleep(500);
const clipB = record('2-cue-dhol-break', 8000);
await sleep(8000);
await clipB;
hits = await hitsSince(t0);
check('Dhol break cue: shows as coming, then plays dense bars', breakState.breakComing && hits.length > 30, `${hits.length} strokes in 8.5 s`);

// Dhamaal
await page.locator('#rhythm-cue-dhamaal').first().click();
await sleep(1500);
let st = await rhythm();
const pressed = await page.locator('#rhythm-cue-dhamaal').first().getAttribute('aria-pressed');
check('Dhamaal cue: on, button shows pressed, status says Dhamaal', st.cues.dhamaal && pressed === 'true' && /Dhamaal/.test(st.status), st.status);
await page.locator('#rhythm-cue-dhamaal').first().click();
await sleep(500);
check('Dhamaal cue: tap again turns it off', !(await rhythm()).cues.dhamaal);

// Rest
await page.locator('#rhythm-cue-rest').first().click();
await sleep(600);
t0 = await now();
await sleep(3000);
const restHits = (await hitsSince(t0)).length;
check('Rest cue: the dhol stops', (await rhythm()).cues.rest && restHits === 0, `${restHits} strokes in 3 s`);
await page.locator('#rhythm-cue-rest').first().click();
t0 = await now();
await sleep(3000);
check('Rest cue: tap again brings it back', (await hitsSince(t0)).length > 0);

// --- Bridge: a mix into a Punjabi song the song on air can't be beatmatched with ---
const bridge = await page.evaluate(async (re) => {
  const rx = new RegExp(re, 'i');
  for (let i = 0; i < 120; i++) {
    const e = window.__e;
    const on = (e.activeDeck === 'A' ? e.deckA : e.deckB).getTrack();
    const item = e.queue.find((q) => q.status === 'ready' && (q.bpmConfidence ?? 0) >= 0.5 && rx.test(`${q.title} ${q.artist}`) && !e.canBeatmatch(on, e.queuedItemToTrack(q)));
    if (item && (await e.ensureTrackBuffer(item))) return { id: item.id, title: item.title, bpm: Math.round(item.bpm), from: Math.round(on.bpm) };
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}, PUNJABI.source);
if (!bridge) {
  check('bridge test: a Punjabi song at a different tempo is ready', false);
} else {
  t0 = await now();
  const clipC = record('3-bridge-mix-into-next-song', 14000);
  await sleep(1500);
  // The app's own mix for two songs it can't beatmatch (a fade over a low part, no beatmatch)
  await page.evaluate((id) => {
    const e = window.__e;
    window.__oldKey = e.rhythm.grid?.key;
    window.__mixAt = e.ctx.currentTime;
    e.startQueuedMixNow(e.queue.find((q) => q.id === id));
  }, bridge.id);
  const statuses = new Set();
  const kinds = new Set();
  for (let i = 0; i < 60; i++) {
    statuses.add((await rhythm()).status);
    kinds.add(await page.evaluate(() => { const c = window.__e.rhythm.lastClock; const m = window.__e.mixCoordinator.current; return `${c?.transition}${c?.transition === 'cut' ? ` incoming=${c.incoming ? 'yes conf ' + c.incoming.bpmConfidence + ' startsIn ' + (c.incoming.startsAt - window.__e.ctx.currentTime).toFixed(2) : 'no'} mix=${m ? m.targetDeckId : 'none'} onAir=${window.__e.activeDeck}` : ''}`; }));
    await sleep(200);
  }
  const wasCut = [...kinds].some((k) => k.startsWith('cut'));
  console.log('      mix kind:', [...kinds].join(', '));
  await clipC;
  hits = (await hitsSince(t0)).sort((a, b) => a.when - b.when);
  // The new song's strokes: anything not on the old song's grid after the mix starts (the new
  // song may be re-timed for the set tempo during the mix, which gives it a second grid key)
  const { oldKey, mixAt } = await page.evaluate(() => ({ oldKey: window.__oldKey, mixAt: window.__mixAt }));
  const onNew = hits.filter((h) => h.key !== oldKey && h.when >= mixAt);
  const firstNew = onNew[0]?.when ?? Infinity;
  // Through the change: no silence longer than a bar from the mix start to a bar into the new song
  const span = hits.filter((h) => h.when < firstNew + 2).map((h) => h.when);
  let maxGap = 0, gapAt = 0;
  for (let i = 1; i < span.length; i++) if (span[i] - span[i - 1] > maxGap) { maxGap = span[i] - span[i - 1]; gapAt = span[i - 1]; }
  console.log(`      gap starts ${(gapAt - firstNew).toFixed(2)} s from the first stroke on the new song; strokes around it:`, hits.filter((h) => Math.abs(h.when - gapAt) < 2).map((h) => `${(h.when - firstNew).toFixed(2)}:${h.key !== oldKey ? 'new' : 'old'}:${h.voice.slice(4)}`).join(' '));
  check(`bridge: the dhol keeps playing through the mix (${bridge.from} -> ${bridge.bpm} BPM)`, onNew.length > 0 && maxGap < 1.5, `longest silence ${maxGap.toFixed(2)} s, ${onNew.length} strokes on the new song`);
  check('bridge: status shows the dhol break carrying the crowd', [...statuses].some((s) => /carrying the crowd|into the next song/.test(s)), [...statuses].slice(0, 4).join(' | '));
  // The first strokes on the new song's grid: an accent on its bar line
  // (the bridge roll's strokes play after the switch too, so they're logged on the new grid: the
  // landing is the first bass stroke exactly on one of its bar lines)
  const landing = onNew.find((h) => /Bass|Ge/.test(h.voice) && Math.abs(h.beat / 4 - Math.round(h.beat / 4)) < 0.01);
  const onBar = landing && Math.abs(landing.beat / 4 - Math.round(landing.beat / 4)) < 0.01;
  if (wasCut) check("bridge: lands with an accent on the new song's bar line", !!landing && onBar && landing.velocity > 0.95, landing ? `velocity ${landing.velocity.toFixed(2)} at beat ${landing.beat.toFixed(2)}` : 'none');
}

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
await browser.close();
