// Run: node tests/js/i18n.test.js   (no dependencies)
// Locale-dependent core behaviour (docs/architecture.md §7.5): RK.format in zh-CN (n.a. / n.m., month and weekday
// names, date presets, English text-month codes in Chinese order, locale switches that keep page overrides) and
// the red-up / green-down convention in RK.theme (pos / neg swapped and the diverging ramp reversed).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { loadRK, coreDir, runner } = require('./_harness');

const { t, done } = runner('i18n.test.js');
/** deepStrictEqual across realms (values from the vm sandbox have the sandbox's Array / Object prototypes). */
function eq(a, b, msg) { assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg); }
function fakeDocument(metas, lang) {
  metas = metas || {};
  return {
    querySelector(sel) {
      const m = /^meta\[name="([^"]+)"\]$/.exec(sel);
      if (m && metas[m[1]] != null) return { getAttribute: () => metas[m[1]], content: metas[m[1]] };
      return null;
    },
    documentElement: { getAttribute: n => (n === 'lang' ? (lang == null ? null : lang) : null) }
  };
}
const D = '2026-10-14';   // a Wednesday

/* ================================================================== RK.format: English defaults */
{
  const F = loadRK().format;
  t('en: n.a. / n.m. and English names unchanged', () => {
    assert.strictEqual(F(null, '0.0x'), 'n.a.');
    assert.strictEqual(F(NaN, '0.0x'), 'n.m.');
    assert.strictEqual(F(D, 'dd mmm yyyy'), '14 Oct 2026');
    assert.strictEqual(F(D, 'dddd, d mmmm yyyy'), 'Wednesday, 14 October 2026');
    assert.strictEqual(F(D, 'date'), '14 Oct 2026');
    assert.strictEqual(F(D, 'month'), 'Oct 26');
    assert.strictEqual(F.dateCode('dd mmm yyyy'), 'dd mmm yyyy');
  });
}

/* ================================================================== RK.format: zh-CN */
{
  const RK = loadRK({ document: fakeDocument({ 'rk:locale': 'zh-CN' }, 'zh-CN') });
  const F = RK.format;
  t('zh: n.a. -> 不适用, n.m. -> 无意义 (null, "", Invalid Date, NaN, Infinity, compiled codes)', () => {
    assert.strictEqual(F(null, '0.0x'), '不适用');
    assert.strictEqual(F('', '0.0%'), '不适用');
    assert.strictEqual(F(new Date(NaN), 'dd mmm yyyy'), '不适用');
    assert.strictEqual(F(NaN, '0.0x'), '无意义');
    assert.strictEqual(F(Infinity, 'auto'), '无意义');
    assert.strictEqual(F.compile('0.0x')(-Infinity), '无意义');
    assert.strictEqual(F(null, '0.0x', { na: '—' }), '—');            // per-call override still wins
  });
  t('zh: month / weekday names', () => {
    eq(F.config.months.slice(0, 3).concat(F.config.months.slice(9)), ['1月', '2月', '3月', '10月', '11月', '12月']);
    assert.strictEqual(F(D, 'mmm'), '10月');
    assert.strictEqual(F(D, 'mmmm'), '十月');
    assert.strictEqual(F(D, 'ddd'), '周三');
    assert.strictEqual(F(D, 'dddd'), '星期三');
  });
  t('zh: date / month presets and Date objects', () => {
    assert.strictEqual(F.presets.date, 'yyyy"年"m"月"d"日"');
    assert.strictEqual(F(D, 'date'), '2026年10月14日');
    assert.strictEqual(F(D, 'month'), '26年10月');
    assert.strictEqual(F(new Date(2026, 0, 5)), '2026年1月5日');        // a Date without a code uses the 'date' preset
    assert.strictEqual(F(2025, 'yyyy'), '2025');
  });
  t('zh: English text-month codes are written in Chinese order', () => {
    const cases = {
      'dd mmm yyyy': '2026年10月14日', 'd mmm yyyy': '2026年10月14日', 'd mmmm yyyy': '2026年10月14日',
      'dd mmm yy': '26年10月14日', 'mmm yy': '26年10月', 'mmm-yy': '26年10月', 'mmmm yyyy': '2026年10月',
      'mmm yyyy': '2026年10月', 'd mmm': '10月14日', 'dd-mmm-yyyy': '2026年10月14日', 'mmm d, yyyy': '2026年10月14日',
      'ddd, d mmm yyyy': '2026年10月14日 周三', 'dddd d mmmm yyyy': '2026年10月14日 星期三', '[$-409]d mmm yyyy': '2026年10月14日',
      'dd\\-mmm\\-yy': '26年10月14日'
    };
    for (const [code, want] of Object.entries(cases)) assert.strictEqual(F(D, code), want, code);
    assert.strictEqual(F.dateCode('dd mmm yyyy'), 'yyyy"年"m"月"d"日"');
    assert.strictEqual(F.dateCode('date'), 'yyyy"年"m"月"d"日"');
    assert.strictEqual(F.dateCode('0.0x'), '0.0x');
  });
  t('zh: numeric dates, quarters, literal text and Chinese codes stay as written', () => {
    assert.strictEqual(F(D, 'yyyy-mm-dd'), '2026-10-14');
    assert.strictEqual(F(D, 'dd/mm/yyyy'), '14/10/2026');
    assert.strictEqual(F(D, 'yyyy"年"m"月"d"日"'), '2026年10月14日');
    assert.strictEqual(F(D, '"Q"q yyyy'), 'Q4 2026');
    assert.strictEqual(F(D, 'mmm yy "E"'), '10月 26 E');               // literal text: order kept, names localised
  });
  t('zh: numbers and compact units unaffected by the date rules', () => {
    assert.strictEqual(F(1234.5, '#,##0.0'), '1,234.5');
    assert.strictEqual(F(1.5e9, 'auto'), '15亿');
    assert.strictEqual(F(0.052, '+0.0%;-0.0%;0.0%'), '+5.2%');
  });
  t('zh: RK.expr text() and a data view format through the locale', () => {
    assert.strictEqual(RK.expr.evaluate('text(null, "0.0")', {}), '不适用');
  });
}

