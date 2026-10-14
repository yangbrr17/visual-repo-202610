#!/usr/bin/env node
/*
 * Gallery e2e: file:// and http:// (python3 -m http.server).
 *   1. crawl   every route: no console errors, no failed blocks, no horizontal overflow, the page has a title
 *   2. samples click through every sample of the geo components (and of any component with manifest optionDeps):
 *              each renders; the 1:50m basemap (vendor geo-world-50m, 756 KB) is never preloaded — it arrives on demand
 *              when a world-50m sample is shown, from the folder next to world-110m.js
 *   3. keys    / focuses search, ↑ ↓ Enter open a hit, Esc closes, ← → previous / next component
 *   4. lang    default EN (meta rk:locale = en, k / m / bn units); EN → 中文 → EN round trip re-mounts previews with
 *              RK.i18n zh-CN (万 / 亿) and back to identical English text; 中文 booted from storage == 中文 toggled
 *   5. shots   overview / category / component / design at 1440 and 390 px in navy and ink (file:// only)
 *
 *   python3 tools/build_catalog.py && node tests/e2e/gallery.cjs [--proto file|http|both] [--routes r1,r2] [--no-shots]
 *        [--mobile] [--skip-crawl] [--all-samples]
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
const skipCrawl = args.includes('--skip-crawl');
const allSamples = args.includes('--all-samples');
const LANG_KEY = 'rk-gallery:lang';

const G = (() => { const s = fs.readFileSync(path.join(ROOT, 'gallery/catalog.js'), 'utf8'); const w = {}; new Function('window', s)(w); return w.RK_GALLERY; })();
let routes = ['', 'design', 'data', 'landscape']
  .concat(G.categories.filter(c => G.components.some(m => m.category === c.id)).map(c => 'cat/' + c.id))
  .concat(G.components.map(c => 'c/' + c.id));
if (arg('routes')) routes = arg('routes').split(',').map(r => r === '/' ? '' : r);
const SAMPLE_COMPS = G.components.filter(c => allSamples || c.category === 'geo' || c.optionDeps).map(c => c.id);
// vendor packages no component lists in its deps (e.g. geo-world-50m, only named by manifest optionDeps): never requested up front
const ON_DEMAND = G.vendor.filter(v => v.preload === false || v.onDemand || !G.components.some(c => (c.deps || []).indexOf(v.id) >= 0)).map(v => v.id);

const SHOTS = {
  '': 'overview', 'design': 'design', 'data': 'data', 'landscape': 'landscape',
  'cat/valuation': 'cat-valuation', 'cat/geo': 'cat-geo', 'cat/trend': 'cat-trend',
  'c/football-field': 'c-football-field', 'c/price-volume': 'c-price-volume', 'c/sankey': 'c-sankey',
  'c/comps-table': 'c-comps-table', 'c/param-slider': 'c-param-slider', 'c/kpi-tiles': 'c-kpi-tiles', 'c/query-console': 'c-query-console', 'c/choropleth': 'c-choropleth'
};
const THEME_SHOTS = { routes: ['', 'cat/valuation', 'c/choropleth', 'design'], widths: [1440, 390], themes: ['navy', 'ink'] };

const booted = page => page.waitForFunction(() => window.RK && RK.runtime && RK.runtime.booted && !document.getElementById('g-boot') && document.querySelector('.g-page'), null, { timeout: 30000 });
async function go(page, r) {
  await page.evaluate(h => { if (location.hash === h) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = h; }, '#/' + r);
  await page.waitForTimeout(250);
}
/** Wait until no block is still rendering (idle lazy blocks off-screen are left alone). */
async function settled(page, ms) {
  await page.waitForFunction(() => RK.blocks().every(b => b.state !== 'rendering' && b.state !== 'pending'), null, { timeout: ms || 10000 }).catch(() => {});
  await page.waitForTimeout(600);
}
const mainText = page => page.evaluate(() => document.querySelector('.g-main').innerText.replace(/\s+/g, ' ').trim());
function firstDiff(a, b) { for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return `…${a.slice(Math.max(0, i - 50), i + 50)}… vs …${b.slice(Math.max(0, i - 50), i + 50)}…`; return ''; }

