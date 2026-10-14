#!/usr/bin/env node
/*
 * Browser check of a single-file ReportKit report (used by tests/py/test_delivery.py).
 *   node tests/py/single_file_check.cjs /abs/path/report.html
 * Opens the file via file://, scrolls every page into view so lazy blocks render, and prints one JSON
 * line: {blocks, notRendered[], errors[], requests[] (every non-data: request besides the page itself)}.
 */
'use strict';
let playwright;
try { playwright = require('playwright'); } catch (e) { playwright = require(process.env.PLAYWRIGHT_PATH || '/opt/node-tools/node_modules/playwright'); }
const { chromium } = playwright;
const file = process.argv[2];
const url = 'file://' + file;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' || (m.type() === 'warning' && /\[RK\]/.test(m.text()))) errors.push(m.type() + ': ' + m.text()); });
  page.on('requestfailed', r => { if (!r.url().startsWith('data:')) errors.push('requestfailed: ' + r.url()); });
  page.on('request', r => { const u = r.url(); if (u !== url && !u.startsWith('data:')) requests.push(u); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.RK && RK.runtime && RK.runtime.booted && RK.blocks().length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(300);
  const ids = await page.$$eval('section.rk-page', els => els.map(e => e.id));
  for (const id of ids) {
    await page.evaluate(id => document.getElementById(id).scrollIntoView({ block: 'start' }), id);
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(1200);
  const res = await page.evaluate(() => {
    const blocks = RK.blocks();
    const fonts = Array.from(document.fonts).filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight);
    return {
      pages: document.querySelectorAll('section.rk-page').length,
      blocks: blocks.length,
      notRendered: blocks.filter(b => b.state !== 'rendered').map(b => b.id + '(' + b.component + ')=' + b.state),
      externalRefs: Array.from(document.querySelectorAll('script[src],link[href]')).map(e => e.src || e.href),
      fonts: fonts
    };
  });
  res.errors = errors;
  res.requests = requests;
  console.log(JSON.stringify(res));
  await browser.close();
})().catch(e => { console.log(JSON.stringify({ fatal: String(e && e.stack || e) })); process.exit(1); });
