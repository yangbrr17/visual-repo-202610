#!/usr/bin/env node
/*
 * End-to-end check of a built report (default: the demo pitchbook, examples/demo-pitchbook/index.html via file://).
 *   python3 py/examples/build_demo.py && node tests/e2e/demo.cjs [--dir <report folder | .html>] [--no-shots] [--pdf]
 *                                                           [--only id1,id2] [--width 1440] [--out <screens dir>]
 *   node tests/e2e/demo.cjs --dir examples/demo-zh-cn      # any other built report (zh-CN demo, sql-pipeline report ...)
 * Asserts: no console errors, every block rendered, every page keeps 16:9 on screen; the filter bar filters its
 * dataset and the "Filtered view" stamp names the filter by its label; param sliders move the bound chart; the query
 * console runs an example; data-grid swaps to its static print table on beforeprint and back on afterprint;
 * PRINT: after the runtime's print path (beforeprint -> RK.runtime.printFit -> print media) every page's content stays
 * inside its 1135 x 638 page box and every block's content inside its block body (zoomed by printFit is fine; clipped,
 * scrolled away or spilling out is a failure, reported as page / block id). Interaction checks whose controls the
 * report does not have are skipped. Page and block counts come from the DOM.
 * Element screenshots of each section.rk-page -> tests/screens/demo/ (other reports: tests/screens/<folder name>/).
 * --pdf writes <dir>.pdf next to the report folder (examples/demo-pitchbook.pdf for the default).
 */
'use strict';
const fs = require('fs');
const path = require('path');
let playwright;
try { playwright = require('playwright'); } catch (e) { playwright = require(process.env.PLAYWRIGHT_PATH || '/opt/node-tools/node_modules/playwright'); }
const { chromium } = playwright;

const ROOT = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
function opt(name, dflt) { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] != null && !args[i + 1].startsWith('--') ? args[i + 1] : dflt; }
const shots = !args.includes('--no-shots');
const doPdf = args.includes('--pdf');
const only = opt('only', null) ? opt('only').split(',') : null;
const width = +opt('width', 0) || 1440;

// report: a folder with index.html (or a single-file .html); relative paths from the cwd, else from the repo root
const dirArg = opt('dir', null);
let target = dirArg ? path.resolve(process.cwd(), dirArg) : path.join(ROOT, 'examples/demo-pitchbook');
if (dirArg && !fs.existsSync(target) && fs.existsSync(path.resolve(ROOT, dirArg))) target = path.resolve(ROOT, dirArg);
target = target.replace(/[\\/]+$/, '');
const isFile = /\.html?$/i.test(target) && fs.existsSync(target) && fs.statSync(target).isFile();
const REPORT = isFile ? target : path.join(target, 'index.html');
const PDF = (isFile ? target.replace(/\.html?$/i, '') : target) + '.pdf';
const NAME = path.basename(isFile ? path.dirname(target) : target);
const OUT = path.resolve(ROOT, opt('out', 'tests/screens/' + (dirArg && NAME !== 'demo-pitchbook' ? NAME : 'demo')));
if (!fs.existsSync(REPORT)) { console.error('report not found: ' + REPORT + ' (build it first, e.g. python3 py/examples/build_demo.py)'); process.exit(2); }
const URL = 'file://' + REPORT;

const PRINT_TOL = 2;   // CSS px of slack before content counts as overflowing (sub-pixel rounding, antialiasing)

const fails = [];
function check(ok, msg) { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails.push(msg); }
function skip(msg) { console.log('skip ' + msg); }