async function crawlRoutes(page, ctx) {
  let nBlocks = 0, nRendered = 0;
  const t0 = Date.now();
  for (const r of routes) {
    ctx.current = '#/' + r;
    await go(page, r);
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
        h1: (document.querySelector('.g-page h1') || {}).textContent || '',
        title: document.title,
        blocks: bl.map(b => ({ id: b.id, c: b.component, state: b.state, msg: b._errorEl ? b._errorEl.textContent : '' })),
        overflowX: doc.scrollWidth - doc.clientWidth,
        culprit: (() => { const W = doc.clientWidth, o = []; document.querySelectorAll('.g-main *').forEach(el => { const r = el.getBoundingClientRect(); if (r.right > W + 1) { let p = el.parentElement, outer = true; while (p && p !== document.body) { if (p.getBoundingClientRect().right > W + 1) { outer = false; break; } p = p.parentElement; } if (outer) o.push(el.tagName + '.' + String(el.className).slice(0, 40) + ' ' + Math.round(r.right)); } }); return o.slice(0, 4).join(' | '); })()
      };
    });
    nBlocks += st.blocks.length;
    nRendered += st.blocks.filter(b => b.state === 'rendered').length;
    const bad = st.blocks.filter(b => b.state === 'error' || b.state === 'idle');
    if (/Not found/.test(st.h1)) ctx.problems.push(`${ctx.current}: Not found`);
    if (r && !/ · ReportKit/.test(st.title)) ctx.problems.push(`${ctx.current}: document title "${st.title}" does not name the page`);
    if (bad.length) ctx.problems.push(`${ctx.current}: blocks ${bad.map(b => b.c + '=' + b.state + (b.msg ? ' (' + b.msg + ')' : '')).join(', ')}`);
    if (st.overflowX > 1) ctx.problems.push(`${ctx.current}: horizontal overflow ${st.overflowX}px (${st.culprit})`);
    if (shots && SHOTS[r] !== undefined) await shoot(page, path.join(OUT, `${ctx.label}-${SHOTS[r]}.png`), ctx.viewport);
  }
  return { nBlocks, nRendered, secs: ((Date.now() - t0) / 1000).toFixed(0) };
}

async function shoot(page, file, viewport) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const H = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: viewport.width, height: Math.min(H, 5000) });
  await page.waitForTimeout(1200);
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: file });
  await page.setViewportSize(viewport);
  await page.waitForTimeout(300);
}

/** 2. every sample of the geo / optionDeps components; on-demand vendor packages arrive only when needed. */
async function checkSamples(page, ctx) {
  const early = ctx.requests.filter(u => ON_DEMAND.some(id => u.indexOf('/vendor/' + id + '/') >= 0));
  if (early.length) ctx.problems.push(`vendor: on-demand packages requested before any sample needed them: ${early.join(', ')}`);
  let n = 0;
  for (const id of SAMPLE_COMPS) {
    ctx.current = '#/c/' + id + ' samples';
    await go(page, 'c/' + id);
    await settled(page);
    const count = Math.max(1, await page.$$eval('.g-variant', b => b.length));
    for (let i = 0; i < count; i++) {
      if (count > 1) await page.click(`.g-variant[data-sample="${i}"]`);
      await page.waitForTimeout(300);
      await settled(page, 15000);
      const s = await page.evaluate(() => {
        const b = RK.blocks().filter(x => x.el.closest('.g-stage'))[0];
        return { state: b && b.state, msg: b && b._errorEl ? b._errorEl.textContent : '', title: (document.querySelector('.g-stage .rk-page__title') || {}).textContent,
          sources: [].filter.call(document.querySelectorAll('.g-stage .rk-page__source, .g-stage .rk-block__foot, .g-stage .rk-block__foot *'), e => /^\s*(Source|资料来源)/.test(e.textContent)).length };
      });
      const sample = (G.components.find(c => c.id === id).samples || [])[i] || {};
      const basemap = sample.options && sample.options.basemap;
      if (basemap && basemap !== 'world-110m') {
        // the component draws world-110m first and re-renders once the finer basemap has loaded
        const ok = await page.waitForFunction(b => RK.geo.has(b), basemap, { timeout: 15000 }).then(() => true, () => false);
        if (!ok) ctx.problems.push(`${ctx.current} ${i + 1}: basemap ${basemap} was not loaded on demand`);
        await settled(page);
      }
      n++;
      if (s.state !== 'rendered') ctx.problems.push(`${ctx.current} ${i + 1} "${s.title}": ${s.state}${s.msg ? ' (' + s.msg + ')' : ''}`);
      if (s.sources !== 1) ctx.problems.push(`${ctx.current} ${i + 1}: ${s.sources} source lines on the stage (want exactly 1)`);
    }
  }
  const lazy = ctx.requests.filter(u => /\/vendor\/geo-world-50m\/world-50m\.js/.test(u));
  if (SAMPLE_COMPS.some(id => (G.components.find(c => c.id === id).samples || []).some(s => s.options && s.options.basemap === 'world-50m')) && !lazy.length) {
    ctx.problems.push('vendor: world-50m.js was never requested although a 1:50m sample was shown');
  }
  return n;
}

