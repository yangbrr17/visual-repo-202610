#!/usr/bin/env node
/*
 * End-to-end check of the demo pitchbook (examples/demo-pitchbook/index.html via file://).
 *   python3 py/examples/build_demo.py && node tests/e2e/demo.cjs [--no-shots] [--pdf] [--only id1,id2] [--width 1440]
 * Asserts: no console errors, every block rendered, filter-bar filters peers blocks,
 * param sliders change the dcf_live bar, query console runs an example; page geometry report;
 * element screenshots of each section.rk-page at 1440 wide -> tests/screens/demo/.
 */
'use strict';
const fs = require('fs');
const path = require('path');
let playwright;
try { playwright = require('playwright'); } catch (e) { playwright = require(process.env.PLAYWRIGHT_PATH || '/opt/node-tools/node_modules/playwright'); }
const { chromium } = playwright;

const ROOT = path.resolve(__dirname, '../..');
const REPORT = path.join(ROOT, 'examples/demo-pitchbook/index.html');
const OUT = path.join(ROOT, 'tests/screens/demo');
const args = process.argv.slice(2);
const shots = !args.includes('--no-shots');
const doPdf = args.includes('--pdf');
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? args[onlyIdx + 1].split(',') : null;
const width = +(args[args.indexOf('--width') + 1] || 0) || 1440;

