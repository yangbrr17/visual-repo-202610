#!/usr/bin/env node
/*
 * Static thumbnails of the demo pitchbook pages for the gallery overview (hero + film strip).
 *
 *   python3 py/examples/build_demo.py          # build examples/demo-pitchbook/ first
 *   node tools/thumbs.cjs                      # -> gallery/thumbs/demo-<page>.jpg + gallery/thumbs/thumbs.json
 *   python3 tools/build_catalog.py             # embeds thumbs.json into gallery/catalog.js (works from file://)
 *
 * Options: --pages summary,valuation,...  --width 1440  --scale 0.6  --quality 82
 * Pages are rendered with reduced motion at a 1440 px wide window (the 16:9 design width), then
 * downscaled by --scale. Needs Playwright + Chromium (PLAYWRIGHT_PATH or /opt/node-tools/node_modules).
 */
'use strict';
const fs = require('fs');
const path = require('path');

let playwright;
try { playwright = require('playwright'); } catch (e) {
  playwright = require(process.env.PLAYWRIGHT_PATH || '/opt/node-tools/node_modules/playwright');
}

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function opt(name, dflt) { const i = args.indexOf('--' + name); return i < 0 ? dflt : args[i + 1]; }
const REPORT = path.resolve(ROOT, opt('report', 'examples/demo-pitchbook/index.html'));
const OUT = path.join(ROOT, 'gallery/thumbs');
const width = +opt('width', 1440);
const scale = +opt('scale', 0.6);
const quality = +opt('quality', 82);
// hero first; the rest form the overview film strip (in this order)
const PAGES = opt('pages', 'summary,valuation,comps,financials,footprint,what-if,precedents,timetable').split(',');

(async () => {
  if (!fs.existsSync(REPORT)) { console.error(`missing ${path.relative(ROOT, REPORT)} — run python3 py/examples/build_demo.py first`); process.exit(1); }
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: scale, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + REPORT, { waitUntil: 'load' });
  await page.waitForFunction(() => window.RK && RK.runtime && RK.runtime.booted && RK.blocks().length > 0, null, { timeout: 30000 });
  const all = await page.$$eval('section.rk-page', els => els.map(e => ({
    id: e.id,
    kicker: ((e.querySelector('.rk-page__kicker') || {}).textContent || e.getAttribute('data-rk-page') || '').trim(),
    title: ((e.querySelector('.rk-page__title, .rk-cover__title, .rk-section__title') || {}).textContent || '').trim()
  })));
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (/^demo-.*\.jpg$/.test(f)) fs.unlinkSync(path.join(OUT, f));
  const thumbs = [];
  for (const id of PAGES) {
    const meta = all.find(p => p.id === id);
    if (!meta) { console.warn(`  skip: no page #${id}`); continue; }
    const loc = page.locator('#' + id);
    await loc.scrollIntoViewIfNeeded();
    await page.waitForFunction(id => RK.blocks().filter(b => document.getElementById(id).contains(b.el)).every(b => b.state !== 'idle'), id, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(900);
    await page.mouse.move(0, 0);
    const file = `demo-${id}.jpg`;
    await loc.screenshot({ path: path.join(OUT, file), type: 'jpeg', quality });
    const box = await loc.boundingBox();
    thumbs.push({ kind: 'demo', page: id, file, kicker: meta.kicker, title: meta.title, hero: thumbs.length === 0,
      w: Math.round(box.width * scale), h: Math.round(box.height * scale) });
    console.log(`  ${file}  ${(fs.statSync(path.join(OUT, file)).size / 1024).toFixed(0)} KB  ${meta.title.slice(0, 70)}`);
  }
  const manifest = { generated: new Date().toISOString().slice(0, 10), report: path.relative(ROOT, REPORT), pages: all.length, thumbs };
  fs.writeFileSync(path.join(OUT, 'thumbs.json'), JSON.stringify(manifest, null, 1) + '\n');
  await browser.close();
  if (errors.length) { console.error('console errors:\n  ' + errors.join('\n  ')); process.exit(1); }
  console.log(`${thumbs.length} thumbnails of ${all.length} pages -> ${path.relative(ROOT, OUT)}/ (run python3 tools/build_catalog.py next)`);
})().catch(e => { console.error(e); process.exit(2); });