/** 3. keyboard: / search, ↑ ↓ Enter, Esc, ← → */
async function checkKeys(page, ctx) {
  ctx.current = 'keys';
  const P = m => ctx.problems.push('keys: ' + m);
  const ids = G.components.map(c => c.id);
  await go(page, 'c/' + ids[1]);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('/');
  if (!await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('g-search__input'))) P('/ does not focus the search box');
  await page.keyboard.type('sankey');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  if (await page.evaluate(() => location.hash) !== '#/c/sankey') P('Enter on the first hit does not open #/c/sankey');
  await page.keyboard.press('/');
  await page.keyboard.type('bar');
  await page.keyboard.press('ArrowDown');
  const want = await page.$eval('.g-search__hit.is-active', a => a.getAttribute('href')).catch(() => null);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  if (!want || await page.evaluate(() => location.hash) !== want) P('ArrowDown + Enter does not open the highlighted hit');
  await page.keyboard.press('/');
  await page.keyboard.type('zzzzqq');
  if (!await page.$('.g-search__out.is-open .g-search__none')) P('no empty state for a search without hits');
  await page.keyboard.press('Escape');
  if (await page.$('.g-search__out.is-open')) P('Esc does not close the search results');
  await page.keyboard.press('Escape');
  const i = 5;
  await go(page, 'c/' + ids[i]);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  if (await page.evaluate(() => location.hash) !== '#/c/' + ids[i + 1]) P('ArrowRight does not open the next component');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(400);
  if (await page.evaluate(() => location.hash) !== '#/c/' + ids[i]) P('ArrowLeft does not open the previous component');
}

/** 4. language: default EN, EN -> 中文 -> EN round trip, 中文 from storage == 中文 toggled */
async function checkLang(page, ctx) {
  ctx.current = 'lang';
  const P = m => ctx.problems.push('lang: ' + m);
  const state = () => page.evaluate(k => ({ html: document.documentElement.lang, meta: (document.querySelector('meta[name="rk:locale"]') || {}).content,
    rk: RK.i18n.locale, stored: (() => { try { return localStorage.getItem(k); } catch (e) { return 'n/a'; } })(), title: document.title,
    nav: document.querySelector('.g-nav').innerText }), LANG_KEY);
  const r = 'c/price-volume';
  await go(page, r);
  await settled(page);
  const s0 = await state();
  if (s0.html !== 'en' || s0.meta !== 'en' || s0.rk !== 'en') P(`default locale is not English: ${JSON.stringify([s0.html, s0.meta, s0.rk])}`);
  const en1 = await mainText(page);
  if (/[万亿]/.test(en1)) P('English previews show 万 / 亿 units');
  await page.click('.g-lang__btn[data-lang="zh"]');
  await page.waitForTimeout(400);
  await settled(page);
  const s1 = await state(), zh = await mainText(page);
  if (s1.html !== 'zh-CN' || s1.rk !== 'zh-CN' || s1.stored !== 'zh') P(`中文 toggle: ${JSON.stringify([s1.html, s1.rk, s1.stored])}`);
  if (!/总览/.test(s1.nav) || !/组件库/.test(s1.title)) P('中文 toggle did not switch the gallery copy (nav / title)');
  if (!/万|亿/.test(zh)) P('中文 previews were not re-mounted with zh-CN units (no 万 / 亿 on the price-volume volume axis)');
  // 中文 after a reload (from storage) == 中文 toggled
  await page.reload({ waitUntil: 'load' });
  await booted(page);
  await settled(page);
  const zhBoot = await mainText(page);
  if (zhBoot !== zh) P('中文 booted from storage differs from 中文 toggled: ' + firstDiff(zhBoot, zh));
  await page.click('.g-lang__btn[data-lang="en"]');
  await page.waitForTimeout(400);
  await settled(page);
  const s2 = await state(), en2 = await mainText(page);
  if (s2.html !== 'en' || s2.rk !== 'en' || s2.stored !== 'en') P(`EN toggle: ${JSON.stringify([s2.html, s2.rk, s2.stored])}`);
  if (en2 !== en1) P('EN after the round trip differs from the first EN render: ' + firstDiff(en1, en2));
  await page.evaluate(k => { try { localStorage.removeItem(k); } catch (e) { /* none */ } }, LANG_KEY);
}

