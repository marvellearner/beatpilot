// Profiles the DJ page's main thread while a song plays (and optionally during a mix) and prints
// where the time goes, by function and by source file. Needs "npm run dev".
//   node qa/cpuProfile.mjs [seconds=15] [mix]
import { chromium } from 'playwright-core';

const SECONDS = Number(process.argv[2] || 15);
const DURING_MIX = process.argv[3] === 'mix';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable');
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
const ready = () => page.evaluate(() => window.__e.queue.filter((q) => q.status === 'ready' && q.audioBuffer).length);
for (let i = 0; i < 180 && !(await ready()); i++) await sleep(1000);
await page.evaluate(() => window.__e.nextTrack());
await sleep(20_000); // let the queue fill and settle
if (DURING_MIX) {
  for (let i = 0; i < 120 && !(await ready()); i++) await sleep(1000);
}

const metric = async (n) => (await cdp.send('Performance.getMetrics')).metrics.find((x) => x.name === n)?.value ?? 0;
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
const t0 = Date.now();
const task0 = await metric('TaskDuration');
const script0 = await metric('ScriptDuration');
const layout0 = (await metric('LayoutDuration')) + (await metric('RecalcStyleDuration'));
await cdp.send('Profiler.start');
if (DURING_MIX) await page.evaluate(() => window.__e.nextTrack());
await sleep(SECONDS * 1000);
const { profile } = await cdp.send('Profiler.stop');
const wall = (Date.now() - t0) / 1000;
const task = (await metric('TaskDuration')) - task0;
const script = (await metric('ScriptDuration')) - script0;
const layout = (await metric('LayoutDuration')) + (await metric('RecalcStyleDuration')) - layout0;
console.log(`\nwall ${wall.toFixed(1)} s | main thread busy ${task.toFixed(1)} s (${Math.round((100 * task) / wall)}%) | script ${script.toFixed(1)} s | style+layout ${layout.toFixed(1)} s`);

// Self time per node
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = profile.timeDeltas;
profile.samples.forEach((id, i) => self.set(id, (self.get(id) || 0) + (dt[i] || 0)));
const total = [...self.values()].reduce((a, b) => a + b, 0);
const fn = new Map();
const file = new Map();
for (const [id, us] of self) {
  const n = byId.get(id);
  const f = n.callFrame;
  const url = f.url.replace(/^https?:\/\/[^/]+\//, '').replace(/\?.*$/, '') || '(native)';
  const name = `${f.functionName || '(anon)'}  ${url}:${f.lineNumber + 1}`;
  if (f.functionName === '(idle)' || f.functionName === '(program)') continue;
  fn.set(name, (fn.get(name) || 0) + us);
  const short = url.includes('node_modules') ? url.replace(/.*node_modules\/(\.vite\/deps\/)?/, 'deps/') : url;
  file.set(short, (file.get(short) || 0) + us);
}
const pct = (us) => `${((100 * us) / total).toFixed(1)}%`;
console.log('\nTop functions (self time):');
[...fn].sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, v]) => console.log(`  ${pct(v).padStart(6)}  ${k}`));
console.log('\nBy file:');
[...file].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, v]) => console.log(`  ${pct(v).padStart(6)}  ${k}`));
const idle = [...self].filter(([id]) => byId.get(id).callFrame.functionName === '(idle)').reduce((a, [, v]) => a + v, 0);
console.log(`\nidle share of samples: ${pct(idle)}`);
await browser.close();
