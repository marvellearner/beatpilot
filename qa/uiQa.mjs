// UI/UX regression check: clicks the real buttons and checks the screen keeps up with the engine
// (nothing frozen or stale). Party console, Up Next, search, moods, favourites, Previous, Pro decks
// and the phone remote. Needs "npm run dev".   node qa/uiQa.mjs
import { chromium } from 'playwright-core';

const BASE = 'http://127.0.0.1:5173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text().slice(0, 160)));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.locator('#party-console-prev-button').waitFor({ timeout: 60_000 });
await sleep(3000);
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
});
check('engine found', await page.evaluate(() => !!window.__e));
check('no error-boundary fallback', !(await page.locator('text=Glitch Prevented').count()));

const text = (sel) => page.locator(sel).first().textContent({ timeout: 3000 }).catch(() => null);
const times = (s) => (s || '').match(/\d+:\d{2}/g) || [];
const until = async (fn, ms, step = 500) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(step);
  }
  return null;
};

// --- Up Next fills and rows match the engine (statuses not stale) ---
await until(() => page.evaluate(() => window.__e.queue.length >= 5), 120_000, 1000);
async function rowsVsEngine() {
  return page.evaluate(() => {
    const e = window.__e;
    const cur = (e.activeDeck === 'A' ? e.deckA : e.deckB).getTrack()?.id;
    const items = e.queue.filter((q) => q.id !== cur);
    const rows = [...document.querySelectorAll('#party-console-queue-list [id^="party-console-queue-item-"]')];
    const mismatches = [];
    items.forEach((q) => {
      const el = document.getElementById(`party-console-queue-item-${q.id}`);
      if (!el) return mismatches.push(`${q.title.slice(0, 30)}: no row`);
      const t = el.textContent.toUpperCase();
      const want = q.status === 'ready' ? 'READY' : q.status.toUpperCase();
      if (!t.includes(want)) mismatches.push(`${q.title.slice(0, 30)}: engine ${q.status}, row shows other`);
    });
    return { engine: items.length, rows: rows.length, mismatches, statuses: items.map((q) => q.status) };
  });
}
// Let statuses move (downloads finish), then compare 2 s after the engine's last change
let staleSeen = [];
for (let i = 0; i < 6; i++) {
  await sleep(4000);
  const a = await rowsVsEngine();
  await sleep(2000);
  const b = await rowsVsEngine();
  if (JSON.stringify(a.statuses) === JSON.stringify(b.statuses) && b.mismatches.length) staleSeen = b.mismatches;
}
const rv = await rowsVsEngine();
check('Up Next row count matches engine', rv.engine === rv.rows, `engine ${rv.engine}, rows ${rv.rows}`);
check('Up Next statuses not stale', staleSeen.length === 0, staleSeen.slice(0, 4).join('; '));

// --- Start playing with the hero row's MIX NOW button ---
await until(() => page.evaluate(() => window.__e.queue.some((q) => q.status === 'ready')), 180_000, 1000);
const firstReady = await page.evaluate(() => window.__e.queue.find((q) => q.status === 'ready').id);
await page.locator(`#party-console-queue-item-${firstReady} button:has-text("MIX")`).first().click();
const started = await until(() => page.evaluate(() => (window.__e.activeDeck === 'A' ? window.__e.deckA : window.__e.deckB).getPlaybackState().isPlaying), 30_000);
check('MIX NOW starts playback', !!started);
await sleep(2500);
const title = await page.evaluate(() => (window.__e.activeDeck === 'A' ? window.__e.deckA : window.__e.deckB).getTrack()?.title);
const info = await text('#party-console-now-playing');
check('Now Playing shows the on-air song', !!title && (info || '').includes(title.slice(0, 15)), title?.slice(0, 40));
const st1 = await text('#party-console-deck-status');
check('deck status shows ON AIR', /ON AIR/i.test(st1 || ''), st1?.trim());
const t1 = times(await text('#party-console-now-playing'));
await sleep(3000);
const t2 = times(await text('#party-console-now-playing'));
check('Now Playing clock advances', JSON.stringify(t1) !== JSON.stringify(t2), `${t1.join(' ')} -> ${t2.join(' ')}`);

// --- Play / pause button ---
await page.locator('#party-console-play-pause-button').click();
await sleep(800);
const paused = await page.evaluate(() => !(window.__e.activeDeck === 'A' ? window.__e.deckA : window.__e.deckB).getPlaybackState().isPlaying);
const st2 = await text('#party-console-deck-status');
check('Pause works and shows PAUSED', paused && /PAUSED/i.test(st2 || ''), st2?.trim());
await page.locator('#party-console-play-pause-button').click();
await sleep(800);
check('Play resumes', await page.evaluate(() => (window.__e.activeDeck === 'A' ? window.__e.deckA : window.__e.deckB).getPlaybackState().isPlaying));