/** 5. overview / category / component / design at 1440 and 390 px, navy and ink */
async function themeShots(browser, base) {
  for (const width of THEME_SHOTS.widths) {
    const page = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 900 }, deviceScaleFactor: 1 });
    await page.goto(base + 'gallery/index.html', { waitUntil: 'load' });
    await booted(page);
    for (const theme of THEME_SHOTS.themes) {
      await page.evaluate(t => RK.theme.set(t), theme);
      for (const r of THEME_SHOTS.routes) {
        await go(page, r);
        await page.evaluate(async () => { const H = document.documentElement.scrollHeight; for (let y = 0; y < H; y += 500) { window.scrollTo(0, y); await new Promise(res => setTimeout(res, 120)); } });
        await settled(page);
        await shoot(page, path.join(OUT, `theme-${theme}-${width}-${(SHOTS[r] || r.replace(/\//g, '-'))}.png`), page.viewportSize());
      }
    }
    await page.evaluate(() => RK.theme.set('navy'));
    await page.close();
  }
}

async function crawl(browser, base, label, viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const ctx = { label, viewport, current: '', problems: [], errors: [], requests: [] };
  page.on('pageerror', e => ctx.errors.push(`[${ctx.current}] pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') ctx.errors.push(`[${ctx.current}] console: ${m.text().slice(0, 300)}`); });
  page.on('requestfailed', r => ctx.errors.push(`[${ctx.current}] requestfailed: ${r.url()}`));
  page.on('request', r => ctx.requests.push(r.url()));
  await page.addInitScript(k => { try { if (!sessionStorage.getItem('rk-e2e')) { sessionStorage.setItem('rk-e2e', '1'); localStorage.removeItem(k); } } catch (e) { /* none */ } }, LANG_KEY);
  await page.goto(base + 'gallery/index.html', { waitUntil: 'load' });
  await booted(page);
  let stats = { nBlocks: 0, nRendered: 0, secs: 0 }, nSamples = 0;
  if (!skipCrawl) stats = await crawlRoutes(page, ctx);
  if (!mobileOnly) {
    nSamples = await checkSamples(page, ctx);
    await checkKeys(page, ctx);
    await checkLang(page, ctx);
  }
  console.log(`${label}: ${skipCrawl ? 0 : routes.length} routes in ${stats.secs}s, ${stats.nBlocks} live blocks (${stats.nRendered} rendered), ` +
    `${nSamples} samples of ${SAMPLE_COMPS.length} components, ${ctx.problems.length} problems, ${ctx.errors.length} console errors`);
  ctx.problems.forEach(p => console.log('   PROBLEM ' + p));
  ctx.errors.slice(0, 40).forEach(e => console.log('   ERROR ' + e));
  await page.close();
  return ctx.problems.length + ctx.errors.length;
}

(async () => {
  const browser = await chromium.launch();
  let fails = 0;
  let server = null;
  try {
    if (mobileOnly) {
      fails += await crawl(browser, 'file://' + ROOT + '/', 'mobile390', { width: 390, height: 844 });
    } else {
      if (proto === 'file' || proto === 'both') {
        fails += await crawl(browser, 'file://' + ROOT + '/', 'file', { width: 1440, height: 900 });
        if (shots) await themeShots(browser, 'file://' + ROOT + '/');
      }
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
