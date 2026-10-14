#!/usr/bin/env node
/*
 * Browser smoke test for components: renders every manifest sample in headless Chromium via
 * tools/harness.html, fails on console errors / failed blocks, saves screenshots.
 *
 *   node tools/smoke.cjs bar football-field          # specific components
 *   node tools/smoke.cjs --all                       # every kit/components/* folder
 *   node tools/smoke.cjs bar --theme ink --out tests/screens
 *   node tools/smoke.cjs --page gallery/index.html   # smoke any page (errors + screenshot)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

let playwright;
try { playwright = require('playwright'); } catch (e) {
  playwright = require(process.env.PLAYWRIGHT_PATH || '/opt/node-tools/node_modules/playwright');
}

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function opt(name, dflt) { const i = args.indexOf('--' + name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; }
const theme = opt('theme', 'navy');
const outDir = path.resolve(ROOT, opt('out', 'tests/screens'));
const pageArg = opt('page', null);
const sd = opt('sd', null);
const width = parseInt(opt('width', '1440'), 10);
const all = args.includes('--all');
let comps = args.filter(a => !a.startsWith('--'));
if (all) comps = fs.readdirSync(path.join(ROOT, 'kit/components')).filter(d => fs.existsSync(path.join(ROOT, 'kit/components', d, 'manifest.json'))).sort();

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(ROOT, path.normalize(u).replace(/^(\.\.[/\\])+/, ''));
  if (/^\/kit\/components\/[^/]+\/[^/]+\.css$/.test(u) && !fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'text/css' }); res.end('/* optional component css not present */'); return; }
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await playwright.chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? undefined : undefined });
  fs.mkdirSync(outDir, { recursive: true });
  let failed = 0;
  const targets = pageArg ? [{ name: path.basename(pageArg, '.html'), url: `http://127.0.0.1:${port}/${pageArg}` }]
    : comps.map(c => ({ name: c, url: `http://127.0.0.1:${port}/tools/harness.html?c=${encodeURIComponent(c)}&theme=${theme}${sd ? '&sd=' + encodeURIComponent(sd) : ''}` }));
  for (const t of targets) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('requestfailed', r => errors.push('requestfailed: ' + r.url()));
    let states = [];
    try {
      await page.goto(t.url, { waitUntil: 'load', timeout: 30000 });
      if (!pageArg) {
        await page.waitForFunction(() => window.__RK_HARNESS && window.__RK_HARNESS.done, null, { timeout: 30000 });
        const H = await page.evaluate(() => ({ errors: window.__RK_HARNESS.errors, states: window.__RK_HARNESS.states || [] }));
        H.errors.forEach(e => { if (!errors.some(x => x.includes(e))) errors.push('harness: ' + e); });
        states = H.states;
      } else {
        await page.waitForTimeout(2500);
      }
      // scroll through to trigger lazy renders / reveals, then back to top
      await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); } window.scrollTo(0, 0); });
      await page.waitForTimeout(1200);
      const file = path.join(outDir, `${t.name}${theme !== 'navy' ? '-' + theme : ''}.png`);
      await page.screenshot({ path: file, fullPage: true });
      const bad = states.filter(s => s.state !== 'rendered');
      const ok = !errors.length && !bad.length && (pageArg || states.length > 0);
      if (!ok) failed++;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${t.name}  (${states.length} blocks)  -> ${path.relative(ROOT, file)}`);
      bad.forEach(s => console.log(`      block ${s.id} state=${s.state} ${s.msg || ''}`));
      errors.forEach(e => console.log('      ' + e.slice(0, 400)));
      if (!pageArg && !states.length) console.log('      no samples rendered (manifest.samples empty?)');
    } catch (e) {
      failed++;
      console.log(`FAIL  ${t.name}  ${e.message}`);
      errors.forEach(x => console.log('      ' + x.slice(0, 400)));
    }
    await page.close();
  }
  await browser.close();
  server.close();
  console.log(`\n${targets.length - failed}/${targets.length} passed`);
  process.exit(failed ? 1 : 0);
})();
