// QA of the Previous button: seeds Previously Played with 12 real songs from the play history
// that are in the audio cache (so nothing is downloaded), starts a song, then
//   A) presses Previous 10 times quickly: it should land on the 10th song back;
//   B) presses Previous 10 times, each once the last song is on air: it should play the 10
//      previous songs back to back, in order.
// Needs "npm run dev".   node qa/previous.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cached = new Set(fs.readdirSync(path.join(root, 'cache', 'audio')).map((f) => f.replace(/\.audio$/, '')));
const vid = (u) => (u || '').match(/[?&]v=([\w-]{11})|youtu\.be\/([\w-]{11})/)?.slice(1).find(Boolean);
const history = JSON.parse(fs.readFileSync(path.join(root, 'data', 'play_history.json'), 'utf8'))
  .filter((h) => h.url && cached.has(vid(h.url)) && h.title && !/^https?:/.test(h.title))
  .slice(0, 12);
const now = Date.now();
// Played 4 hours ago and before, newest first (older than 3 h, so Up Next may still use them)
const playLog = history.map((h, i) => ({ id: `seed_${i}`, title: h.title, artist: h.artist, url: h.url, playedAt: now - 4 * 3600_000 - i * 240_000 }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext();
await context.addInitScript((log) => {
  if (!sessionStorage.getItem('qa_seeded')) {
    localStorage.setItem('ai_dj_play_log', JSON.stringify(log));
    sessionStorage.setItem('qa_seeded', '1');
  }
}, playLog);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.locator('#party-console-prev-button').waitFor({ timeout: 60_000 });
await sleep(4000);
await page.evaluate(() => {
  const root = document.getElementById('root');
  const key = Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
  const stack = [root[key]];
  while (stack.length && !window.__e) {
    const f = stack.pop();
    if (!f) continue;
    for (let h = f.memoizedState; h && typeof h === 'object' && 'next' in h; h = h.next) {
      const v = h.memoizedState?.current;
      if (v && typeof v.populateQueueTo50 === 'function') window.__e = v;
    }
    if (f.child) stack.push(f.child);
    if (f.sibling) stack.push(f.sibling);
  }
});
const state = () =>
  page.evaluate(() => {
    const e = window.__e;
    const d = e.activeDeck === 'A' ? e.deckA : e.deckB;
    const s = d.getPlaybackState();
    return { title: s.track?.title, playing: s.isPlaying, pos: s.currentTime, transitioning: e.isTransitioning, status: e.acquisitionStatus, ready: e.queue.filter((q) => q.status === 'ready' && q.audioBuffer).length };
  });
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = await state();
    if (fn(s)) return s;
    await sleep(200);
  }
  return null;
}
const press = () => page.locator('#party-console-prev-button').click();
const same = (a, b) => (a || '').toLowerCase().trim() === (b || '').toLowerCase().trim();
const results = { seeded: playLog.map((p) => p.title), A: null, B: [], errors };

// Something on air first
if (!(await waitFor((s) => s.ready > 0, 180_000))) throw new Error('no song ready');
await page.evaluate(() => window.__e.nextTrack());
let s = await waitFor((x) => x.playing, 60_000);
console.log(`On air: ${s.title}`);
await sleep(5000);

// A) 10 quick presses
const startTitle = (await state()).title;
for (let i = 0; i < 10; i++) {
  await press();
  await sleep(150);
}
const expectedA = await page.evaluate(() => window.__e.backNav?.songs.map((x) => x.title));
s = await waitFor((x) => !same(x.title, startTitle) && !x.transitioning && x.playing, 60_000);
results.A = { from: startTitle, landedOn: s?.title, expected: expectedA?.[9], ok: !!s && same(s.title, expectedA?.[9]), status: s?.status };
console.log(`A) 10 quick presses: ${startTitle} → ${s?.title} (expected the 10th back: ${expectedA?.[9]}) ${results.A.ok ? 'OK' : 'WRONG'}`);

// Let the walk end (a fresh start for B)
await page.evaluate(() => { window.__e.backNav = null; });
await sleep(6000);

// B) 10 presses, each once the song before is on air
let prevTitle = (await state()).title;
let expectedB = null;
for (let i = 1; i <= 10; i++) {
  const t0 = Date.now();
  await press();
  if (i === 1) expectedB = await page.evaluate(() => window.__e.backNav?.songs.map((x) => x.title));
  s = await waitFor((x) => !same(x.title, prevTitle) && !x.transitioning && x.playing, 60_000);
  const ok = !!s && same(s.title, expectedB?.[i - 1]);
  results.B.push({ step: i, title: s?.title, expected: expectedB?.[i - 1], seconds: Math.round((Date.now() - t0) / 100) / 10, ok });
  console.log(`B) press ${i}: → ${s?.title ?? '(nothing changed in 60 s)'} ${ok ? 'OK' : `WRONG (expected ${expectedB?.[i - 1]})`} in ${results.B.at(-1).seconds}s`);
  if (!s) {
    const now = await page.evaluate(() => { const e = window.__e; const d = e.activeDeck === 'A' ? e.deckA : e.deckB; const o = e.activeDeck === 'A' ? e.deckB : e.deckA; return { status: e.acquisitionStatus, transitioning: e.isTransitioning, progress: e.transitionProgress, onAir: d.getTrack()?.title, onAirPlaying: d.getPlaybackState().isPlaying, other: o.getTrack()?.title, otherPlaying: o.getPlaybackState().isPlaying, crossfader: e.crossfaderPosition, backNav: e.backNav && { index: e.backNav.index, n: e.backNav.songs.length } }; });
    console.log('   state when stuck:', JSON.stringify(now));
    results.B.at(-1).stuck = now;
    break;
  }
  prevTitle = s.title;
  await sleep(3000);
}
fs.mkdirSync(path.join(root, 'qa', 'out'), { recursive: true });
fs.writeFileSync(path.join(root, 'qa', 'out', 'previous-qa.json'), JSON.stringify(results, null, 2));
console.log(`\nA: ${results.A.ok ? 'pass' : 'FAIL'}; B: ${results.B.filter((r) => r.ok).length}/10 in order; page errors: ${errors.length}`);
await browser.close();