// --- Mood buttons ---
const moodBefore = await page.evaluate(() => window.__e.mood);
const target = moodBefore === 'party' ? 'normal' : 'party';
const cls0 = await page.locator(`#mood-eq-mood-${target}`).getAttribute('class');
await page.locator(`#mood-eq-mood-${target}`).click();
await sleep(800);
const cls1 = await page.locator(`#mood-eq-mood-${target}`).getAttribute('class');
check(`mood button switches to ${target}`, (await page.evaluate(() => window.__e.mood)) === target && cls0 !== cls1);
await page.locator(`#mood-eq-mood-${moodBefore}`).click();
await sleep(500);

// --- Favourite button on Now Playing ---
const fav0 = await page.evaluate(() => window.__e.isFavorite((window.__e.activeDeck === 'A' ? window.__e.deckA : window.__e.deckB).getTrack()));
const favHtml0 = await page.locator('#party-console-favorite-btn').innerHTML();
await page.locator('#party-console-favorite-btn').click();
await sleep(1500);
const fav1 = await page.evaluate(() => window.__e.isFavorite((window.__e.activeDeck === 'A' ? window.__e.deckA : window.__e.deckB).getTrack()));
const favHtml1 = await page.locator('#party-console-favorite-btn').innerHTML();
check('favourite button toggles and redraws', fav0 !== fav1 && favHtml0 !== favHtml1);
await page.locator('#party-console-favorite-btn').click(); // put it back
await sleep(1000);

// --- Up Next: move to top and remove ---
const ids = await page.evaluate(() => {
  const cur = (window.__e.activeDeck === 'A' ? window.__e.deckA : window.__e.deckB).getTrack()?.id;
  return window.__e.queue.filter((q) => q.id !== cur).map((q) => q.id);
});
if (ids.length >= 4) {
  await page.locator(`#party-console-queue-item-${ids[3]} button[title^="Play Next"]`).click();
  await sleep(1000);
  const firstRow = await page.locator('#party-console-queue-list [id^="party-console-queue-item-"]').first().getAttribute('id');
  check('Play Next moves the row to #1', firstRow === `party-console-queue-item-${ids[3]}`);
  const n0 = await page.locator('#party-console-queue-list [id^="party-console-queue-item-"]').count();
  await page.locator(`#party-console-queue-item-${ids[2]} button[title="Remove from queue"]`).click();
  await sleep(1000);
  const gone = !(await page.locator(`#party-console-queue-item-${ids[2]}`).count());
  const n1 = await page.locator('#party-console-queue-list [id^="party-console-queue-item-"]').count();
  check('Remove deletes the row', gone, `${n0} -> ${n1} rows (queue refills itself)`);
}

// --- Next (mix) and the MIXING status ---
await until(() => page.evaluate(() => window.__e.queue.some((q) => q.status === 'ready' && q.audioBuffer)), 120_000, 1000);
const before = title;
await page.locator('#party-console-next-button').click();
const sawMixing = await until(async () => /MIX/i.test((await text('#party-console-deck-status')) || ''), 15_000, 250);
check('Next shows MIXING / MIX IN status', !!sawMixing, (await text('#party-console-deck-status'))?.trim());
await page.locator('#party-console-next-button').click(); // second press = mix now
const changed = await until(async () => {
  const t = await page.evaluate(() => (window.__e.activeDeck === 'A' ? window.__e.deckA : window.__e.deckB).getTrack()?.title);
  return t && t !== before ? t : null;
}, 90_000, 1000);
await sleep(2000);
const info2 = await text('#party-console-now-playing');
check('after mix, Now Playing shows the new song', !!changed && (info2 || '').includes(changed.slice(0, 15)), changed?.slice(0, 40));
await until(() => page.evaluate(() => !window.__e.isTransitioning), 60_000);
const prevList = await page.locator('#previously-played-list [id^="previously-played-item-"]').count();
check('Previously Played lists songs', prevList >= 1, `${prevList} entries`);

// --- Previous button ---
await page.locator('#party-console-prev-button').click();
const back = await until(async () => {
  const t = await page.evaluate(() => (window.__e.activeDeck === 'A' ? window.__e.deckA : window.__e.deckB).getTrack()?.title);
  return t === before ? t : null;
}, 30_000, 500);
await sleep(1500);
check('Previous goes back to the earlier song', !!back && ((await text('#party-console-now-playing')) || '').includes(before.slice(0, 15)));