/* ================================================================== locale switches */
{
  const RK = loadRK();
  const F = RK.format;
  t('switch en -> zh -> en swaps every kit default and the compiled-code cache', () => {
    assert.strictEqual(F(D, 'dd mmm yyyy'), '14 Oct 2026');   // compiled + cached in en
    RK.i18n.set('zh-CN');
    assert.strictEqual(F(D, 'dd mmm yyyy'), '2026年10月14日');
    assert.strictEqual(F(null), '不适用');
    assert.strictEqual(F(2.5e4, 'auto'), '2.5万');
    RK.i18n.set('en');
    assert.strictEqual(F(D, 'dd mmm yyyy'), '14 Oct 2026');
    assert.strictEqual(F(D, 'date'), '14 Oct 2026');
    assert.strictEqual(F(null), 'n.a.');
    assert.strictEqual(F(NaN), 'n.m.');
    assert.strictEqual(F(2.5e4, 'auto'), '25k');
  });
  t('values a page set itself survive locale switches', () => {
    const R = loadRK();
    R.format.config.na = '–';
    R.format.config.months = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
    R.format.presets.date = 'yyyy-mm-dd';
    R.i18n.set('zh-CN');
    assert.strictEqual(R.format(null), '–');
    assert.strictEqual(R.format(NaN), '无意义');                       // nm was not overridden: follows the locale
    assert.strictEqual(R.format(D, 'date'), '2026-10-14');
    assert.strictEqual(R.format.presets.month, 'yy"年"m"月"');
    assert.strictEqual(R.format(D, 'mmm'), 'O');
    R.i18n.set('en');
    assert.strictEqual(R.format(null), '–');
    assert.strictEqual(R.format(D, 'date'), '2026-10-14');
  });
  t('an unknown language falls back to English defaults', () => {
    const R = loadRK({ document: fakeDocument({}, 'de-DE') });
    assert.strictEqual(R.format(D, 'dd mmm yyyy'), '14 Oct 2026');
    assert.strictEqual(R.format(null), 'n.a.');
  });
}

