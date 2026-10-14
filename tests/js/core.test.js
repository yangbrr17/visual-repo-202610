// Run: node tests/js/core.test.js   (no dependencies; loads the classic scripts into a vm sandbox)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '../..');
// RK_CORE_DIR=/path/to/patched/kit/core runs this suite against a patched copy (see research/engine-audit.md)
const coreDir = process.env.RK_CORE_DIR ? path.resolve(process.env.RK_CORE_DIR) : path.join(root, 'kit/core');
const sandbox = { console, Promise, setTimeout, clearTimeout, Map, Set, Math, JSON, Date };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['rk.core.js', 'rk.format.js', 'rk.expr.js', 'rk.data.js']) {
  vm.runInContext(fs.readFileSync(path.join(coreDir, f), 'utf8'), sandbox, { filename: f });
}
const RK = sandbox.RK;
let passed = 0;
function t(name, fn) {
  try { fn(); passed++; } catch (e) { console.error('FAIL', name, '\n ', e.message); process.exitCode = 1; }
}
const F = RK.format;

t('format multiples', () => assert.strictEqual(F(8.534, '0.0x'), '8.5x'));
t('format parens', () => assert.strictEqual(F(-1234.5, '#,##0.0;(#,##0.0)'), '(1,234.5)'));
t('format pct', () => assert.strictEqual(F(0.1234, '0.0%'), '12.3%'));
t('format scale', () => assert.strictEqual(F(1234567, '$#,##0.0,,"m"'), '$1.2m'));
t('format sign', () => assert.strictEqual(F(0.052, '+0.0%;-0.0%;0.0%'), '+5.2%'));
t('format sign neg', () => assert.strictEqual(F(-0.052, '+0.0%;-0.0%;0.0%'), '-5.2%'));
t('format zero section', () => assert.strictEqual(F(0, '+0.0%;-0.0%;0.0%'), '0.0%'));
t('format date', () => assert.strictEqual(F('2026-10-14', 'dd mmm yyyy'), '14 Oct 2026'));
t('format month', () => assert.strictEqual(F('2026-03-01', 'mmm-yy'), 'Mar-26'));
t('format auto', () => assert.strictEqual(F(1.5e9, 'auto'), '1.5bn'));
t('format na', () => assert.strictEqual(F(null, '0.0x'), 'n.a.'));
t('format nm', () => assert.strictEqual(F(NaN, '0.0x'), 'n.m.'));
t('format preset', () => assert.strictEqual(F(12.25, 'mult'), '12.3x'));
t('format group', () => assert.strictEqual(F(1234567.891, '#,##0.00'), '1,234,567.89'));
t('format usd_m', () => assert.strictEqual(F(4520, 'usd_m'), '$4,520m'));
t('format bps', () => assert.strictEqual(F(125, 'bps'), '125 bps'));
t('format acct', () => assert.strictEqual(F(-12.3, 'acct1'), '(12.3)'));
t('format no neg zero', () => assert.strictEqual(F(-0.0001, '0.0'), '0.0'));
t('format optional decimals', () => assert.strictEqual(F(2.5, '0.##'), '2.5'));
t('format decimals()', () => assert.strictEqual(F.decimals('0.00x'), 2));

const E = RK.expr;
const row = { ev: 1000, ebitda: 125, region: 'Asia', margin: 0.25, net_debt: -5, 'EV / EBITDA': 8 };
t('expr arith', () => assert.strictEqual(E.evaluate('ev / ebitda', row), 8));
t('expr pct literal', () => assert.strictEqual(E.evaluate('margin > 20%', row), true));
t('expr string eq ci', () => assert.strictEqual(E.evaluate('region == "asia"', row), true));
t('expr in list', () => assert.strictEqual(E.evaluate('region in ["Europe", "Asia"]', row), true));
t('expr in parens', () => assert.strictEqual(E.evaluate('region in ("Europe", "Americas")', row), false));
t('expr not in', () => assert.strictEqual(E.evaluate('region not in ["Europe"]', row), true));
t('expr if', () => assert.strictEqual(E.evaluate('if(net_debt < 0, "Net cash", "Net debt")', row), 'Net cash'));
t('expr backtick', () => assert.strictEqual(E.evaluate('`EV / EBITDA` * 2', row), 16));
t('expr bracket name', () => assert.strictEqual(E.evaluate('[EV / EBITDA] + 1', row), 9));
t('expr div0', () => assert.ok(Number.isNaN(E.evaluate('ev / 0', row))));
t('expr null propagate', () => assert.strictEqual(E.evaluate('missing + 1', row), null));
t('expr power/unary', () => assert.strictEqual(E.evaluate('-2^2', row), -4));
t('expr ternary', () => assert.strictEqual(E.evaluate('ev > 500 ? 1 : 0', row), 1));
t('expr cagr', () => assert.ok(Math.abs(E.evaluate('cagr(121, 100, 2)', row) - 0.1) < 1e-9));
t('expr min scalar', () => assert.strictEqual(E.evaluate('max(ev, ebitda, 3)', row), 1000));
const rows = [{ s: 'A', v: 1, w: 1 }, { s: 'A', v: 3, w: 3 }, { s: 'B', v: 10, w: 1 }];
t('expr agg', () => assert.strictEqual(E.evaluate('sum(v) / count()', rows), 14 / 3));
t('expr median', () => assert.strictEqual(E.evaluate('median(v)', rows), 3));
t('expr wavg', () => assert.strictEqual(E.evaluate('wavg(v, w)', rows), (1 + 9 + 10) / 5));
t('expr pctl', () => assert.strictEqual(E.evaluate('pctl(v, 0.5)', rows), 3));
t('expr agg in row errors', () => assert.throws(() => E.compile('v + 1 > sum(v)').eval(rows[0])) || true);
t('expr unknown field suggests', () => {
  try { E.compile('revnue', { fields: [{ name: 'revenue' }, { name: 'ebitda' }] }); assert.fail('no throw'); }
  catch (e) { assert.ok(/did you mean revenue/.test(e.message), e.message); }
});
t('expr title match', () => {
  const c = E.compile('`EV/EBITDA 2025E` * 1', { fields: [{ name: 'ev_ebitda_25e', title: 'EV/EBITDA 2025E' }] });
  assert.strictEqual(c.eval({ ev_ebitda_25e: 7 }), 7);
});
t('expr syntax error pos', () => {
  const r = E.check('ev / (ebitda');
  assert.strictEqual(r.ok, false);
});
t('expr chinese field', () => assert.strictEqual(E.evaluate('营业收入 * 2', { 营业收入: 5 }), 10));