// --- Another mix after that (each mix goes to the other deck; both directions must work) ---
await until(() => page.evaluate(() => !window.__e.isTransitioning), 30_000);
await until(() => page.evaluate(() => window.__e.queue.some((q) => q.status === 'ready' && q.audioBuffer)), 120_000, 1000);
const t3 = await page.evaluate(() => (window.__e.activeDeck === 'A' ? window.__e.deckA : window.__e.deckB).getTrack()?.title);
const deck3 = await page.evaluate(() => window.__e.activeDeck);
await page.locator('#party-console-next-button').click();
await sleep(1500);
await page.locator('#party-console-next-button').click(); // second press = mix now
const t4 = await until(async () => {
  const t = await page.evaluate(() => (window.__e.activeDeck === 'A' ? window.__e.deckA : window.__e.deckB).getTrack()?.title);
  return t && t !== t3 ? t : null;
}, 60_000, 1000);
await until(() => page.evaluate(() => !window.__e.isTransitioning), 60_000);
const xf = await page.evaluate(() => ({ deck: window.__e.activeDeck, xf: window.__e.crossfaderPosition }));
check(`next mix works from deck ${deck3} (crossfader follows)`, !!t4 && xf.deck !== deck3 && Math.sign(xf.xf) === (xf.deck === 'A' ? -1 : 1), `${(t4 || 'no change').slice(0, 30)}, deck ${xf.deck}, crossfader ${xf.xf}`);

// --- Search ---
const input = page.locator('input[placeholder^="Search song"]').first();
await input.fill('goliya honey singh');
const found = await until(async () => (await page.locator('[id^="party-console-search-item-"]').count()) || null, 30_000);
check('search shows results', !!found, `${found || 0} results`);
await input.fill('');
await sleep(500);

// --- Pro decks: telemetry must move while the song plays ---
await page.locator('#app-view-switcher button:has-text("Pro")').click();
await page.locator('#deck-a').waitFor({ timeout: 10_000 });
await sleep(1500);
const active = await page.evaluate(() => window.__e.activeDeck.toLowerCase());
const p1 = await text(`#deck-${active}`);
await sleep(3000);
const p2 = await text(`#deck-${active}`);
check('Pro deck display updates while playing', p1 !== p2, `${times(p1).slice(0, 2).join(' ')} -> ${times(p2).slice(0, 2).join(' ')}`);
const playBtn = page.locator(`#deck-${active}-play-pause-button`);
const b0 = await playBtn.innerHTML();
await playBtn.click();
await sleep(800);
const b1 = await playBtn.innerHTML();
check('Pro deck play/pause button redraws', b0 !== b1);
await playBtn.click();
await sleep(500);
const xf0 = await page.locator('#mixer-transition-progress').count();
check('Pro mixer present', (await page.locator('#mixer').count()) > 0 && xf0 >= 0);
await page.locator('#app-view-switcher button:has-text("Party")').click();
await sleep(1000);

// --- Phone remote shows the same song ---
const remote = await browser.newPage({ viewport: { width: 390, height: 844 } });
const rErrors = [];
remote.on('pageerror', (e) => rErrors.push(e.message.slice(0, 200)));
await remote.goto(BASE + '?remote=true', { waitUntil: 'domcontentloaded' });
// The phone follows the host tab (the first AI DJ tab open), which may not be this test tab
const isHost = !(await page.locator('#app-standby-banner').count());
const nowTitle = await page.evaluate(() => (window.__e.activeDeck === 'A' ? window.__e.deckA : window.__e.deckB).getTrack()?.title);
const rOk = await until(async () => {
  const body = (await remote.locator('body').textContent()) || '';
  const sections = ['#remote-queue', '#remote-ai-header'].every((s) => body && s);
  return isHost ? body.includes(nowTitle.slice(0, 15)) : sections && (await remote.locator('#remote-queue').count()) > 0;
}, 20_000);
check(isHost ? 'phone remote shows the on-air song' : 'phone remote shows the host tab (Up Next present)', !!rOk, isHost ? nowTitle?.slice(0, 40) : 'this test tab is standby');
check('phone remote has no page errors', rErrors.length === 0, rErrors.join(' | '));

check('no page errors on the laptop page', errors.filter((e) => !/favicon|youtube|ERR_|Failed to load resource/i.test(e)).length === 0, errors.slice(0, 5).join(' | '));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
await browser.close();
