// Tempo detection diagnostics: runs every stage of the BPM detector (bpmDiagnostics in
// src/audio/BpmDetector.ts) in Chrome on songs from the audio cache, to see why songs are or
// aren't trusted for beatmatching. Needs "npm run dev". Nothing is fetched from YouTube: the
// songs are served from cache/audio.
//
//   node qa/bpmDiagnostics.mjs [count=30]        (the most recently cached songs)
//   node qa/bpmDiagnostics.mjs --ids a,b,c       (these video ids)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const idsArg = args.includes('--ids') ? args[args.indexOf('--ids') + 1].split(',') : null;
const count = Number(args.find((a) => /^\d+$/.test(a)) ?? 30);
const cacheDir = path.join(root, 'cache', 'audio');
const ids =
  idsArg ??
  fs
    .readdirSync(cacheDir)
    .filter((f) => f.endsWith('.audio'))
    .map((f) => ({ id: f.slice(0, -6), t: fs.statSync(path.join(cacheDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .slice(0, count)
    .map((x) => x.id);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5173/src/audio/BpmDetector.ts'); // any page on the app's origin
const rows = [];
for (const id of ids) {
  const r = await page.evaluate(async (videoId) => {
    try {
      const { bpmDiagnostics } = await import('/src/audio/BpmDetector.ts');
      const res = await fetch(`/api/stream?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`);
      if (!res.ok) return { error: `HTTP ${res.status}` };
      const ctx = new OfflineAudioContext(2, 44100, 44100);
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      const d = bpmDiagnostics(buf);
      const pick = (x) => ({ bpm: x.bpm, c: x.confidence });
      return { duration: Math.round(buf.duration), final: pick(d.final), low: pick(d.low), all: pick(d.all), windows: d.windows.map((w) => ({ s: w.start, low: pick(w.low), all: pick(w.all) })) };
    } catch (err) {
      return { error: String(err) };
    }
  }, id);
  rows.push({ id, ...r });
  if (r.error) {
    console.log(`${id}  ${r.error}`);
    continue;
  }
  const w = r.windows.map((x) => `${x.low.bpm}/${x.low.c}|${x.all.bpm}/${x.all.c}`).join('  ');
  console.log(`${id} ${String(r.duration).padStart(3)}s  final ${r.final.bpm}/${r.final.c}  low ${r.low.bpm}/${r.low.c}  all ${r.all.bpm}/${r.all.c}  windows(low|all) ${w}`);
}
fs.mkdirSync(path.join(root, 'qa', 'out'), { recursive: true });
fs.writeFileSync(path.join(root, 'qa', 'out', 'bpm-diagnostics.json'), JSON.stringify(rows, null, 2));
await browser.close();