function watch(page, errors, tag) {
  const t = tag ? '(' + tag + ')' : '';
  page.on('pageerror', e => errors.push('pageerror' + t + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error' || (m.type() === 'warning' && /\[RK\]/.test(m.text()))) errors.push(m.type() + t + ': ' + m.text()); });
  page.on('requestfailed', r => errors.push('requestfailed' + t + ': ' + r.url()));
}
async function open(page) {
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.RK && RK.runtime && RK.runtime.booted && RK.blocks().length > 0, null, { timeout: 20000 });
}

/* ------------------------------------------------------------------ *
 * Print-overflow measurement (runs in the page, print media emulated)
 * ------------------------------------------------------------------ */
function measurePrint(arg) {
  const TOL = arg.tol, fitList = arg.fit || [];
  const SIZES = { letter: [1135, 877], a4: [1135, 802.6] };
  const ps = (document.documentElement.getAttribute('data-rk-page-size') || '').toLowerCase();
  const [PW, PH] = SIZES[ps] || [1135, 638.4];
  const REPLACED = /^(IMG|CANVAS|SVG|VIDEO|INPUT|SELECT|TEXTAREA|IFRAME|OBJECT|EMBED)$/i;

  function opaque(c) {
    if (!c || c === 'transparent') return false;
    let m = c.match(/^rgba?\(([^)]+)\)$/);
    if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean); return p.length < 4 || parseFloat(p[3]) > 0; }
    m = c.match(/\/\s*([\d.]+)(%?)\s*\)$/);
    return m ? parseFloat(m[1]) > 0 : true;
  }
  function painted(cs) {
    if (opaque(cs.backgroundColor) || cs.backgroundImage !== 'none') return true;
    return ['Top', 'Right', 'Bottom', 'Left'].some(s => parseFloat(cs['border' + s + 'Width']) > 0 && cs['border' + s + 'Style'] !== 'none' && opaque(cs['border' + s + 'Color']));
  }
  function describe(el) {
    if (!el) return '?';
    if (el.nodeType === 3) {
      const tx = el.textContent.trim().replace(/\s+/g, ' ');
      return '"' + (tx.length > 40 ? tx.slice(0, 40) + '…' : tx) + '" in ' + describe(el.parentElement);
    }
    const cls = typeof el.className === 'string' ? el.className : (el.className && el.className.baseVal) || '';
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls.trim().split(/\s+/).slice(0, 2).join('.') : '');
  }
  /**
   * Overflow of what is actually painted inside `root` (text, replaced elements, boxes with a background or border)
   * beyond `box`, each piece clipped by its overflow-clipping ancestors below root (ellipsis labels, scroll areas — a
   * scroll area's hidden part is reported separately). Elements matching `asBox` count with their own box only.
   * Returns {r, b, l, t, el} in viewport px.
   */
  function inkOverflow(root, box, asBox) {
    const out = { r: 0, b: 0, l: 0, t: 0, el: null, max: 0 };
    const clips = new Map();
    function clipFor(el) {
      if (!el || el === root) return null;
      if (clips.has(el)) return clips.get(el);
      let c = clipFor(el.parentElement);
      const cs = getComputedStyle(el);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || cs.clipPath !== 'none' || (cs.clip && cs.clip !== 'auto')) {
        const r = el.getBoundingClientRect();
        c = c ? { left: Math.max(c.left, r.left), top: Math.max(c.top, r.top), right: Math.min(c.right, r.right), bottom: Math.min(c.bottom, r.bottom) }
          : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }
      clips.set(el, c);
      return c;
    }
    function add(r, clip, src) {
      if (!r || r.width <= 0.5 || r.height <= 0.5) return;
      let left = r.left, top = r.top, right = r.right, bottom = r.bottom;
      if (clip) { left = Math.max(left, clip.left); top = Math.max(top, clip.top); right = Math.min(right, clip.right); bottom = Math.min(bottom, clip.bottom); }
      if (right - left <= 0.5 || bottom - top <= 0.5) return;
      const d = { r: right - box.right, b: bottom - box.bottom, l: box.left - left, t: box.top - top };
      const m = Math.max(d.r, d.b, d.l, d.t);
      ['r', 'b', 'l', 't'].forEach(k => { if (d[k] > out[k]) out[k] = d[k]; });
      if (m > out.max) { out.max = m; out.el = src; }
    }
    const range = document.createRange();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (n.nodeType === 3) return n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.opacity === '0' || n.tagName === 'SCRIPT' || n.tagName === 'STYLE') return NodeFilter.FILTER_REJECT;
        // an <svg> counts as its viewport, `asBox` elements as their own box: neither is walked into
        if ((asBox && n.matches(asBox)) || n instanceof SVGElement) {
          if (cs.visibility !== 'hidden') add(n.getBoundingClientRect(), clipFor(n.parentElement), n);
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === 3) {
        const par = n.parentElement, pcs = getComputedStyle(par);
        if (pcs.visibility === 'hidden') continue;
        range.selectNodeContents(n);
        const clip = clipFor(par);
        // a text run's rect is the font's content area; with a tight line-height (big figures) it pokes out of its line
        // box by the negative half-leading although nothing is drawn there: measure the line box instead
        const lh = parseFloat(pcs.lineHeight), scale = par.offsetWidth ? par.getBoundingClientRect().width / par.offsetWidth : 1;
        for (const r of range.getClientRects()) {
          const inset = lh > 0 && r.height > lh * scale ? (r.height - lh * scale) / 2 : 0;
          add({ left: r.left, right: r.right, top: r.top + inset, bottom: r.bottom - inset, width: r.width, height: r.height - 2 * inset }, clip, n);
        }
        continue;
      }
      const cs = getComputedStyle(n);
      if (cs.visibility !== 'hidden' && (REPLACED.test(n.tagName) || painted(cs))) add(n.getBoundingClientRect(), clipFor(n.parentElement), n);
    }
    return out;
  }

  const fitById = {};
  fitList.forEach(f => { fitById[f.id] = f; });
  const pages = Array.from(document.querySelectorAll('section.rk-page'));
  const res = { size: [PW, PH], pages: [], blocks: [] };

  pages.forEach((p, i) => {
    const pr = p.getBoundingClientRect(), z = pr.width / (p.offsetWidth || 1) || 1;
    const issues = [];
    if (Math.abs(p.offsetWidth - PW) > 1 || Math.abs(p.offsetHeight - PH) > 1.5) issues.push(`page box ${p.offsetWidth}x${p.offsetHeight}, expected ${PW}x${Math.round(PH)}`);
    const k = inkOverflow(p, { left: pr.left, top: pr.top, right: pr.right, bottom: pr.bottom }, '.rk-block__body');
    const sides = { r: 'past the right edge', b: 'below the bottom edge', l: 'past the left edge', t: 'above the top edge' };
    Object.keys(sides).forEach(s => { if (k[s] / z > TOL) issues.push(`content ${Math.round(k[s] / z)}px ${sides[s]} (clipped on paper; worst: ${describe(k.el)})`); });
    const foot = p.querySelector(':scope > .rk-page__foot');
    if (foot) {
      const fr = foot.getBoundingClientRect();
      p.querySelectorAll('.rk-block').forEach(b => {
        const br = b.getBoundingClientRect();
        if (br.height && (br.bottom - fr.top) / z > TOL) issues.push(`block ${b.id} runs ${Math.round((br.bottom - fr.top) / z)}px into the page foot`);
      });
    }
    res.pages.push({ n: i + 1, id: p.id || '#' + (i + 1), issues });
  });

  RK.blocks().forEach(b => {
    const page = b.el.closest('section.rk-page');
    if (!page || b.el.closest('.rk-modal') || b.state === 'destroyed') return;
    const n = pages.indexOf(page) + 1;
    const rec = { id: b.id, c: b.component, page: page.id || '#' + n, n, fit: fitById[b.id] || null, issues: [], skip: null };
    res.blocks.push(rec);
    if (!b.el.getClientRects().length) { rec.skip = 'not printed'; return; }
    if (b.state === 'error' || b.state === 'idle') { rec.issues.push('block not rendered (' + b.state + ')'); return; }
    const body = b.body;
    if (!body || body === b.el) { rec.skip = 'no body'; return; }
    if (body.classList.contains('leaflet-container') || body.querySelector('.leaflet-container')) { rec.skip = 'map'; return; }
    const z = page.getBoundingClientRect().width / (page.offsetWidth || 1) || 1;
    rec.box = [body.clientWidth, body.clientHeight];
    rec.scroll = [body.scrollWidth, body.scrollHeight];
    // scroll areas inside the body that still hide content (printFit unclamps them; anything left is lost on paper)
    body.querySelectorAll('*').forEach(el => {
      if (el instanceof SVGElement || !el.getClientRects().length) return;
      const cs = getComputedStyle(el);
      if (!/(auto|scroll)/.test(cs.overflowX + ' ' + cs.overflowY)) return;
      const dx = el.scrollWidth - el.clientWidth, dy = el.scrollHeight - el.clientHeight;
      if (dx > TOL || dy > TOL) rec.issues.push(`scroll area ${describe(el)} hides ${dx > TOL ? dx + 'px of width' : ''}${dx > TOL && dy > TOL ? ' and ' : ''}${dy > TOL ? dy + 'px of height' : ''}` +
        (b.options().printFit === false ? ' (printFit: false on this block)' : rec.fit ? '' : ' (printFit did not unclamp it)'));
    });
    const br = body.getBoundingClientRect();
    const k = inkOverflow(body, { left: br.left, top: br.top, right: br.right, bottom: br.bottom }, null);
    const o = { r: k.r / z, b: k.b / z, l: k.l / z, t: k.t / z };
    const worst = Math.max(o.r, o.b, o.l, o.t);
    if (worst > TOL) {
      const where = [o.b > TOL ? Math.round(o.b) + 'px at the bottom' : '', o.r > TOL ? Math.round(o.r) + 'px at the right' : '', o.t > TOL ? Math.round(o.t) + 'px at the top' : '', o.l > TOL ? Math.round(o.l) + 'px at the left' : ''].filter(Boolean).join(', ');
      const how = rec.fit ? (rec.fit.clipped ? `printFit clipped it at the minimum zoom ${rec.fit.zoom}` : `still outside after printFit zoom ${rec.fit.zoom}`)
        : b.options().printFit === false ? 'printFit: false on this block' : 'printFit did not handle it';
      rec.issues.push(`content overflows its ${rec.box[0]}x${rec.box[1]} body by ${where} (${how}; worst: ${describe(k.el)})`);
    } else if (rec.fit && rec.fit.clipped) {
      rec.issues.push(`printFit clipped it at the minimum zoom ${rec.fit.zoom} (content ${rec.fit.content.join('x')} for a ${rec.fit.box.join('x')} box)`);
    }
  });
  return res;
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  watch(page, errors, '');
  await open(page);
  await page.waitForTimeout(500);
  console.log('      report: ' + path.relative(process.cwd(), REPORT));

  // scroll every page into view so lazy blocks render
  const ids = await page.$$eval('section.rk-page', els => els.map((e, i) => e.id || (e.id = 'page-' + (i + 1))));
  for (const id of ids) {
    await page.evaluate(id => document.getElementById(id).scrollIntoView({ block: 'start' }), id);
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1500);
  const states = await page.evaluate(() => RK.blocks().map(b => ({ id: b.id, c: b.component, state: b.state, msg: b._errorEl ? b._errorEl.textContent : '' })));
  const bad = states.filter(s => s.state !== 'rendered');
  check(!bad.length, `${ids.length} pages, ${states.length} blocks, all rendered` + (bad.length ? ' — not rendered: ' + bad.map(b => `${b.id}(${b.c})=${b.state} ${b.msg}`).join('; ') : ''));

  // geometry: page aspect and overflowing content
  const geo = await page.evaluate(() => Array.from(document.querySelectorAll('section.rk-page')).map((p, i) => {
    const r = p.getBoundingClientRect();
    const ideal = r.width * 9 / 16;
    const body = p.querySelector('.rk-page__body');
    const foot = p.querySelector('.rk-page__foot');
    const over = [];
    p.querySelectorAll('.rk-block__body').forEach(b => {
      // content taller than its box (clipped) — ignore scroll containers designed for it
      const kids = Array.from(b.children);
      kids.forEach(k => { if (k.scrollHeight > b.clientHeight + 4 && getComputedStyle(k).overflowY === 'visible') over.push((b.parentElement.id || '?') + ':' + k.className + ' ' + k.scrollHeight + '>' + b.clientHeight); });
    });
    const used = body ? Array.from(body.children).reduce((m, c) => Math.max(m, c.getBoundingClientRect().bottom), -Infinity) - body.getBoundingClientRect().top : 0;
    return { i: i + 1, id: p.id, w: Math.round(r.width), h: Math.round(r.height), ideal: Math.round(ideal), grew: Math.round(r.height - ideal),
      bodyH: body ? Math.round(body.getBoundingClientRect().height) : 0, used: Math.round(used), footVisible: !!foot && foot.getBoundingClientRect().bottom <= r.bottom + 1, over };
  }));
  const ratio = await page.evaluate(() => { const v = (document.documentElement.getAttribute('data-rk-page-size') || '').toLowerCase(); return v === 'letter' ? 8.5 / 11 : v === 'a4' ? 210 / 297 : 9 / 16; });
  geo.forEach(g => { g.ideal = Math.round(g.w * ratio); g.grew = g.h - g.ideal; });
  geo.forEach(g => console.log(`  p${String(g.i).padStart(2, '0')} ${g.id.padEnd(22)} ${g.w}x${g.h} (ideal ${g.ideal}, ${g.grew > 1 ? 'GREW +' + g.grew : 'ok'}) body ${g.bodyH} used ${g.used} free ${g.bodyH - g.used}${g.over.length ? ' OVER ' + g.over.join(' | ') : ''}`));
  const grew = geo.filter(g => g.grew > 1);
  check(!grew.length, 'every page keeps its proportions at ' + width + 'px' + (grew.length ? ' — grew: ' + grew.map(g => g.id + '+' + g.grew).join(', ') : ''));

  // ---- interaction 1: filter-bar (top bar) filters its dataset; the "Filtered view" stamp names the filter by its label
  const fb = await page.evaluate(() => {
    const blk = document.querySelector('.rk-topbar [data-rk="filter-bar"]');
    return blk && document.querySelector('.rk-topbar .rk-fb-trigger') ? { data: blk.getAttribute('data-rk-data') } : null;
  });
  if (!fb || !fb.data) skip('filter-bar: no filter bar with a dataset in the top bar');
  else {
    const counts = () => page.evaluate(() => RK.data.ids().map(id => [id, RK.data.get(id).rows.length, RK.data.view(id).length]));
    const c0 = await counts();
    const rows = () => page.evaluate(id => RK.data.view(id).length, fb.data);
    const keys = () => page.evaluate(() => Object.keys(RK.store.filters()));
    const stamps = () => page.$$eval('.rk-page__filtered', els => els.map(e => e.textContent));
    const before = await rows(), keys0 = await keys(), stamps0 = await stamps();
    await page.evaluate(() => window.scrollTo(0, 0));
    const trig = page.locator('.rk-topbar .rk-fb-trigger').first();
    const label = (await trig.getAttribute('aria-label')) || '';
    await trig.click();
    await page.waitForTimeout(300);
    // "only" on the first option
    const opt1 = page.locator('.rk-fb-pop .rk-fb-opt:not(.rk-fb-opt--all)').first();
    const optName = (await opt1.locator('.rk-fb-opt__t').textContent()).trim();
    await opt1.hover();
    await opt1.locator('.rk-fb-only').click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    const after = await rows();
    const c1 = await counts();
    const moved = c1.filter((x, i) => x[2] !== c0[i][2]).map(x => `${x[0]} ${x[2]}/${x[1]}`);
    check(after < before && after > 0, `filter-bar ${label}="${optName}": ${fb.data} ${before} -> ${after}` + (moved.length ? `; filtered: ${moved.join(', ')}` : ''));
    // the stamp: "Filtered view: <label> = <value>" — the control's label (spec.label), not the raw field name
    const added = (await keys()).filter(k => keys0.indexOf(k) < 0);
    const spec = await page.evaluate(k => { const f = RK.store.filter(k); return f ? { field: f.field, label: f.label || null } : null; }, added[0] || '');
    const stamp = (await stamps()).find(t => t.indexOf(label + ' = ') >= 0) || '';
    check(added.length === 1 && !!stamp && !!(spec && spec.label === label),
      `"Filtered view" stamp names the filter by its label: "${stamp}" (filter ${JSON.stringify(added)}: spec.label ${JSON.stringify(spec && spec.label)}, field ${JSON.stringify(spec && spec.field)})`);
    // a comps table on that dataset drops the filtered-out names
    const comps = await page.evaluate(id => {
      const blk = document.querySelector('.rk-page .rk-block[data-rk="comps-table"][data-rk-data="' + id + '"]');
      if (!blk) return null;
      const ds = RK.data.get(id), kept = new Set(RK.data.view(id));
      const keyF = (ds.fields.find(f => f.type === 'string') || {}).name;
      const keptNames = ds.rows.filter(r => kept.has(r)).map(r => String(r[keyF]));
      const gone = ds.rows.filter(r => !kept.has(r)).map(r => String(r[keyF])).filter(n => !keptNames.some(k => k.indexOf(n) >= 0));
      blk.scrollIntoView();
      return { page: blk.closest('section.rk-page').id, block: blk.id, gone };
    }, fb.data);
    if (!comps) skip('comps-table on ' + fb.data + ': none in this report');
    else {
      await page.waitForTimeout(600);
      const txt = await page.evaluate(id => document.getElementById(id).innerText, comps.block);
      const shown = comps.gone.filter(n => txt.indexOf(n) >= 0);
      check(!shown.length, `comps-table ${comps.block} drops the ${comps.gone.length} filtered-out names` + (shown.length ? ' — still shows: ' + shown.join(', ') : ''));
      if (shots) { fs.mkdirSync(OUT, { recursive: true }); await page.locator('#' + comps.page).screenshot({ path: path.join(OUT, 'x-filtered-comps.png') }); }
    }
    const readout = await page.evaluate(() => (document.querySelector('.rk-topbar .rk-fb') || {}).innerText || '');
    console.log('      top-bar readout: ' + readout.replace(/\s+/g, ' ').slice(0, 120));
    // reset the filter set above (other controls' defaults, e.g. a scenario switch, stay)
    await page.evaluate(ks => ks.forEach(k => RK.store.clearFilter(k)), added);
    await page.waitForTimeout(400);
    const stamps2 = await stamps();
    check(await rows() === before && JSON.stringify(stamps2) === JSON.stringify(stamps0), 'filter reset: rows and "Filtered view" stamps back to the initial state' +
      (JSON.stringify(stamps2) !== JSON.stringify(stamps0) ? ` — stamps ${JSON.stringify(stamps0)} -> ${JSON.stringify(stamps2)}` : ''));
  }

  // ---- interaction 2: param sliders move the chart bound to the parameterised dataset
  const ps = await page.evaluate(() => {
    const range = document.querySelector('.rk-page input.rk-ps__range');
    if (!range) return null;
    const pg = range.closest('section.rk-page');
    const blk = Array.from(pg.querySelectorAll('.rk-block[data-rk-data]')).find(b => b.querySelector('[_echarts_instance_]') && RK.data.get(b.getAttribute('data-rk-data')) && RK.data.get(b.getAttribute('data-rk-data')).fields.some(f => f.computed));
    return { page: pg.id, block: blk ? blk.id : null, data: blk ? blk.getAttribute('data-rk-data') : null };
  });
  if (!ps || !ps.block) skip('param sliders: no slider page with a parameter-driven chart');
  else {
    await page.evaluate(id => document.getElementById(id).scrollIntoView(), ps.page);
    await page.waitForTimeout(800);
    const chartVals = () => page.evaluate(id => {
      const el = document.getElementById(id).querySelector('[_echarts_instance_]');
      const inst = el && echarts.getInstanceByDom(el);
      if (!inst) return null;
      return inst.getOption().series.map(s => (s.data || []).map(d => (d && typeof d === 'object' && 'value' in d) ? d.value : d));
    }, ps.block);
    const v0 = await chartVals();
    if (ps.data === 'dcf_live') {
      const base = await page.evaluate(() => RK.data.get('dcf_live').rows.map(r => +r.implied_price.toFixed(2)));
      check(base[1] === 50.88, `dcf_live base case at 9.0%/2.5% = ${base[1]} (sensitivity table says 50.88)`);
    }
    const range = page.locator('#' + ps.page + ' input.rk-ps__range').first();
    await range.evaluate(el => { el.value = String(+el.min); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(900);
    const v1 = await chartVals();
    check(v0 && JSON.stringify(v0) !== JSON.stringify(v1), `slider -> min moves ${ps.block}: ${JSON.stringify(v0)} -> ${JSON.stringify(v1)}`.slice(0, 400));
    const sensBase = await page.evaluate(() => { const c = document.querySelector('.rk-page .rk-block[data-rk="sensitivity-table"]'); return c ? (c.innerText.split('\n').find(l => /Base|基准/i.test(l)) || '') : ''; });
    if (sensBase) console.log('      sensitivity caption after slider: ' + sensBase);
    if (shots) { fs.mkdirSync(OUT, { recursive: true }); await page.locator('#' + ps.page).screenshot({ path: path.join(OUT, 'x-what-if-moved.png') }); }
    await page.evaluate(() => { const p = (RK.data.manifest && RK.data.manifest.params) || {}; Object.keys(p).forEach(k => RK.store.setParam(k, p[k].value)); });
    await page.waitForTimeout(400);
  }

  // ---- interaction 3: query console runs an example
  const qcPage = await page.evaluate(() => { const b = document.querySelector('.rk-page .rk-block[data-rk="query-console"]'); return b ? { page: b.closest('section.rk-page').id, block: b.id } : null; });
  if (!qcPage) skip('query console: none in this report');
  else {
    await page.evaluate(id => document.getElementById(id).scrollIntoView(), qcPage.page);
    await page.waitForTimeout(800);
    const qtab = page.locator(`#${qcPage.block} .rk-qc-tab[id$="-tab-query"]`).first();
    if (await qtab.count()) await qtab.click();
    await page.waitForTimeout(200);
    const chips = page.locator(`#${qcPage.block} .rk-qc-chip`);
    const chip = chips.nth((await chips.count()) > 1 ? 1 : 0);
    const chipLabel = await chip.textContent();
    await chip.click();
    await page.waitForTimeout(800);
    const qc = await page.evaluate(id => {
      const blk = document.getElementById(id);
      const st = blk.querySelector('.rk-qc-status');
      const rows = blk.querySelectorAll('.rk-qc-table tbody tr').length;
      return { status: st ? st.className + ' ' + st.innerText : '', rows };
    }, qcPage.block);
    check(/is-ok/.test(qc.status) && qc.rows > 0, `query console example "${chipLabel}" -> ${qc.rows} rows, status "${qc.status.replace(/\s+/g, ' ')}"`);
    if (shots) { fs.mkdirSync(OUT, { recursive: true }); await page.locator('#' + qcPage.page).screenshot({ path: path.join(OUT, 'x-query-run.png') }); }
  }

  // ---- data-grid: static print table between beforeprint and afterprint, the live grid (same order) after
  const grids = await page.evaluate(() => RK.blocks().filter(b => b.component === 'data-grid' && b.el.closest('.rk-page') && b.state === 'rendered').map(b => b.id));
  if (!grids.length) skip('data-grid print table: no data-grid in this report');
  else {
    const firstKeys = () => page.evaluate(ids => ids.map(id => {
      const el = document.getElementById(id);
      const pt = el.querySelector('.rk-dgrid-print');
      const grid = el.querySelector('.rk-dgrid');
      const firstRow = pt ? pt.querySelector('tbody tr') : el.querySelector('.tabulator-row');
      const cell = firstRow ? (pt ? firstRow.cells[0] : firstRow.querySelector('.tabulator-cell')) : null;
      return {
        id, print: !!pt, gridShown: !!grid && grid.getClientRects().length > 0,
        rows: pt ? pt.querySelectorAll('tbody tr').length : el.querySelectorAll('.tabulator-row').length,
        note: pt ? (pt.querySelector('.rk-dgrid-print__more') || {}).textContent || '' : '',
        first: cell ? cell.textContent.trim() : null
      };
    }), grids);
    const g0 = await firstKeys();
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    await page.waitForTimeout(800);
    const g1 = await firstKeys();
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await page.waitForTimeout(1000);
    const g2 = await firstKeys();
    g1.forEach((x, i) => {
      check(x.print && !x.gridShown && x.rows > 0 && x.first === g0[i].first,
        `data-grid ${x.id} prints a static table: ${x.rows} rows, first "${x.first}" (grid: "${g0[i].first}")${x.note ? ', note "' + x.note + '"' : ''}`);
      const y = g2[i];
      check(!y.print && y.gridShown && y.rows > 0 && y.first === g0[i].first, `data-grid ${x.id} back to the live grid after afterprint (${y.rows} rows rendered, first "${y.first}")`);
    });
  }

  // ---- PRINT: runtime print path on a fresh load (lazy blocks first rendered for print), then print media
  {
    const pp = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    watch(pp, errors, 'print');
    await pp.emulateMedia({ reducedMotion: 'reduce' });
    await open(pp);
    await pp.waitForTimeout(300);
    // 'beforeprint': render every block for print (ctx.print), the components' own handlers, then RK.runtime.printFit()
    await pp.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    await pp.waitForTimeout(1200);
    await pp.emulateMedia({ media: 'print', reducedMotion: 'reduce' });
    await pp.waitForTimeout(1500);
    const pst = await pp.evaluate(() => RK.blocks().filter(b => b.el.closest('.rk-page') && b.state !== 'rendered' && b.state !== 'empty').map(b => b.id + '=' + b.state));
    check(!pst.length, 'print mode: all blocks rendered' + (pst.length ? ' — ' + pst.join(', ') : ''));
    // the fit as the paper gets it (the media change re-ran it; run once more on the settled layout)
    const hasFit = await pp.evaluate(() => !!(RK.runtime && RK.runtime.printFit));
    const fit = hasFit ? await pp.evaluate(() => RK.runtime.printFit()) : [];
    const pr = await pp.evaluate(measurePrint, { tol: PRINT_TOL, fit });
    const [PW, PH] = pr.size;
    const badPages = pr.pages.filter(p => p.issues.length);
    check(!badPages.length, `print: all ${pr.pages.length} pages keep their content inside the ${PW}x${Math.round(PH)} page box` +
      (badPages.length ? ' — overflow:\n   ' + badPages.map(p => `p${String(p.n).padStart(2, '0')} ${p.id}: ${p.issues.join('; ')}`).join('\n   ') : ''));
    const checked = pr.blocks.filter(b => !b.skip);
    const badBlocks = checked.filter(b => b.issues.length);
    const zoomed = pr.blocks.filter(b => b.fit && !b.fit.clipped);
    const skipped = pr.blocks.filter(b => b.skip);
    check(!badBlocks.length, `print: all ${checked.length} blocks keep their content inside the block body` +
      (zoomed.length ? `; scaled by printFit: ${zoomed.map(b => b.id + ' ×' + b.fit.zoom).join(', ')}` : '') +
      (skipped.length ? `; not measured: ${skipped.map(b => b.id + ' (' + b.skip + ')').join(', ')}` : '') +
      (badBlocks.length ? ' — overflow:\n   ' + badBlocks.map(b => `p${String(b.n).padStart(2, '0')} ${b.page} · ${b.id} (${b.c}): ${b.issues.join('; ')}`).join('\n   ') : ''));
    if (!hasFit) console.log('      (this build has no RK.runtime.printFit: measured without print fit)');

    // ---- print to PDF from the same print state
    if (doPdf) {
      const n = pr.pages.length;
      await pp.pdf({ path: PDF, preferCSSPageSize: true, printBackground: true });
      const buf = fs.readFileSync(PDF);
      const count = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
      check(count === n, `PDF ${path.relative(process.cwd(), PDF)} — ${count} pages for ${n} report pages, ${(buf.length / 1048576).toFixed(2)} MB`);
    }
    await pp.close();
  }

  // ---- screenshots of every page (fresh load so state is pristine)
  if (shots) {
    const p2 = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    watch(p2, errors, 'shots');
    await p2.emulateMedia({ reducedMotion: 'reduce' });
    await open(p2);
    const ids2 = await p2.$$eval('section.rk-page', els => els.map((e, i) => e.id || (e.id = 'page-' + (i + 1))));
    for (const id of ids2) { await p2.evaluate(id => document.getElementById(id).scrollIntoView(), id); await p2.waitForTimeout(150); }
    await p2.waitForTimeout(1500);
    fs.mkdirSync(OUT, { recursive: true });
    let n = 0;
    for (const id of ids2) {
      n++;
      if (only && !only.includes(id)) continue;
      const loc = p2.locator('#' + id);
      await loc.scrollIntoViewIfNeeded();
      await p2.waitForTimeout(350);
      await p2.mouse.move(1, 1);
      await loc.screenshot({ path: path.join(OUT, `${String(n).padStart(2, '0')}-${id}.png`) });
    }
    console.log(`      ${only ? only.length : ids2.length} page screenshots -> ${path.relative(process.cwd(), OUT)}/`);
    await p2.close();
  }

  check(!errors.length, 'no console errors' + (errors.length ? ':\n   ' + errors.slice(0, 30).join('\n   ') : ''));
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL OK');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
