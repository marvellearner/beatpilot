// Measures the DJ page's memory while it plays and mixes songs: live decoded AudioBuffers (count and
// MB, found with DevTools' queryObjects), where the engine keeps them, the JS heap, and the renderer's
// CPU time. Needs "npm run dev".   node qa/memory.mjs [mixes=5]
import { chromium } from 'playwright-core';

const MIXES = Number(process.argv[2] || 5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable');
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

async function audioBuffers() {
  if (await page.evaluate(() => typeof gc === 'function')) await page.evaluate(() => gc());
  const proto = await cdp.send('Runtime.evaluate', { expression: 'AudioBuffer.prototype' });
  const list = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId });
  const r = await cdp.send('Runtime.callFunctionOn', {
    objectId: list.objects.objectId,
    functionDeclaration: 'function(){ let mb=0; for (const b of this) mb += b.length*b.numberOfChannels*4/1048576; window.__bufs = this; return JSON.stringify({ n: this.length, mb: Math.round(mb) }); }',
    returnByValue: true,
  });
  await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'console' }).catch(() => {});
  return JSON.parse(r.result.value);
}

// Where each live buffer is referenced from (shallow walk over the engine)
const holders = () =>
  page.evaluate(() => {
    const e = window.__e;
    const live = new Set(window.__bufs);
    const found = new Map();
    const seen = new Set();
    const walk = (v, path, depth) => {
      if (!v || typeof v !== 'object' || seen.has(v) || depth > 5) return;
      seen.add(v);
      if (v instanceof AudioBuffer) {
        if (!found.has(v)) found.set(v, path);
        return;
      }
      if (v instanceof AudioBufferSourceNode) { if (v.buffer && !found.has(v.buffer)) found.set(v.buffer, path + '.<source>.buffer'); return; }
      if (v instanceof AudioNode || v instanceof AudioContext || ArrayBuffer.isView(v) || v instanceof Node) return;
      if (v instanceof Map) { for (const [k, x] of v) walk(x, `${path}<map>`, depth + 1); return; }
      if (Array.isArray(v)) { v.forEach((x) => walk(x, `${path}[]`, depth + 1)); return; }
      for (const k of Object.keys(v)) walk(v[k], `${path}.${k}`, depth + 1);
    };
    walk(e, 'engine', 0);
    // React: props and state of every component
    const root = document.getElementById('root');
    const st = [root[Object.keys(root).find((k) => k.startsWith('__reactContainer$'))]];
    while (st.length) { const f = st.pop(); if (!f) continue; const name = typeof f.type === 'function' ? f.type.name : String(f.type); walk(f.memoizedProps, 'react:' + name + '.props', 1); for (let h = f.memoizedState, i = 0; h && typeof h === 'object' && 'next' in h; h = h.next, i++) walk(h.memoizedState, 'react:' + name + '.hook' + i, 1); if (f.child) st.push(f.child); if (f.sibling) st.push(f.sibling); }
    for (const k of Object.keys(window)) if (k !== '__bufs') walk(window[k], 'window.' + k, 1);
    const byPath = {};
    let unknown = 0;
    for (const b of live) {
      const p = found.get(b);
      if (!p) { unknown++; continue; }
      byPath[p] = (byPath[p] || 0) + 1;
    }
    window.__bufs = null;
    return { byPath, unreached: unknown };
  });

async function snapshot(label) {
  const bufs = await audioBuffers();
  const where = await holders();
  const m = await cdp.send('Performance.getMetrics');
  const get = (n) => m.metrics.find((x) => x.name === n)?.value ?? 0;
  const q = await page.evaluate(() => ({ queue: window.__e.queue.length, withBuffer: window.__e.queue.filter((x) => x.audioBuffer).length }));
  console.log(`\n[${label}] AudioBuffers: ${bufs.n} (${bufs.mb} MB)  JS heap: ${Math.round(get('JSHeapUsedSize') / 1048576)} MB  queue ${q.queue} (with audio ${q.withBuffer})  CPU task time ${get('TaskDuration').toFixed(1)} s`);
  console.log('   held at:', JSON.stringify(where.byPath), 'not reachable from engine:', where.unreached);
}

const ready = () => page.evaluate(() => window.__e.queue.filter((q) => q.status === 'ready' && q.audioBuffer).length);
async function until(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(1000); }
  return false;
}

await snapshot('loaded');
if (!(await until(async () => (await ready()) > 0, 180_000))) throw new Error('no song ready');
await page.evaluate(() => window.__e.nextTrack());
await sleep(10_000);
await snapshot('playing');
for (let i = 1; i <= MIXES; i++) {
  if (!(await until(async () => (await ready()) > 0, 120_000))) break;
  await page.evaluate(() => window.__e.nextTrack());
  await until(() => page.evaluate(() => !window.__e.isTransitioning), 60_000);
  await sleep(12_000);
  await snapshot(`after mix ${i}`);
}
console.log('\npage errors:', errors.length ? errors : 'none');
await browser.close();