const fails = [];
function check(ok, msg) { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails.push(msg); }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' || (m.type() === 'warning' && /\[RK\]/.test(m.text()))) errors.push(m.type() + ': ' + m.text()); });
  page.on('requestfailed', r => errors.push('requestfailed: ' + r.url()));
  await page.goto('file://' + REPORT, { waitUntil: 'load' });
  await page.waitForFunction(() => window.RK && RK.runtime && RK.runtime.booted && RK.blocks().length > 0, null, { timeout: 20000 });
  await page.waitForTimeout(500);

  // scroll every page into view so lazy blocks render
  const ids = await page.$$eval('section.rk-page', els => els.map(e => e.id));
  for (const id of ids) {
    await page.evaluate(id => document.getElementById(id).scrollIntoView({ block: 'start' }), id);
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1500);
  const states = await page.evaluate(() => RK.blocks().map(b => ({ id: b.id, c: b.component, state: b.state, msg: b._errorEl ? b._errorEl.textContent : '' })));
  const bad = states.filter(s => s.state !== 'rendered');
  check(!bad.length, `${states.length} blocks, all rendered` + (bad.length ? ' — not rendered: ' + bad.map(b => `${b.id}(${b.c})=${b.state} ${b.msg}`).join('; ') : ''));

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
  geo.forEach(g => console.log(`  p${String(g.i).padStart(2, '0')} ${g.id.padEnd(22)} ${g.w}x${g.h} (16:9=${g.ideal}, ${g.grew > 1 ? 'GREW +' + g.grew : 'ok'}) body ${g.bodyH} used ${g.used} free ${g.bodyH - g.used}${g.over.length ? ' OVER ' + g.over.join(' | ') : ''}`));
  const grew = geo.filter(g => g.grew > 1);
  check(!grew.length, 'every page keeps 16:9 at ' + width + 'px' + (grew.length ? ' — grew: ' + grew.map(g => g.id + '+' + g.grew).join(', ') : ''));

  // ---- interaction 1: filter-bar (top bar) filters peers-based blocks
  const peerRows = () => page.evaluate(() => RK.data.view('peers').length);
  const before = await peerRows();
  await page.evaluate(() => window.scrollTo(0, 0));
  const trig = page.locator('.rk-topbar .rk-fb-trigger').first();
  await trig.click();
  await page.waitForTimeout(300);
  // "only" on the first sector option
  const opt = page.locator('.rk-fb-pop .rk-fb-opt:not(.rk-fb-opt--all)').first();
  const optName = (await opt.locator('.rk-fb-opt__t').textContent()).trim();
  await opt.hover();
  await opt.locator('.rk-fb-only').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  const after = await peerRows();
  const precAfter = await page.evaluate(() => RK.data.view('precedents').length);
  const segAfter = await page.evaluate(() => RK.data.view('segment_revenue').length);
  check(after < before && after > 0, `filter-bar sector="${optName}": peers ${before} -> ${after}; precedents ${precAfter}/21; segment_revenue ${segAfter}/96 (unscoped)`);
  // the comps table on the comps page must show fewer rows
  await page.evaluate(() => document.getElementById('comps').scrollIntoView());
  await page.waitForTimeout(600);
  const compsTxt = await page.evaluate(() => document.querySelector('#comps .rk-block').innerText);
  check(!/Sierra Alta|Qingtai/.test(compsTxt) || optName === 'Motion & Power Control', 'comps-table drops filtered-out sectors');
  const readout = await page.evaluate(() => (document.querySelector('.rk-topbar .rk-fb') || {}).innerText || '');
  console.log('      top-bar readout: ' + readout.replace(/\s+/g, ' ').slice(0, 120));
  if (shots) { fs.mkdirSync(OUT, { recursive: true }); await page.locator('#comps').screenshot({ path: path.join(OUT, 'x-filtered-comps.png') }); }
  // reset filters
  await page.evaluate(() => RK.store.clearFilters());
  await page.waitForTimeout(400);
  check(await peerRows() === before, 'filters reset');

  // ---- interaction 2: param sliders move the dcf_live implied price bar
  await page.evaluate(() => document.getElementById('what-if').scrollIntoView());
  await page.waitForTimeout(800);
  const barVals = () => page.evaluate(() => {
    const blk = Array.from(document.querySelectorAll('#what-if .rk-block')).find(b => b.getAttribute('data-rk') === 'bar');
    const el = blk.querySelector('[_echarts_instance_]');
    const inst = el && echarts.getInstanceByDom(el);
    if (!inst) return null;
    return inst.getOption().series.map(s => (s.data || []).map(d => (d && typeof d === 'object' && 'value' in d) ? d.value : d));
  });
  const v0 = await barVals();
  const rows0 = await page.evaluate(() => RK.data.get('dcf_live').rows.map(r => +r.implied_price.toFixed(2)));
  const range = page.locator('#what-if input.rk-ps__range').first();
  await range.evaluate(el => { el.value = String(+el.min + 0.0); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(900);
  const v1 = await barVals();
  const rows1 = await page.evaluate(() => RK.data.get('dcf_live').rows.map(r => +r.implied_price.toFixed(2)));
  check(rows0[1] === 50.88, `dcf_live base case at 9.0%/2.5% = ${rows0[1]} (sensitivity table says 50.88)`);
  check(JSON.stringify(v0) !== JSON.stringify(v1) && rows1[1] > rows0[1], `WACC slider -> min: implied price ${JSON.stringify(rows0)} -> ${JSON.stringify(rows1)}; bar ${JSON.stringify(v0)} -> ${JSON.stringify(v1)}`);
  const sensBase = await page.evaluate(() => { const c = document.querySelector('#valuation .rk-block[data-rk="sensitivity-table"]'); return c ? c.innerText.split('\n').find(l => /Base/i.test(l)) : ''; });
  console.log('      DCF sensitivity caption after slider: ' + sensBase);
  if (shots) await page.locator('#what-if').screenshot({ path: path.join(OUT, 'x-what-if-moved.png') });
  await page.evaluate(() => { RK.store.setParam('wacc', 0.09); RK.store.setParam('tgr', 0.025); });
  await page.waitForTimeout(400);

  // ---- interaction 3: query console runs an example
  await page.evaluate(() => document.getElementById('explore').scrollIntoView());
  await page.waitForTimeout(800);
  const qtab = page.locator('#explore .rk-qc-tab', { hasText: 'Query' }).first();
  if (await qtab.count()) await qtab.click();
  await page.waitForTimeout(200);
  const chip = page.locator('#explore .rk-qc-chip').nth(1);
  const chipLabel = await chip.textContent();
  await chip.click();
  await page.waitForTimeout(800);
  const qc = await page.evaluate(() => {
    const blk = document.querySelector('#explore .rk-block');
    const st = blk.querySelector('.rk-qc-status');
    const rows = blk.querySelectorAll('.rk-qc-table tbody tr').length;
    return { status: st ? st.className + ' ' + st.innerText : '', rows };
  });
  check(/is-ok/.test(qc.status) && qc.rows > 0, `query console example "${chipLabel}" -> ${qc.rows} rows, status "${qc.status.replace(/\s+/g, ' ')}"`);
  if (shots) await page.locator('#explore').screenshot({ path: path.join(OUT, 'x-query-run.png') });

  // ---- screenshots of every page (fresh load so state is pristine)
  if (shots) {
    const p2 = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    p2.on('pageerror', e => errors.push('pageerror(shots): ' + e.message));
    p2.on('console', m => { if (m.type() === 'error') errors.push('console(shots): ' + m.text()); });
    await p2.emulateMedia({ reducedMotion: 'reduce' });
    await p2.goto('file://' + REPORT, { waitUntil: 'load' });
    await p2.waitForFunction(() => window.RK && RK.runtime && RK.runtime.booted && RK.blocks().length > 0);
    for (const id of ids) { await p2.evaluate(id => document.getElementById(id).scrollIntoView(), id); await p2.waitForTimeout(150); }
    await p2.waitForTimeout(1500);
    fs.mkdirSync(OUT, { recursive: true });
    let n = 0;
    for (const id of ids) {
      n++;
      if (only && !only.includes(id)) continue;
      const loc = p2.locator('#' + id);
      await loc.scrollIntoViewIfNeeded();
      await p2.waitForTimeout(350);
      await p2.mouse.move(1, 1);
      await loc.screenshot({ path: path.join(OUT, `${String(n).padStart(2, '0')}-${id}.png`) });
    }
    console.log(`      ${only ? only.length : ids.length} page screenshots -> ${path.relative(ROOT, OUT)}/`);
    await p2.close();
  }

  // ---- print to PDF
  if (doPdf) {
    const p3 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    p3.on('pageerror', e => errors.push('pageerror(pdf): ' + e.message));
    p3.on('console', m => { if (m.type() === 'error') errors.push('console(pdf): ' + m.text()); });
    await p3.goto('file://' + REPORT, { waitUntil: 'load' });
    await p3.waitForFunction(() => window.RK && RK.runtime && RK.runtime.booted && RK.blocks().length > 0);
    await p3.emulateMedia({ media: 'print' });
    await p3.waitForTimeout(2500);
    const pst = await p3.evaluate(() => RK.blocks().filter(b => b.state !== 'rendered').map(b => b.id + '=' + b.state));
    check(!pst.length, 'print mode: all blocks rendered' + (pst.length ? ' — ' + pst.join(', ') : ''));
    const pdfPath = path.join(ROOT, 'examples/demo-pitchbook.pdf');
    await p3.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true });
    const buf = fs.readFileSync(pdfPath);
    const count = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    check(count === ids.length, `PDF ${pdfPath} — ${count} pages for ${ids.length} report pages, ${(buf.length / 1048576).toFixed(2)} MB`);
    await p3.close();
  }

  check(!errors.length, 'no console errors' + (errors.length ? ':\n   ' + errors.slice(0, 30).join('\n   ') : ''));
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL OK');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
