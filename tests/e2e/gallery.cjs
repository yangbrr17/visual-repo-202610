#!/usr/bin/env node
/*
 * Gallery route crawler: file:// and http:// (python3 -m http.server), every route,
 * no console errors, no failed blocks, no horizontal overflow; screenshots of a subset.
 *   python3 tools/build_catalog.py && node tests/e2e/gallery.cjs [--proto file|http|both] [--routes r1,r2] [--no-shots] [--mobile]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
let playwright;
try { playwright = require('playwright'); } catch (e) { playwright = require(process.env.PLAYWRIGHT_PATH || '/opt/node-tools/node_modules/playwright'); }
const { chromium } = playwright;

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'tests/screens/gallery');
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const proto = arg('proto', 'both');
const shots = !args.includes('--no-shots');
const mobileOnly = args.includes('--mobile');

const G = (() => { const s = fs.readFileSync(path.join(ROOT, 'gallery/catalog.js'), 'utf8'); const w = {}; new Function('window', s)(w); return w.RK_GALLERY; })();
let routes = ['', 'design', 'data', 'landscape']
  .concat(G.categories.filter(c => G.components.some(m => m.category === c.id)).map(c => 'cat/' + c.id))
  .concat(G.components.map(c => 'c/' + c.id));
if (arg('routes')) routes = arg('routes').split(',').map(r => r === '/' ? '' : r);

const SHOTS = {
  '': 'overview', 'design': 'design', 'data': 'data', 'landscape': 'landscape',
  'cat/valuation': 'cat-valuation', 'cat/geo': 'cat-geo', 'cat/trend': 'cat-trend',
  'c/football-field': 'c-football-field', 'c/price-volume': 'c-price-volume', 'c/sankey': 'c-sankey',
  'c/comps-table': 'c-comps-table', 'c/param-slider': 'c-param-slider', 'c/kpi-tiles': 'c-kpi-tiles', 'c/query-console': 'c-query-console', 'c/choropleth': 'c-choropleth'
};

async function crawl(browser, base, label, viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  let current = '';
  page.on('pageerror', e => errors.push(`[${current}] pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`[${current}] console: ${m.text().slice(0, 300)}`); });
  page.on('requestfailed', r => errors.push(`[${current}] requestfailed: ${r.url()}`));
  await page.goto(base + 'gallery/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.RK && RK.runtime && RK.runtime.booted && !document.getElementById('g-boot'), null, { timeout: 30000 });
  const problems = [];
  let nBlocks = 0, nRendered = 0;
  const t0 = Date.now();
  for (const r of routes) {
    current = '#/' + r;
    await page.evaluate(h => { location.hash = h; }, '#/' + r);
    await page.waitForTimeout(250);
    // scroll through to trigger lazy blocks
    await page.evaluate(async () => {
      const H = document.documentElement.scrollHeight;
      for (let y = 0; y < H; y += 400) { window.scrollTo(0, y); await new Promise(res => setTimeout(res, 140)); }
      for (let y = H; y >= 0; y -= 500) { window.scrollTo(0, y); await new Promise(res => setTimeout(res, 40)); }
    });
    await page.waitForTimeout(700);
    // lazy blocks the quick scroll passed over: bring each into view (what a reader does)
    for (let pass = 0; pass < 2; pass++) {
      for (const id of await page.evaluate(() => RK.blocks().filter(b => b.state === 'idle').map(b => b.id))) {
        await page.evaluate(id => { const e = document.getElementById(id); if (e) e.scrollIntoView({ block: 'center' }); }, id);
        await page.waitForTimeout(800);
      }
    }
    const st = await page.evaluate(() => {
      const bl = RK.blocks();
      const doc = document.documentElement;
      return {
        title: (document.querySelector('.g-page h1') || {}).textContent || '',
        notFound: /Not found/.test((document.querySelector('.g-page h1') || {}).textContent || ''),
        blocks: bl.map(b => ({ id: b.id, c: b.component, state: b.state, msg: b._errorEl ? b._errorEl.textContent : '' })),
        overflowX: doc.scrollWidth - doc.clientWidth,
        culprit: (() => { const W = doc.clientWidth, o = []; document.querySelectorAll('.g-main *').forEach(el => { const r = el.getBoundingClientRect(); if (r.right > W + 1) { let p = el.parentElement, outer = true; while (p && p !== document.body) { if (p.getBoundingClientRect().right > W + 1) { outer = false; break; } p = p.parentElement; } if (outer) o.push(el.tagName + '.' + String(el.className).slice(0, 40) + ' ' + Math.round(r.right)); } }); return o.slice(0, 4).join(' | '); })()
      };
    });
    nBlocks += st.blocks.length;
    nRendered += st.blocks.filter(b => b.state === 'rendered').length;
    const bad = st.blocks.filter(b => b.state === 'error' || b.state === 'idle');
    if (st.notFound) problems.push(`${current}: Not found`);
    if (bad.length) problems.push(`${current}: blocks ${bad.map(b => b.c + '=' + b.state + (b.msg ? ' (' + b.msg + ')' : '')).join(', ')}`);
    if (st.overflowX > 1) problems.push(`${current}: horizontal overflow ${st.overflowX}px (${st.culprit})`);
    if (shots && SHOTS[r] !== undefined) {
      await page.evaluate(() => window.scrollTo(0, 0));
      const H = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewportSize({ width: viewport.width, height: Math.min(H, 5000) });
      await page.waitForTimeout(1200);
      fs.mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: path.join(OUT, `${label}-${SHOTS[r]}.png`) });
      await page.setViewportSize(viewport);
      await page.waitForTimeout(300);
    }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`${label}: ${routes.length} routes in ${secs}s, ${nBlocks} live blocks (${nRendered} rendered), ${problems.length} problems, ${errors.length} console errors`);
  problems.forEach(p => console.log('   PROBLEM ' + p));
  errors.slice(0, 40).forEach(e => console.log('   ERROR ' + e));
  await page.close();
  return problems.length + errors.length;
}

(async () => {
  const browser = await chromium.launch();
  let fails = 0;
  let server = null;
  try {
    if (mobileOnly) {
      fails += await crawl(browser, 'file://' + ROOT + '/', 'mobile390', { width: 390, height: 844 });
    } else {
      if (proto === 'file' || proto === 'both') fails += await crawl(browser, 'file://' + ROOT + '/', 'file', { width: 1440, height: 900 });
      if (proto === 'http' || proto === 'both') {
        const port = 8000 + Math.floor(Math.random() * 900);
        server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
        await new Promise(r => setTimeout(r, 1200));
        fails += await crawl(browser, `http://127.0.0.1:${port}/`, 'http', { width: 1440, height: 900 });
      }
    }
  } finally {
    if (server) server.kill();
    await browser.close();
  }
  console.log(fails ? `\n${fails} FAILURES` : '\nALL OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