// data + query
RK.data.load({ bundle: { manifest: { params: { wacc: { value: 0.09 } } }, datasets: {
  comps: {
    schema: { fields: [
      { name: 'company', type: 'string', title: 'Company' },
      { name: 'sector', type: 'string', title: 'Sector' },
      { name: 'region', type: 'string', title: 'Region' },
      { name: 'ev', type: 'number', title: 'EV', format: '$#,##0' },
      { name: 'ebitda', type: 'number', title: 'EBITDA', format: '$#,##0' },
    ] },
    data: [
      { company: 'A', sector: 'Tech', region: 'Asia', ev: 1000, ebitda: 100 },
      { company: 'B', sector: 'Tech', region: 'Europe', ev: 2400, ebitda: 200 },
      { company: 'C', sector: 'Health', region: 'Asia', ev: 900, ebitda: 60 },
      { company: 'D', sector: 'Health', region: 'Americas', ev: 3000, ebitda: 250 },
    ],
    computed: [{ name: 'mult', formula: 'ev / ebitda', format: '0.0x' }, { name: 'adj', formula: 'ev * (1 + @wacc)' }]
  } } } });

setTimeout(() => {
  const ds = RK.data.get('comps');
  t('computed field', () => assert.strictEqual(ds.rows[0].mult, 10));
  t('computed param', () => assert.ok(Math.abs(ds.rows[0].adj - 1090) < 1e-9));
  t('query needs dataset', () => assert.throws(() => RK.query('median(mult) as "Median" by sector'), /Choose a dataset/));
  t('query agg with from', () => {
    const r = RK.query('median(mult) as "Median", count() by sector from comps sort Median desc');
    assert.strictEqual(r.rows.length, 2);
    assert.strictEqual(r.columns[0].name, 'sector');
    assert.strictEqual(r.columns[1].format, '0.0x');
    assert.strictEqual(r.rows[0].sector, 'Health');
  });
  t('query rows', () => {
    const r = RK.query('company, ev / ebitda as "EV/EBITDA" format "0.0x" where region == "asia" sort 2 asc', { dataset: 'comps' });
    assert.strictEqual(r.rows.map(x => x.company).join(), 'A,C');
    assert.strictEqual(r.columns[1].format, '0.0x');
  });
  t('query summary', () => {
    const r = RK.query('sum(ev) / sum(ebitda) as agg_mult', { dataset: 'comps' });
    assert.strictEqual(r.rows.length, 1);
    assert.ok(Math.abs(r.rows[0].c1 - 7300 / 610) < 1e-9);
  });
  t('query top', () => assert.strictEqual(RK.query('* top 2', { dataset: 'comps' }).rows.length, 2));
  t('filter in', () => {
    RK.store.setFilter('region', { op: 'in', values: ['Asia'] });
    assert.strictEqual(RK.data.view('comps').length, 2);
  });
  t('filter exclude source', () => {
    RK.store.setFilter('sector', { op: 'in', values: ['Tech'], source: 'chart1' });
    assert.strictEqual(RK.data.view('comps').length, 1);
    assert.strictEqual(RK.data.view('comps', { exclude: 'chart1' }).length, 2);
  });
  t('filter between', () => {
    RK.store.clearFilters();
    RK.store.setFilter('ev', { op: 'between', min: 950, max: 2500 });
    assert.strictEqual(RK.data.view('comps').length, 2);
    RK.store.clearFilters();
  });
  t('filter expr', () => {
    RK.store.setFilter('q', { op: 'expr', expr: 'mult < 12.5' });
    assert.strictEqual(RK.data.view('comps').length, 3);
    RK.store.clearFilters();
  });
  t('param recompute', () => {
    RK.store.setParam('wacc', 0.1);
    assert.ok(Math.abs(ds.rows[0].adj - 1100) < 1e-9);
  });
  t('query parse', () => {
    const s = RK.query.parse('avg(ev) as "Avg EV" format "$#,##0", count() by sector, region where ev > 1000 and region in ("Asia","Europe") sort 1 desc top 5');
    assert.strictEqual(s.select.length, 2);
    assert.strictEqual(JSON.stringify(s.by), JSON.stringify(['sector', 'region']));
    assert.strictEqual(s.limit, 5);
    assert.strictEqual(s.select[0].format, '$#,##0');
    assert.ok(/in \("Asia","Europe"\)/.test(s.where));
  });
  console.log(`${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
}, 10);
