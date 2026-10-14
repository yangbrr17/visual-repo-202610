// Run: node tests/js/runtime-api.test.js   (no dependencies)
// Runtime APIs that work without a browser: RK.i18n (+ locale-dependent RK.format), RK.template (title templates),
// RK.data.reportKey / storageKey, saved user metrics (fake localStorage), RK.data.describeFilter / applied.
'use strict';
const assert = require('assert');
const { loadRK, sample, runner } = require('./_harness');

const { t, done } = runner('runtime-api.test.js');
/** deepStrictEqual across realms (values from the vm sandbox have the sandbox's Array / Object prototypes). */
function eq(a, b, msg) { assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg); }

/* ------------------------------------------------------------------ fakes */
function fakeStorage(opts) {
  opts = opts || {};
  const m = new Map();
  return {
    _map: m,
    getItem(k) { if (opts.throws) throw new Error('SecurityError'); return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { if (opts.throws || opts.full) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
    removeItem(k) { if (opts.throws) throw new Error('SecurityError'); m.delete(k); },
    key(i) { return [...m.keys()][i] ?? null; },
    get length() { return m.size; }
  };
}
/** document with <meta name=...> values and <html lang>. */
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
async function report(globals, manifest, ids) {
  const RK = loadRK(globals);
  const datasets = {};
  for (const id of ids || ['peers']) datasets[id] = sample(id);
  await RK.data.load({ bundle: { manifest: manifest || { report: { title: 'Project Atlas', date: '2026-10-14' }, params: { wacc: { value: 0.09, format: '0.0%' } } }, datasets } });
  return RK;
}
const ATLAS = { report: { title: 'Project Atlas', date: '2026-10-14' }, params: { wacc: { value: 0.09, format: '0.0%' }, g: { value: 0.02 } } };
const BUILT = { 'rk:built': '2026-10-13T09:30:00Z' };

(async () => {
  /* ================================================================== i18n */
  {
    const RK = loadRK();
    const I = RK.i18n;
    t('i18n: locale defaults to en without a document', () => assert.strictEqual(I.locale, 'en'));
    t('i18n: t() returns the en string', () => {
      assert.strictEqual(I.t('viewData', 'xx'), 'View data');
      assert.strictEqual(I.t('downloadCSV'), 'Download CSV');
      assert.strictEqual(I.t('noData'), 'No data for the current filters');
      assert.strictEqual(I.t('filteredView'), 'Filtered view');
      assert.strictEqual(I.t('selectionNotInView'), 'Selection not in this view');
    });
    t('i18n: unknown key -> fallback, else the key', () => {
      assert.strictEqual(I.t('nope.key', 'Fallback text'), 'Fallback text');
      assert.strictEqual(I.t('nope.key'), 'nope.key');
    });
    t('i18n: {vars} interpolation (vars as 2nd or 3rd argument); unknown vars stay', () => {
      assert.strictEqual(I.t('showingFirst', { max: 500, n: 812 }), 'Showing first 500 of 812 rows.');
      assert.strictEqual(I.t('x.y', 'Hello {who} {missing}', { who: 'Ann' }), 'Hello Ann {missing}');
    });
    t('i18n: a "constructor" / "__proto__" key is an ordinary missing key', () => {
      assert.strictEqual(I.t('constructor', 'fb'), 'fb');
      assert.strictEqual(I.t('__proto__', 'fb2'), 'fb2');
      assert.strictEqual(I.t('toString'), 'toString');
    });
    t('i18n: every en string has a zh-CN translation', () => {
      const en = Object.keys(I.packs.en), zh = I.packs['zh-CN'];
      const missing = en.filter(k => !Object.prototype.hasOwnProperty.call(zh, k));
      eq(missing, []);
      // placeholders survive translation
      en.forEach(k => {
        const a = (I.packs.en[k].match(/\{\w+\}/g) || []).sort().join(), b = (zh[k].match(/\{\w+\}/g) || []).sort().join();
        assert.strictEqual(b, a, 'placeholders of ' + k);
      });
    });
    t('i18n: add() registers component strings; en falls back to the caller text', () => {
      I.add('zh-CN', { 'myComp.title': '我的组件' });
      assert.strictEqual(I.t('myComp.title', 'My component'), 'My component');
      I.set('zh-CN');
      assert.strictEqual(I.t('myComp.title', 'My component'), '我的组件');
      I.set('en');
    });
    t('i18n: set() switches locale and RK.format follows (compact units, booleans)', () => {
      const F = RK.format;
      assert.strictEqual(F(1.5e9, 'auto'), '1.5bn');
      assert.strictEqual(F(true), 'Yes');
      I.set('zh-CN');
      assert.strictEqual(F(1.5e9, 'auto'), '15亿');
      assert.strictEqual(F(false), '否');
      I.set('en-US');
      assert.strictEqual(F(1.5e9, 'auto'), '1.5bn');
      assert.strictEqual(I.t('expand'), 'Expand');
    });
  }
  {
    const RK = loadRK({ document: fakeDocument({ 'rk:locale': 'zh-CN' }, 'en') });
    t('i18n: <meta name="rk:locale"> wins over <html lang>', () => assert.strictEqual(RK.i18n.locale, 'zh-CN'));
    t('i18n: zh-CN pack', () => {
      const I = RK.i18n;
      assert.strictEqual(I.t('viewData'), '查看数据');
      assert.strictEqual(I.t('downloadCSV'), '下载 CSV');
      assert.strictEqual(I.t('downloadPNG'), '下载 PNG');
      assert.strictEqual(I.t('noData'), '当前筛选条件下无数据');
      assert.strictEqual(I.t('reset'), '重置');
      assert.strictEqual(I.t('filteredView'), '筛选视图');
      assert.strictEqual(I.t('selectionNotInView'), '所选项不在本视图中');
      assert.strictEqual(I.t('showingFirst', { max: 5, n: 9 }), '显示前 5 行，共 9 行。');
      assert.strictEqual(I.t('nope', 'English fallback'), 'English fallback');
    });
    t('format zh-CN: compact units 亿 / 万', () => {
      const F = RK.format;
      eq(F.config.compactUnits.map(u => u[1]), ['亿', '万']);
      assert.strictEqual(F(1.5e9, 'auto'), '15亿');
      assert.strictEqual(F(1.23e8, 'auto'), '1.2亿');
      assert.strictEqual(F(25000, 'auto'), '2.5万');
      assert.strictEqual(F(-30000, 'auto'), '-3万');
      assert.strictEqual(F(999950, 'auto'), '100万');
      assert.strictEqual(F(9999.6, 'auto'), '1万');      // rounds up into the unit
      assert.strictEqual(F(4520, 'auto'), '4520');
      assert.strictEqual(F.compact(99995000, 1), '9999.5万');
      assert.strictEqual(F.compact(99999500, 1), '1亿');           // 9999.95万 rounds into the next unit
      assert.strictEqual(F(1234.5, '#,##0.0'), '1,234.5'); // explicit codes unchanged
    });
  }
  {
    const zh = loadRK({ document: fakeDocument({}, 'zh') });
    const en = loadRK({ document: fakeDocument({}, 'en-US') });
    const und = loadRK({ document: fakeDocument({}, 'zh_cn') });
    t('i18n: <html lang> zh -> zh-CN pack; en-US -> en; zh_cn normalised', () => {
      assert.strictEqual(zh.i18n.locale, 'zh');
      assert.strictEqual(zh.i18n.t('expand'), '放大查看');
      assert.strictEqual(zh.format(25000, 'auto'), '2.5万');
      assert.strictEqual(en.i18n.locale, 'en-US');
      assert.strictEqual(en.i18n.t('expand'), 'Expand');
      assert.strictEqual(en.format(25000, 'auto'), '25k');
      assert.strictEqual(und.i18n.locale, 'zh-CN');
    });
    t('format: a page that set its own compactUnits keeps them on a locale switch', () => {
      const RK = loadRK();
      RK.format.config.compactUnits = [[1e6, ' mio']];
      RK.i18n.set('zh-CN');
      assert.strictEqual(RK.format(2.5e6, 'auto'), '2.5 mio');
    });
  }

  /* ================================================================== templates */
  {
    const RK = await report({}, ATLAS);
    const T = RK.template, ds = RK.data.get('peers');
    const rows = ds.rows;
    const med = RK.expr.evaluate('median(ev_ebitda_25e)', rows);
    t('template: parse dataset / expr / format', () => {
      const p = T.parse('Helios at {{peers: median(ev_ebitda_25e) | 0.0x}} vs {{@wacc | 0.0%}}!');
      assert.strictEqual(p.length, 5);
      assert.strictEqual(p[0], 'Helios at ');
      eq([p[1].dataset, p[1].expr, p[1].format], ['peers', 'median(ev_ebitda_25e)', '0.0x']);
      eq([p[3].dataset, p[3].expr, p[3].format], [null, '@wacc', '0.0%']);
      assert.strictEqual(p[4], '!');
    });
    t('template: "||" is logical or, "|" inside quotes is text, ternary ":" is not a dataset', () => {
      let p = T.parse('{{peers: a || b}}')[0];
      eq([p.dataset, p.expr, p.format], ['peers', 'a || b', null]);
      p = T.parse('{{peers: if(is_target, "a|b", "c") | @}}')[0];
      eq([p.expr, p.format], ['if(is_target, "a|b", "c")', '@']);
      p = T.parse('{{ev > 1 ? 1 : 0}}')[0];
      eq([p.dataset, p.expr], [null, 'ev > 1 ? 1 : 0']);
      p = T.parse('{{my.data-set_2: count()}}')[0];
      assert.strictEqual(p.dataset, 'my.data-set_2');
    });
    t('template: aggregate over the dataset (explicit format)', () => {
      assert.strictEqual(T.render('Peers at {{peers: median(ev_ebitda_25e) | 0.0x}}'), 'Peers at ' + RK.format(med, '0.0x'));
    });
    t('template: format inferred from the field when omitted', () => {
      assert.strictEqual(T.render('{{peers: median(ev_ebitda_25e)}}'), RK.format(med, '0.0x'));
      assert.strictEqual(T.render('{{peers: sum(ev)}}'), RK.format(RK.expr.evaluate('sum(ev)', rows), '$#,##0'));
      assert.strictEqual(T.render('{{peers: count()}} peers'), '18 peers');
    });
    t('template: @param with its manifest format, or an explicit one', () => {
      assert.strictEqual(T.render('WACC {{@wacc}}'), 'WACC 9.0%');
      assert.strictEqual(T.render('WACC {{ @wacc | 0.00% }}'), 'WACC 9.00%');
      assert.strictEqual(T.render('g {{@g | 0.0%}}'), 'g 2.0%');
      assert.strictEqual(T.render('{{@wacc - @g | 0.0%}}'), '7.0%');
    });
    t('template: plain field / row formula = first filtered row', () => {
      assert.strictEqual(T.render('{{peers: company}}'), rows[0].company);
      assert.strictEqual(T.render('{{peers: ev / ebitda_25e | 0.0x}}'), RK.format(rows[0].ev / rows[0].ebitda_25e, '0.0x'));
      assert.strictEqual(T.render('{{peers: `Enterprise value`}}'), RK.format(rows[0].ev, '$#,##0'));
    });
    t('template: evaluated on the CURRENTLY FILTERED view', () => {
      RK.store.setFilter('region', { field: 'region', op: 'in', values: ['Europe'] });
      const eu = rows.filter(r => r.region === 'Europe');
      assert.ok(eu.length > 0 && eu.length < rows.length);
      assert.strictEqual(T.render('{{peers: count()}}'), String(eu.length));
      assert.strictEqual(T.render('{{peers: median(ev_ebitda_25e) | 0.0x}}'), RK.format(RK.expr.evaluate('median(ev_ebitda_25e)', eu), '0.0x'));
      assert.strictEqual(T.render('{{peers: company}}'), eu[0].company);
      // opts.filters === false (page data-rk-filters="off") reads every row
      assert.strictEqual(T.render('{{peers: count()}}', { filters: false }), '18');
      RK.store.clearFilter('region');
      assert.strictEqual(T.render('{{peers: count()}}'), '18');
    });
    t('template: no rows -> aggregates of nothing, fields n.a.', () => {
      RK.store.setFilter('region', { field: 'region', op: 'in', values: ['Antarctica'] });
      assert.strictEqual(T.render('{{peers: count()}}|{{peers: company}}|{{peers: median(ev)}}'), '0|n.a.|n.a.');
      RK.store.clearFilter('region');
    });
    t('template: opts.rows(ds) and opts.dataset (a block\'s own rows / dataset)', () => {
      const sub = rows.slice(3, 5);
      assert.strictEqual(T.render('{{count()}} / {{company}}', { dataset: 'peers', rows: () => sub }), '2 / ' + sub[0].company);
    });
    t('template: unresolvable placeholders render as "…" and report the error', () => {
      const errs = [];
      const out = T.render('A {{nosuch: count()}} B {{revnue}} C {{peers: revnue}} D {{}}', { onError: (e, p) => errs.push(p.src + ': ' + e.message) });
      assert.strictEqual(out, 'A … B … C … D …');
      assert.strictEqual(errs.length, 4);
      assert.ok(/Unknown dataset "nosuch"/.test(errs[0]), errs[0]);
      assert.ok(/Name the dataset/.test(errs[1]), errs[1]);
      assert.ok(/did you mean/i.test(errs[2]), errs[2]);
      assert.strictEqual(T.render('{{peers: count(}}', { missing: '?' }), '?');
    });
    t('template: text without placeholders is unchanged; fallback() / test() / datasets()', () => {
      assert.strictEqual(T.render('Plain {title} text'), 'Plain {title} text');
      assert.strictEqual(T.fallback('At {{peers: median(x) | 0.0x}} and {{@wacc}}.'), 'At … and ….');
      assert.strictEqual(T.test('a {{@wacc}}'), true);
      assert.strictEqual(T.test('a {b}'), false);
      eq(T.datasets('{{peers: count()}} {{@wacc}} {{fin: sum(x)}} {{peers: max(ev)}}'), ['peers', 'fin']);
    });
    t('template: output is text, never markup (values are not escaped or interpreted)', () => {
      RK.data.put({ id: 'xss', data: [{ name: '<img src=x onerror=alert(1)>' }] });
      assert.strictEqual(RK.template.render('{{xss: name}}'), '<img src=x onerror=alert(1)>');
    });
    t('template: params follow setParam', () => {
      RK.store.setParam('wacc', 0.1);
      assert.strictEqual(T.render('{{@wacc}}'), '10.0%');
    });
  }

  /* ================================================================== reportKey / storage keys */
  {
    const RK = await report({ document: fakeDocument(BUILT), localStorage: fakeStorage() }, ATLAS);
    t('reportKey = title | date | rk:built', () => assert.strictEqual(RK.data.reportKey(), 'Project Atlas|2026-10-14|2026-10-13T09:30:00Z'));
    t('storageKey namespaces by report: rk:theme:<key>, rk:metrics:<key>', () => {
      assert.strictEqual(RK.data.storageKey('theme'), 'rk:theme:Project Atlas|2026-10-14|2026-10-13T09:30:00Z');
      assert.strictEqual(RK.data.storageKey('metrics'), 'rk:metrics:Project Atlas|2026-10-14|2026-10-13T09:30:00Z');
    });
    const other = await report({ document: fakeDocument({ 'rk:built': '2026-10-15T08:00:00Z' }) }, ATLAS);
    t('reportKey differs for a rebuild of the same report (rk:built)', () => assert.notStrictEqual(other.data.reportKey(), RK.data.reportKey()));
    const anon = await report({ location: { pathname: '/gallery/index.html' } }, { report: {} });
    t('reportKey without any report identity falls back to the page path', () => assert.strictEqual(anon.data.reportKey(), '|||/gallery/index.html'));
    const pre = loadRK({ document: fakeDocument(BUILT) });
    pre.data.preload({ manifest: ATLAS, datasets: {} });
    t('reportKey is available before load() from the preloaded bundle (theme restore at boot)', () => assert.strictEqual(pre.data.reportKey(), 'Project Atlas|2026-10-14|2026-10-13T09:30:00Z'));
  }

  /* ================================================================== user metrics */
  {
    const store = fakeStorage();
    const G = () => ({ document: fakeDocument(BUILT), localStorage: store });
    const RK = await report(G(), ATLAS, ['peers', 'financials']);
    const KEY = 'rk:metrics:Project Atlas|2026-10-14|2026-10-13T09:30:00Z';
    const peers = RK.data.get('peers');
    t('user metric: addComputed({user: true}) persists {dataset, name, title, formula, format}', () => {
      peers.addComputed({ name: 'ev_sales', title: 'EV / Sales', formula: 'ev / revenue_25e', format: '0.0x', user: true });
      const saved = JSON.parse(store.getItem(KEY));
      eq(saved, [{ dataset: 'peers', name: 'ev_sales', title: 'EV / Sales', formula: 'ev / revenue_25e', format: '0.0x' }]);
      assert.strictEqual(peers.field('ev_sales').user, true);
    });
    t('user metric: report computed fields (no user flag) are not persisted', () => {
      peers.addComputed({ name: 'net_cash', formula: '-net_debt' });
      assert.strictEqual(JSON.parse(store.getItem(KEY)).length, 1);
      peers.removeComputed('net_cash');
    });
    t('user metric: redefining keeps one entry, updated in place', () => {
      peers.addComputed({ name: 'margin_x', title: 'Margin x', formula: 'ebitda_margin_25e * 2', format: '0.0%', user: true });
      peers.addComputed({ name: 'ev_sales', title: 'EV / Sales 25E', formula: 'ev / revenue_25e', format: '0.00x', user: true });
      const saved = JSON.parse(store.getItem(KEY));
      eq(saved.map(m => m.name), ['ev_sales', 'margin_x']);
      assert.strictEqual(saved[0].title, 'EV / Sales 25E');
      assert.strictEqual(saved[0].format, '0.00x');
    });
    t('user metric: a metric built on another user metric', () => {
      peers.addComputed({ name: 'ev_sales_prem', title: 'EV/Sales premium', formula: 'ev_sales / 2', user: true });
      RK.data.get('financials').addComputed({ name: 'fin_metric', formula: '1', user: true });
      assert.strictEqual(JSON.parse(store.getItem(KEY)).length, 4);
    });
    t('userMetrics() lists the saved metrics (active = applied now)', () => {
      const list = RK.data.userMetrics();
      eq(list.map(m => m.dataset + '.' + m.name + ':' + m.active), ['peers.ev_sales:true', 'peers.margin_x:true', 'peers.ev_sales_prem:true', 'financials.fin_metric:true']);
      eq(Object.keys(list[0]).sort(), ['active', 'dataset', 'format', 'formula', 'name', 'title']);
    });

    // reopen the same report: metrics come back
    const RK2 = await report(G(), ATLAS, ['peers', 'financials']);
    const p2 = RK2.data.get('peers');
    t('user metric: restored after load() for the same report (values computed, flagged user)', () => {
      const f = p2.field('ev_sales');
      assert.ok(f && f.computed && f.user);
      assert.strictEqual(f.title, 'EV / Sales 25E');
      assert.strictEqual(f.format, '0.00x');
      const r = p2.rows[0];
      assert.ok(Math.abs(r.ev_sales - r.ev / r.revenue_25e) < 1e-12);
      assert.ok(Math.abs(r.ev_sales_prem - r.ev_sales / 2) < 1e-12);   // dependency order kept
      assert.ok(RK2.data.get('financials').has('fin_metric'));
    });
    t('user metric: restored metrics are usable in queries and templates', () => {
      const q = RK2.query('median(ev_sales) from peers');
      assert.ok(q.rows[0].c1 > 0);
      assert.strictEqual(RK2.template.render('{{peers: max(ev_sales)}}'), RK2.format(RK2.expr.evaluate('max(ev_sales)', p2.rows), '0.00x'));
    });
    t('user metric: restoring does not re-write storage', () => {
      assert.strictEqual(JSON.parse(store.getItem(KEY)).length, 4);
    });

    // another report sharing the same (file://) storage origin sees nothing
    const RK3 = await report({ document: fakeDocument(BUILT), localStorage: store }, { report: { title: 'Project Borealis', date: '2026-10-14' } }, ['peers']);
    t('user metric: another report (different key) does not restore them', () => {
      assert.strictEqual(RK3.data.get('peers').has('ev_sales'), false);
      eq(RK3.data.userMetrics(), []);
    });

    t('removeUserMetric(ds, name) deletes field and saved entry', () => {
      assert.strictEqual(RK2.data.removeUserMetric('peers', 'margin_x'), true);
      assert.strictEqual(p2.has('margin_x'), false);
      assert.ok(!('margin_x' in p2.rows[0]));
      eq(JSON.parse(store.getItem(KEY)).map(m => m.name), ['ev_sales', 'ev_sales_prem', 'fin_metric']);
      assert.strictEqual(RK2.data.removeUserMetric(p2, 'margin_x'), false);   // already gone
    });
    t('removeComputed() of a user metric also forgets it', () => {
      RK2.data.get('financials').removeComputed('fin_metric');
      eq(JSON.parse(store.getItem(KEY)).map(m => m.name), ['ev_sales', 'ev_sales_prem']);
    });
    t('removeUserMetric of the last metric removes the storage key', () => {
      RK2.data.removeUserMetric('peers', 'ev_sales_prem');
      RK2.data.removeUserMetric('peers', 'ev_sales');
      assert.strictEqual(store.getItem(KEY), null);
    });

    // metrics that no longer compile are skipped (and kept: the field may come back)
    store.setItem(KEY, JSON.stringify([
      { dataset: 'peers', name: 'gone', title: 'Gone', formula: 'old_field * 2', format: null },
      { dataset: 'peers', name: 'ok_metric', title: 'OK', formula: 'ev / 1000', format: '0.0' },
      { dataset: 'nosuch', name: 'x', title: 'X', formula: '1', format: null },
      { dataset: 'peers', name: 'ev', title: 'Shadow', formula: 'ev * 0', format: null },   // a real column: never overwritten
      { dataset: 'peers', name: 'loop_a', title: 'Loop', formula: 'sum(ev)', format: null },  // aggregate: not a row formula
      'garbage', null, { dataset: 'peers' }
    ]));
    const RK4 = await report(G(), ATLAS, ['peers']);
    const p4 = RK4.data.get('peers');
    t('user metric: entries that no longer compile / malformed / shadowing a column are skipped', () => {
      assert.strictEqual(p4.has('gone'), false);
      assert.strictEqual(p4.has('loop_a'), false);
      assert.ok(p4.field('ok_metric').user);
      assert.strictEqual(p4.field('ev').computed, undefined);
      assert.ok(p4.rows[0].ev > 0);
      const list = RK4.data.userMetrics();
      eq(list.map(m => m.name + ':' + m.active), ['gone:false', 'ok_metric:true', 'x:false', 'ev:false', 'loop_a:false']);
    });

    store.setItem(KEY, '{not json');
    const R5 = await report(G(), ATLAS, ['peers']);
    t('user metric: corrupt JSON in storage is ignored', () => eq(R5.data.userMetrics(), []));
  }
  {
    const RKt = await report({ document: fakeDocument(BUILT), localStorage: fakeStorage({ throws: true }) }, ATLAS);
    t('storage that throws (private mode / sandbox): metrics still work for the session', () => {
      const d = RKt.data.get('peers');
      d.addComputed({ name: 'm1', formula: 'ev * 2', user: true });
      assert.ok(d.rows[0].m1 > 0);
      eq(RKt.data.userMetrics(), []);
      assert.strictEqual(RKt.data.removeUserMetric('peers', 'm1'), true);
    });
    const RKn = await report({}, ATLAS);
    t('no localStorage at all: no errors', () => {
      RKn.data.get('peers').addComputed({ name: 'm1', formula: 'ev * 2', user: true });
      assert.strictEqual(RKn.data.storage(), null);
      eq(RKn.data.userMetrics(), []);
    });
    const full = fakeStorage({ full: true });
    const RKq = await report({ localStorage: full, document: fakeDocument(BUILT) }, ATLAS);
    t('storage quota exceeded: addComputed still succeeds', () => {
      RKq.data.get('peers').addComputed({ name: 'm2', formula: 'ev', user: true });
      assert.ok(RKq.data.get('peers').has('m2'));
    });
  }

  /* ================================================================== describeFilter / applied */
  {
    const RK = await report({}, ATLAS, ['peers', 'financials']);
    const D = RK.data.describeFilter, ds = RK.data.get('peers');
    t('describeFilter: in / not_in / eq with field titles', () => {
      assert.strictEqual(D({ field: 'region', op: 'in', values: ['Europe'] }, ds), 'Region = Europe');
      assert.strictEqual(D({ field: 'sector', op: 'in', values: ['A', 'B', 'C', 'D', 'E'] }, ds), 'Sector = A, B, C +2');
      assert.strictEqual(D({ field: 'region', op: 'not_in', values: ['Asia Pacific'] }, ds), 'Region ≠ Asia Pacific');
      assert.strictEqual(D({ field: 'region', op: 'in', values: [], allowEmpty: true }, ds), 'Region = None');
      assert.strictEqual(D({ field: 'ticker', op: 'eq', value: 'HLX' }, 'peers'), 'Ticker = HLX');
    });
    t('describeFilter: between uses the field format; open ranges', () => {
      assert.strictEqual(D({ field: 'mkt_cap', op: 'between', min: 1000, max: 5000 }, ds), 'Market cap: $1,000 – $5,000');
      assert.strictEqual(D({ field: 'ev_ebitda_25e', op: 'between', min: 8 }, ds), 'EV/EBITDA 2025E ≥ 8.0x');
      assert.strictEqual(D({ field: 'ev_ebitda_25e', op: 'between', max: 12.25 }, ds), 'EV/EBITDA 2025E ≤ 12.3x');
    });
    t('describeFilter: search / expr / label / field from another dataset', () => {
      assert.strictEqual(D({ op: 'search', text: 'alpha' }, ds), '“alpha”');
      assert.strictEqual(D({ field: 'company', op: 'search', text: 'he' }, ds), 'Company ~ “he”');
      assert.strictEqual(D({ op: 'expr', expr: 'not is_target', label: 'Exclude target' }, ds), 'Exclude target');
      assert.strictEqual(D({ op: 'expr', expr: 'ev > 1000' }, ds), 'ev > 1000');
      assert.strictEqual(D({ op: 'expr', field: 'source', values: ['a'], expr: '...' }, ds), 'source = a');
      assert.strictEqual(D({ field: 'region', op: 'in', values: ['Europe'], label: 'Geography' }, ds), 'Geography = Europe');
      assert.strictEqual(D({ field: 'region', op: 'in', values: ['Europe'] }, null), 'Region = Europe');   // title from any dataset
      assert.strictEqual(D(null), '');
    });
    t('describeFilter: zh-CN "None"', () => {
      RK.i18n.set('zh-CN');
      assert.strictEqual(D({ field: 'region', op: 'in', values: [], allowEmpty: true }, ds), 'Region = 无');
      RK.i18n.set('en');
    });
    t('applied(): the filters view() applies (exclude own source, ignore keys, filters:false)', () => {
      RK.store.setFilter('region', { field: 'region', op: 'in', values: ['Europe'] });
      RK.store.setFilter('blk1:sector', { field: 'sector', op: 'in', values: ['Industrial Automation'], source: 'blk1' });
      RK.store.setFilter('fin_only', { field: 'year', op: 'in', values: [2025] });   // not a peers field
      eq(RK.data.applied(ds).map(x => x.key), ['region', 'blk1:sector']);
      eq(RK.data.applied(ds, { exclude: 'blk1' }).map(x => x.key), ['region']);
      eq(RK.data.applied('peers', { ignore: ['region'] }).map(x => x.key), ['blk1:sector']);
      eq(RK.data.applied(ds, { filters: false }), []);
      const v = RK.data.view(ds, { exclude: 'blk1' });
      assert.ok(v.length && v.every(r => r.region === 'Europe'));
      RK.store.clearFilters();
    });
  }

  done();
})().catch(e => { console.error(e); process.exitCode = 1; });