/* ================================================================== RK.theme: red up / green down */
/** Minimal DOM for rk.theme.js: <html> attributes + inline style, and getComputedStyle over theme tokens. */
function themeDom(tokens, attrs) {
  const inline = new Map(), at = Object.assign({ 'data-rk-theme': 'navy' }, attrs || {});
  const root = {
    getAttribute: n => (n in at ? at[n] : null),
    setAttribute: (n, v) => { at[n] = String(v); },
    style: { setProperty: (p, v) => inline.set(p, v), removeProperty: p => inline.delete(p) }
  };
  const document = { documentElement: root, querySelector: () => null };
  const getComputedStyle = () => ({ getPropertyValue: p => (inline.has(p) ? inline.get(p) : (tokens[p] || '')) });
  return { document, getComputedStyle, inline };
}
function themeRK(dom) {
  const sandbox = Object.assign({ console, Promise, setTimeout, clearTimeout, Map, Set, Math, JSON, Date },
    { document: dom.document, getComputedStyle: dom.getComputedStyle });
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of ['rk.core.js', 'rk.format.js', 'rk.expr.js', 'rk.data.js', 'rk.theme.js', 'rk.chart.js']) {
    vm.runInContext(fs.readFileSync(path.join(coreDir, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox.RK;
}
const NAVY = {
  '--rk-paper': '#ffffff', '--rk-ink': '#0f1c2e', '--rk-accent': '#0b2d5b', '--rk-accent-2': '#b08d57',
  '--rk-pos': '#2e7d6f', '--rk-neg': '#b0414e', '--rk-ref': '#b3261e',
  '--rk-cat-1': '#0b2d5b', '--rk-cat-2': '#9f3960',
  '--rk-seq-1': '#f1f5fa', '--rk-seq-7': '#0b2d5b',
  '--rk-div-1': '#8c3b4a', '--rk-div-2': '#c07a85', '--rk-div-3': '#e7c9cd', '--rk-div-4': '#f3f1ee',
  '--rk-div-5': '#c9d8ea', '--rk-div-6': '#6f98c8', '--rk-div-7': '#0b2d5b'
};
const NAVY_DIV = ['#8c3b4a', '#c07a85', '#e7c9cd', '#f3f1ee', '#c9d8ea', '#6f98c8', '#0b2d5b'];
{
  const dom = themeDom(NAVY);
  const RK = themeRK(dom);
  t('theme us: tokens as the theme defines them, no inline overrides', () => {
    const tk = RK.theme.refresh();
    assert.strictEqual(tk.updown, 'us');
    assert.strictEqual(tk.pos, '#2e7d6f');
    assert.strictEqual(tk.neg, '#b0414e');
    eq(tk.div, NAVY_DIV);
    assert.strictEqual(dom.inline.size, 0);
  });
  t('theme cn: pos / neg swapped and the diverging ramp reversed (tokens + CSS custom properties)', () => {
    RK.theme.setUpdown('cn');
    const tk = RK.theme.tokens();
    assert.strictEqual(tk.updown, 'cn');
    assert.strictEqual(tk.pos, '#b0414e');
    assert.strictEqual(tk.neg, '#2e7d6f');
    eq(tk.div, NAVY_DIV.slice().reverse());
    assert.strictEqual(dom.inline.get('--rk-pos'), '#b0414e');
    assert.strictEqual(dom.inline.get('--rk-neg'), '#2e7d6f');
    assert.strictEqual(dom.inline.get('--rk-div-1'), '#0b2d5b');
    assert.strictEqual(dom.inline.get('--rk-div-7'), '#8c3b4a');
    assert.strictEqual(dom.inline.get('--rk-div-4'), '#f3f1ee');
    assert.strictEqual(tk.ref, '#b3261e');                          // reference lines keep their colour
  });
  t('theme cn: the high end of a diverging scale is now the red side (= pos), the low end the former up colour', () => {
    const sc = RK.theme.diverging([-1, 1], 0);
    assert.strictEqual(sc(1), '#8c3b4a');
    assert.strictEqual(sc(-1), '#0b2d5b');
    assert.strictEqual(sc(0), '#f3f1ee');
    assert.strictEqual(RK.theme.resolve('div1'), '#0b2d5b');
  });
  t('theme cn: refresh / theme switch re-applies from the theme values (no double swap)', () => {
    RK.theme.refresh(); RK.theme.refresh();
    const tk = RK.theme.tokens();
    assert.strictEqual(tk.pos, '#b0414e');
    eq(tk.div, NAVY_DIV.slice().reverse());
  });
  t('theme back to us: inline overrides removed, original order restored', () => {
    RK.theme.setUpdown('us');
    const tk = RK.theme.tokens();
    assert.strictEqual(tk.pos, '#2e7d6f');
    eq(tk.div, NAVY_DIV);
    assert.strictEqual(dom.inline.size, 0);
  });
}
{
  // a theme with gaps in its div slots: tokens reversed, CSS slots left alone (no misaligned writes)
  const tokens = Object.assign({}, NAVY);
  delete tokens['--rk-div-3'];
  const dom = themeDom(tokens, { 'data-rk-updown': 'cn' });
  const RK = themeRK(dom);
  t('theme cn: div slots are only rewritten when they map 1:1 to the ramp', () => {
    const tk = RK.theme.refresh();
    assert.strictEqual(tk.div.length, 6);
    assert.strictEqual(tk.div[0], '#0b2d5b');
    assert.ok(!dom.inline.has('--rk-div-1') || dom.inline.get('--rk-div-1') === '#0b2d5b');
    assert.strictEqual(dom.inline.get('--rk-pos'), '#b0414e');
  });
}

/* ================================================================== RK.chart wheel rule (Ctrl or ⌘ + wheel zooms) */
{
  const RK = themeRK(themeDom(NAVY));
  const C = RK.chart;
  function fakeEl() {
    const ls = [];
    return {
      ls,
      addEventListener: (type, fn, o) => ls.push({ type, fn, capture: !!(o && o.capture) }),
      removeEventListener: (type, fn) => { const i = ls.findIndex(l => l.type === type && l.fn === fn); if (i >= 0) ls.splice(i, 1); },
      fire(ev) { let stopped = false; ev.stopPropagation = () => { stopped = true; }; ls.filter(l => l.type === 'wheel').forEach(l => l.fn(ev)); return stopped; }
    };
  }
  t('wheel guard: plain wheel stopped (page scrolls), Ctrl / ⌘ / pinch reach the chart', () => {
    const el = fakeEl(), g = C.wheelGuard(el, {});
    assert.strictEqual(g.active, true);
    assert.strictEqual(el.ls.length, 1);
    assert.strictEqual(el.ls[0].capture, true);
    assert.strictEqual(el.fire({}), true);
    assert.strictEqual(el.fire({ shiftKey: true }), true);
    assert.strictEqual(el.fire({ ctrlKey: true }), false);
    assert.strictEqual(el.fire({ metaKey: true }), false);
    g.destroy();
    assert.strictEqual(el.ls.length, 0);
  });
  t('wheel guard: options.wheelZoom true installs nothing and leaves the option alone', () => {
    const el = fakeEl(), g = C.wheelGuard(el, { wheelZoom: true });
    assert.strictEqual(g.active, false);
    assert.strictEqual(el.ls.length, 0);
    const opt = { dataZoom: [{ type: 'inside', zoomOnMouseWheel: 'ctrl' }] };
    assert.strictEqual(g.adapt(opt).dataZoom[0].zoomOnMouseWheel, 'ctrl');
  });
  t('guarded charts: inside zoom "ctrl" -> true (so ⌘ zooms), sliders / false / timeline baseOption handled', () => {
    const ctx = { options: {}, print: false };
    const opt = { dataZoom: C.zoom(ctx, 'x').concat(C.zoom({ options: { wheelZoom: false } }, 'y')) };
    assert.strictEqual(opt.dataZoom[0].zoomOnMouseWheel, 'ctrl');      // RK.chart.zoom itself still asks for 'ctrl'
    C.wheelGuard(fakeEl(), {}).adapt(opt);
    assert.strictEqual(opt.dataZoom[0].zoomOnMouseWheel, true);
    assert.strictEqual(opt.dataZoom[1].type, 'slider');
    assert.strictEqual(opt.dataZoom[1].zoomOnMouseWheel, undefined);
    assert.strictEqual(opt.dataZoom[2].zoomOnMouseWheel, false);
    const single = { dataZoom: { type: 'inside', zoomOnMouseWheel: 'ctrl' } };
    assert.strictEqual(C.modifierZoom(single).dataZoom.zoomOnMouseWheel, true);
    const tl = { baseOption: { dataZoom: [{ type: 'inside', zoomOnMouseWheel: 'ctrl' }] }, options: [] };
    assert.strictEqual(C.modifierZoom(tl).baseOption.dataZoom[0].zoomOnMouseWheel, true);
    assert.strictEqual(C.modifierZoom(null), null);
  });
}

done();
