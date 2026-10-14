// Run: node tests/js/engine.test.js
// Adversarial edge-case suite for kit/core/rk.expr.js, rk.format.js and rk.data.js (RK.query, filters, aggregate,
// computed fields, params). Everything here passes on the current core: it pins down the documented behaviour of
// docs/formula-language.md. Known bugs live in tests/js/engine-audit.test.js (expected to fail until the patches in
// research/engine-audit.md are applied).
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { root, coreDir, loadRK, loadSamples, runner, throwsExpr, within } = require('./_harness');

const J = (v) => JSON.stringify(v);
const eqJ = (a, b, msg) => assert.strictEqual(J(a), J(b), msg);
const near = (a, b, eps) => assert.ok(Math.abs(a - b) < (eps || 1e-9), a + ' !~ ' + b);

(async function main() {
  const RK = await loadSamples();
  const E = RK.expr, F = RK.format, Q = RK.query;
  const { t, done } = runner('engine.test.js');
  const ev = (src, row, env) => E.evaluate(src, row || {}, env ? { env } : undefined);
  const withFilters = (specs, fn) => {   // always clean up, even when an assertion fails
    try { for (const k of Object.keys(specs)) RK.store.setFilter(k, Object.assign({}, specs[k])); return fn(); } finally { RK.store.clearFilters(); }
  };
  const r = { a: 2, b: 3, s: 'x', n: null, z: 0, region: 'Asia', margin: 0.25 };

  /* ---------------- operator precedence & associativity ---------------- */
  t('prec: * before +', () => assert.strictEqual(ev('1 + 2 * 3'), 7));
  t('prec: parentheses', () => assert.strictEqual(ev('(1 + 2) * 3'), 9));
  t('prec: - is left-assoc', () => assert.strictEqual(ev('10 - 4 - 3'), 3));
  t('prec: / is left-assoc', () => assert.strictEqual(ev('24 / 4 / 2'), 3));
  t('prec: ^ is right-assoc (Excel: left, 64)', () => assert.strictEqual(ev('2 ^ 3 ^ 2'), 512));
  t('prec: unary minus binds looser than ^ (Excel: 4)', () => assert.strictEqual(ev('-2 ^ 2'), -4));
  t('prec: (-2)^2', () => assert.strictEqual(ev('(-2) ^ 2'), 4));
  t('prec: negative exponent', () => assert.strictEqual(ev('2 ^ -1'), 0.5));
  t('prec: -2^-2', () => assert.strictEqual(ev('-2 ^ -2'), -0.25));
  t('prec: -field^2', () => assert.strictEqual(ev('-a ^ 2', r), -4));
  t('prec: 2^-a^2 = 2^(-(a^2))', () => assert.strictEqual(ev('2 ^ -a ^ 2', r), 0.0625));
  t('prec: 2 * -3', () => assert.strictEqual(ev('2 * -3'), -6));
  t('prec: 2 - -3', () => assert.strictEqual(ev('2--3'), 5));
  t('prec: unary plus', () => assert.strictEqual(ev('+3 - +1'), 2));
  t('prec: not binds tighter than and', () => assert.strictEqual(ev('not false and false'), false));
  t('prec: not over comparison', () => assert.strictEqual(ev('not 1 == 2'), true));
  t('prec: and before or', () => assert.strictEqual(ev('true or false and false'), true));
  t('prec: && || ! synonyms', () => assert.strictEqual(ev('!(a > 1) || (b == 3 && s = "X")', r), true));
  t('prec: = and <> synonyms', () => assert.strictEqual(ev('a = 2 and a <> 3', r), true));
  t('prec: arithmetic before comparison', () => assert.strictEqual(ev('a + 1 > b - 1', r), true));
  t('prec: ternary', () => assert.strictEqual(ev('a > 1 ? "y" : "n"', r), 'y'));
  t('prec: ternary right-assoc', () => assert.strictEqual(ev('0 ? 2 : 0 ? 4 : 5'), 5));
  t('prec: ternary lowest precedence', () => assert.strictEqual(ev('1 + 1 == 2 ? 10 : 20'), 10));
  t('prec: chained comparison is a syntax error', () => throwsExpr(RK, () => ev('1 < 2 < 3'), /Unexpected "<"/));
  t('prec: chained == is a syntax error', () => throwsExpr(RK, () => ev('1 == 1 == 1'), /Unexpected "=="/));

  /* ---------------- number & percent literals ---------------- */
  t('num: 20% = 0.2', () => assert.strictEqual(ev('20%'), 0.2));
  t('num: percent in arithmetic', () => assert.strictEqual(ev('20% * 2'), 0.4));
  t('num: 1.5e2%', () => assert.strictEqual(ev('1.5e2%'), 1.5));
  t('num: .5%', () => assert.strictEqual(ev('.5%'), 0.005));
  t('num: compare with percent', () => assert.strictEqual(ev('margin > 20%', r), true));
  t('num: % after a field is an error (no modulo)', () => throwsExpr(RK, () => ev('a % 2', r), /Unexpected character "%"/));
  t('num: % separated by a blank is an error', () => throwsExpr(RK, () => ev('50 %'), /Unexpected character "%"/));
  t('num: .5', () => assert.strictEqual(ev('.5'), 0.5));
  t('num: 5.', () => assert.strictEqual(ev('5.'), 5));
  t('num: exponent', () => assert.strictEqual(ev('1e3 + 1E-2'), 1000.01));
  t('num: dangling exponent is an error', () => throwsExpr(RK, () => ev('1e'), /Unexpected "e"/));
  t('num: thousands separator is an error', () => throwsExpr(RK, () => ev('1,000'), /Unexpected ","/));
  t('num: hex is an error', () => throwsExpr(RK, () => ev('0x10')));
  t('num: 1.2.3 is an error', () => throwsExpr(RK, () => ev('1.2.3')));
  t('num: 2025E (digits + letter) is an error', () => throwsExpr(RK, () => ev('2025E'), /Unexpected "E"/));
  t('num: beyond 2^53 rounds', () => assert.strictEqual(ev('9007199254740993'), 9007199254740992));
  t('num: overflow -> Infinity', () => assert.strictEqual(ev('1e308 * 10'), Infinity));
  t('num: underflow -> 0', () => assert.strictEqual(ev('1e-400'), 0));
  t('num: float noise is not hidden', () => assert.strictEqual(ev('0.1 + 0.2 == 0.3'), false));

  /* ---------------- strings & escapes ---------------- */
  t('str: double quotes', () => assert.strictEqual(ev('"abc"'), 'abc'));
  t('str: single quotes', () => assert.strictEqual(ev("'abc'"), 'abc'));
  t('str: escaped double quote', () => assert.strictEqual(ev('"a\\"b"'), 'a"b'));
  t('str: escaped single quote', () => assert.strictEqual(ev("'it\\'s'"), "it's"));
  t('str: other quote type needs no escape', () => assert.strictEqual(ev('"it\'s"'), "it's"));
  t('str: escaped backslash', () => assert.strictEqual(ev('"\\\\"'), '\\'));
  t('str: \\n is a literal n (no control escapes)', () => assert.strictEqual(ev('"a\\nb"'), 'anb'));
  t('str: unicode', () => assert.strictEqual(ev('"中文" + "😀"'), '中文😀'));
  t('str: unterminated', () => throwsExpr(RK, () => ev('"abc'), /Unterminated string/));
  t('str: trailing backslash is unterminated', () => throwsExpr(RK, () => ev('"abc\\'), /Unterminated string/));
  t('str: equality is case-insensitive', () => assert.strictEqual(ev('region == "ASIA"', r), true));
  t('str: + concatenates when either side is text', () => assert.strictEqual(ev('s + 1', r), 'x1'));
  t('str: 1 + "2" concatenates', () => assert.strictEqual(ev('1 + "2"'), '12'));
  t('str: null + text -> text', () => assert.strictEqual(ev('n + "x"', r), 'x'));
  t('str: numeric text in * and /', () => assert.strictEqual(ev('"3" * "2"'), 6));
  t('str: non-numeric text in * -> null', () => assert.strictEqual(ev('"abc" * 2'), null));
  t('str: "1" == 1', () => assert.strictEqual(ev('"1" == 1'), true));
  t('str: "" == null', () => assert.strictEqual(ev('"" == null'), true));
  t('str: text ordering', () => assert.strictEqual(ev('"apple" < "banana"'), true));
  t('str: numeric text vs number compares numerically', () => assert.strictEqual(ev('"10" < 9'), false));
  t('str: two numeric texts compare as text', () => assert.strictEqual(ev('"10" < "9"'), true));

  /* ---------------- field names: unicode, quoting, brackets vs lists ---------------- */
  const fields = [{ name: 'revenue', title: '营业收入' }, { name: 'ev_ebitda_25e', title: 'EV/EBITDA 2025E' }, { name: 'HQ city' },
    { name: 'year' }, { name: 'in' }, { name: '2025 Sales' }, { name: '收入（百万）' }];
  const fr = { revenue: 10, ev_ebitda_25e: 7, 'HQ city': 'Zurich', year: '2025A', in: 2, '2025 Sales': 5, '收入（百万）': 3 };
  const cf = (src) => E.compile(src, { fields }).eval(fr);
  t('name: Chinese bare identifier', () => assert.strictEqual(ev('营业收入 * 2', { 营业收入: 5 }), 10));
  t('name: Chinese title resolves to the field', () => assert.strictEqual(cf('营业收入 / 2'), 5));
  t('name: full-width parentheses are part of an identifier', () => assert.strictEqual(cf('收入（百万） * 2'), 6));
  t('name: accented identifier', () => assert.strictEqual(ev('Umsatz_Ä + 1', { Umsatz_Ä: 1 }), 2));
  t('name: case-insensitive with schema', () => assert.strictEqual(cf('EV_EBITDA_25E'), 7));
  t('name: blanks and underscores are interchangeable', () => assert.strictEqual(cf('`ev ebitda 25e`'), 7));
  t('name: title in backticks', () => assert.strictEqual(cf('`EV/EBITDA 2025E` * 2'), 14));
  t('name: title in [brackets]', () => assert.strictEqual(cf('[EV/EBITDA 2025E] + 1'), 8));
  t('name: name with a blank in backticks', () => assert.strictEqual(cf('`HQ city`'), 'Zurich'));
  t('name: name with a blank, unquoted, is an error', () => throwsExpr(RK, () => cf('HQ city'), /Unexpected "city"/));
  t('name: field "year" vs year() function', () => { assert.strictEqual(cf('year == "2025a"'), true); assert.strictEqual(cf('year("2026-10-14")'), 2026); });
  t('name: keyword as a field needs backticks', () => assert.strictEqual(cf('`in` + 1'), 3));
  t('name: digit-first name works in backticks', () => assert.strictEqual(cf('`2025 Sales`'), 5));
  t('name: digit-first name in [brackets] is read as a list', () => throwsExpr(RK, () => cf('[2025 Sales]')));
  t('name: backticked names are never calls', () => throwsExpr(RK, () => ev('`sum`(v)'), /Unexpected "\("/));
  t('name: unterminated backtick', () => throwsExpr(RK, () => ev('`a'), /Unterminated `name`/));
  t('name: unknown field suggests', () => throwsExpr(RK, () => E.compile('revnue', { fields }), /Unknown field "revnue" — did you mean revenue/));
  t('bracket: [name] at operand start', () => assert.strictEqual(ev('[a]', r), 2));
  t('bracket: [name] after an operator', () => assert.strictEqual(ev('2 * [a]', r), 4));
  t('bracket: [name] then operator', () => assert.strictEqual(ev('[a] * 2', r), 4));
  t('bracket: [name] with blanks', () => assert.strictEqual(ev('[a b] + 1', { 'a b': 6 }), 7));
  t('bracket: [x-1] is the name "x-1"', () => assert.strictEqual(ev('[x-1]', { 'x-1': 5, x: 9 }), 5));
  t('bracket: [1, 2] is a list', () => eqJ(ev('[1, 2]'), [1, 2]));
  t('bracket: [1] is a list', () => eqJ(ev('[1]'), [1]));
  t('bracket: ["Asia"] is a list', () => eqJ(ev('["Asia"]'), ['Asia']));
  t('bracket: after "in" it is always a list', () => assert.strictEqual(ev('a in [b]', r), false));
  t('bracket: no indexing syntax', () => throwsExpr(RK, () => ev('a[b]', r), /Unexpected "\["/));

  /* ---------------- in / not in ---------------- */
  t('in: list', () => assert.strictEqual(ev('region in ["Europe", "Asia"]', r), true));
  t('in: parentheses', () => assert.strictEqual(ev('region in ("Europe", "Americas")', r), false));
  t('in: case-insensitive', () => assert.strictEqual(ev('region in ["ASIA"]', r), true));
  t('in: not in', () => assert.strictEqual(ev('region not in ["Europe"]', r), true));
  t('in: "not x in" = not (x in)', () => assert.strictEqual(ev('not a in [2]', r), false));
  t('in: scalar right side', () => assert.strictEqual(ev('a in 2', r), true));
  t('in: expressions inside the list', () => assert.strictEqual(ev('a in [1 + 1, 3]', r), true));
  t('in: empty list', () => assert.strictEqual(ev('1 in []'), false));
  t('in: null in [null]', () => assert.strictEqual(ev('n in [null]', r), true));
  t('in: null not in [1]', () => assert.strictEqual(ev('n not in [1]', r), true));
  t('in: number vs numeric text', () => assert.strictEqual(ev('2025 in ["2025"]'), true));
  t('in: trailing comma is an error', () => throwsExpr(RK, () => ev('a in [1, 2,]', r), /Unexpected "\]"/));
  t('in: IN / NOT IN keywords are case-insensitive', () => assert.strictEqual(ev('region NOT IN ["x"] AND TRUE', r), true));

  /* ---------------- null / NaN / division by zero ---------------- */
  t('null: arithmetic propagates', () => assert.strictEqual(ev('n + 1', r), null));
  t('null: missing field is null', () => assert.strictEqual(ev('missing * 2', r), null));
  t('null: unary minus', () => assert.strictEqual(ev('-n', r), null));
  t('null: == null', () => assert.strictEqual(ev('n == null', r), true));
  t('null: != null', () => assert.strictEqual(ev('n != null', r), false));
  t('null: null == 0 is false', () => assert.strictEqual(ev('n == 0', r), false));
  t('null: comparisons are false both ways', () => { assert.strictEqual(ev('n < 1', r), false); assert.strictEqual(ev('n >= 1', r), false); });
  t('null: not (null > 1) is true (two-valued logic)', () => assert.strictEqual(ev('not (n > 1)', r), true));
  t('null: 0 == false', () => assert.strictEqual(ev('z == false', r), true));
  t('div0: x / 0 -> NaN (n.m.)', () => assert.ok(Number.isNaN(ev('1 / 0'))));
  t('div0: 0 / 0 -> NaN', () => assert.ok(Number.isNaN(ev('0 / 0'))));
  t('div0: -x / 0 -> NaN (not -Infinity)', () => assert.ok(Number.isNaN(ev('-1 / 0'))));
  t('div0: null / 0 -> null (n.a. wins)', () => assert.strictEqual(ev('n / 0', r), null));
  t('div0: 0 ^ -1 -> Infinity (formats as n.m.)', () => { assert.strictEqual(ev('0 ^ -1'), Infinity); assert.strictEqual(F(ev('0 ^ -1'), '0.0x'), 'n.m.'); });
  t('NaN: never equal to itself', () => assert.strictEqual(ev('0/0 == 0/0'), false));
  t('NaN: comparisons false', () => { assert.strictEqual(ev('1/0 > 1'), false); assert.strictEqual(ev('1/0 < 1'), false); });
  t('NaN: isnull() catches NaN', () => assert.strictEqual(ev('isnull(1/0)'), true));
  t('NaN: coalesce skips null and NaN', () => assert.strictEqual(ev('coalesce(n, 1/0, 3)', r), 3));
  t('div(): null instead of NaN', () => assert.strictEqual(ev('div(1, 0)'), null));
  t('format: NaN -> n.m., null -> n.a.', () => { assert.strictEqual(F(NaN, '0.0x'), 'n.m.'); assert.strictEqual(F(null, '0.0x'), 'n.a.'); });

  /* ---------------- aggregates ---------------- */
  const rows = [{ s: 'A', v: 1, w: 1 }, { s: 'A', v: 3, w: 3 }, { s: 'B', v: 10, w: 1 }, { s: 'B', v: null, w: 2 }];
  t('agg: sum skips null', () => assert.strictEqual(ev('sum(v)', rows), 14));
  t('agg: avg skips null', () => near(ev('avg(v)', rows), 14 / 3));
  t('agg: mean / average aliases', () => { near(ev('mean(v)', rows), 14 / 3); near(ev('average(v)', rows), 14 / 3); });
  t('agg: median', () => assert.strictEqual(ev('median(v)', rows), 3));
  t('agg: median of even count interpolates', () => assert.strictEqual(ev('median(v)', [{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }]), 2.5));
  t('agg: min / max', () => { assert.strictEqual(ev('min(v)', rows), 1); assert.strictEqual(ev('max(v)', rows), 10); });
  t('agg: count() counts rows, count(x) non-null', () => { assert.strictEqual(ev('count()', rows), 4); assert.strictEqual(ev('count(v)', rows), 3); });
  t('agg: countd', () => assert.strictEqual(ev('countd(s)', rows), 2));
  t('agg: countd is case-sensitive', () => assert.strictEqual(ev('countd(s)', [{ s: 'Asia' }, { s: 'asia' }]), 2));
  t('agg: stdev is the sample stdev (STDEV.S)', () => near(ev('stdev(v)', rows), 4.725815626252609));
  t('agg: stdev of one value is null', () => assert.strictEqual(ev('stdev(v)', [{ v: 1 }]), null));
  t('agg: first / last skip null', () => { assert.strictEqual(ev('first(s)', rows), 'A'); assert.strictEqual(ev('last(v)', rows), 10); });
  t('agg: pctl = PERCENTILE.INC', () => { assert.strictEqual(ev('pctl(v, 0.25)', [{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }]), 1.75); });
  t('agg: pctl with percent literal', () => assert.strictEqual(ev('pctl(v, 90%)', rows), ev('pctl(v, 0.9)', rows)));
  t('agg: pctl bounds', () => { assert.strictEqual(ev('pctl(v, 0)', rows), 1); assert.strictEqual(ev('pctl(v, 1)', rows), 10); });
  t('agg: pctl default = median', () => assert.strictEqual(ev('pctl(v)', rows), 3));
  t('agg: pctl with @param', () => assert.strictEqual(ev('pctl(v, @p)', rows, { params: { p: 0.5 } }), 3));
  t('agg: percentile alias', () => assert.strictEqual(ev('percentile(v, 0.5)', rows), 3));
  t('agg: wavg skips null values', () => assert.strictEqual(ev('wavg(v, w)', rows), (1 + 9 + 10) / 5));
  t('agg: wavg with zero total weight is null', () => assert.strictEqual(ev('wavg(v, w)', [{ v: 1, w: 0 }]), null));
  t('agg: empty group', () => { assert.strictEqual(ev('sum(v)', []), null); assert.strictEqual(ev('count()', []), 0); assert.strictEqual(ev('median(v)', []), null); });
  t('agg: ratio of aggregates', () => assert.strictEqual(ev('sum(v) / sum(w)', rows), 2));
  t('agg: function names are case-insensitive', () => { assert.strictEqual(ev('SUM(v)', rows), 14); assert.strictEqual(ev('Median(v)', rows), 3); });
  t('agg: booleans average as 0/1', () => near(ev('avg(b)', [{ b: true }, { b: false }, { b: true }]), 2 / 3));
  t('agg: aggregates inside if()', () => assert.strictEqual(ev('if(sum(v) > 10, "big", "small")', rows), 'big'));
  t('agg: aggregates in every if() branch', () => assert.strictEqual(ev('if(count() > 2, sum(v), avg(v))', rows), 14));
  t('agg: if() inside an aggregate (conditional sum)', () => assert.strictEqual(ev('sum(if(s == "A", v, 0))', rows), 4));
  t('agg: ternary over aggregates', () => assert.strictEqual(ev('sum(v) > 1 ? 1 : 0', rows), 1));
  t('agg: unary minus / not over aggregates', () => { assert.strictEqual(ev('-sum(v)', rows), -14); assert.strictEqual(ev('not sum(v)', rows), false); });
  t('agg: scalar function over aggregate', () => assert.strictEqual(ev('round(avg(v), 1)', rows), 4.7));
  t('agg: bare field next to aggregate reads the first row', () => assert.strictEqual(ev('s + ":" + sum(v)', rows), 'A:14'));
  t('agg: min/max with 2+ args are scalar', () => { assert.strictEqual(ev('max(a, b, 1)', r), 3); assert.strictEqual(E.compile('min(a, 2)').aggregate, false); });
  t('agg: nested aggregates are rejected', () => throwsExpr(RK, () => E.compile('sum(sum(v))')));
  t('agg: nested aggregate inside an expression is rejected', () => throwsExpr(RK, () => E.compile('sum(v + avg(v))')));
  t('agg: compile flags aggregate formulas', () => { assert.strictEqual(E.compile('sum(v) / 2').aggregate, true); assert.strictEqual(E.compile('v / 2').aggregate, false); });
  t('agg: aggregate on a single record throws', () => assert.throws(() => E.compile('sum(v)').eval({ v: 1 })));

  /* ---------------- scalar functions ---------------- */
  t('fn: round half up', () => { assert.strictEqual(ev('round(2.5)'), 3); assert.strictEqual(ev('round(1.25, 1)'), 1.3); });
  t('fn: round negative digits', () => assert.strictEqual(ev('round(1234.5, -2)'), 1200));
  t('fn: abs floor ceil sign', () => eqJ([ev('abs(-2)'), ev('floor(2.7)'), ev('ceil(2.1)'), ev('sign(-5)')], [2, 2, 3, -1]));
  t('fn: sqrt of negative -> NaN', () => assert.ok(Number.isNaN(ev('sqrt(-1)'))));
  t('fn: ln / log / log10 / exp', () => { assert.ok(Number.isNaN(ev('ln(0)'))); assert.strictEqual(ev('log(8, 2)'), 3); assert.strictEqual(ev('log10(1000)'), 3); assert.strictEqual(ev('exp(0)'), 1); });
  t('fn: pow', () => assert.strictEqual(ev('pow(2, 10)'), 1024));
  t('fn: cagr', () => near(ev('cagr(121, 100, 2)'), 0.1));
  t('fn: cagr from a non-positive start -> NaN', () => assert.ok(Number.isNaN(ev('cagr(10, 0, 2)'))));
  t('fn: cagr over 0 years -> null', () => assert.strictEqual(ev('cagr(121, 100, 0)'), null));
  t('fn: pct_change', () => near(ev('pct_change(110, 100)'), 0.1));
  t('fn: pct_change from 0 -> NaN', () => assert.ok(Number.isNaN(ev('pct_change(1, 0)'))));
  t('fn: between inclusive', () => { assert.strictEqual(ev('between(5, 1, 10)'), true); assert.strictEqual(ev('between(10, 1, 10)'), true); });
  t('fn: number()', () => { assert.strictEqual(ev('number("12.5")'), 12.5); assert.strictEqual(ev('number("abc")'), null); assert.strictEqual(ev('number("1,234")'), null); });
  t('fn: text() with a format code', () => assert.strictEqual(ev('text(0.1234, "0.0%")'), '12.3%'));
  t('fn: text() of null', () => { assert.strictEqual(ev('text(null)'), ''); assert.strictEqual(ev('text(null, "0.0")'), 'n.a.'); });
  t('fn: len counts UTF-16 units', () => { assert.strictEqual(ev('len("中文")'), 2); assert.strictEqual(ev('len(null)'), 0); });
  t('fn: lower / upper keep null', () => { assert.strictEqual(ev('upper("ab")'), 'AB'); assert.strictEqual(ev('lower(n)', r), null); });
  t('fn: concat skips null', () => assert.strictEqual(ev('concat("a", n, 1)', r), 'a1'));
  t('fn: contains / startswith / endswith are case-insensitive', () => eqJ([ev('contains("Helios", "LIO")'), ev('startswith("Helios", "he")'), ev('endswith("Helios", "IOS")')], [true, true, true]));
  t('fn: year / month / quarter of ISO dates', () => eqJ([ev('year("2026-10-14")'), ev('month("2026-10-14")'), ev('quarter("2026-10-14")')], [2026, 10, 4]));
  t('fn: year of ISO date-time', () => assert.strictEqual(ev('year("2026-10-14T15:30:00Z")'), 2026));
  t('fn: year of null / garbage', () => { assert.strictEqual(ev('year(null)'), null); assert.strictEqual(ev('year("garbage")'), null); });
  t('fn: if without else -> null', () => assert.strictEqual(ev('if(false, 1)'), null));
  t('fn: if only evaluates the chosen branch', () => assert.strictEqual(ev('if(true, 1, @undefined_param)'), 1));
  t('fn: iif alias', () => assert.strictEqual(ev('iif(true, 1, 2)'), 1));
  t('fn: if needs 2+ arguments', () => throwsExpr(RK, () => ev('if(1)'), /needs at least 2 arguments/));
  t('fn: unknown function', () => throwsExpr(RK, () => ev('foo(1)'), /Unknown function foo\(\)/));
  t('fn: function names are case-insensitive', () => assert.strictEqual(ev('ROUND(2.4)'), 2));

  /* ---------------- params ---------------- */
  t('param: from env', () => near(ev('100 * (1 + @wacc)', {}, { params: { wacc: 0.09 } }), 109));
  t('param: from RK.store when no env', () => near(E.compile('@wacc').eval({}), 0.09));
  t('param: unknown param fails at evaluation', () => throwsExpr(RK, () => ev('@nope', {}, { params: {} }), /Unknown parameter @nope/));
  t('param: lone @', () => throwsExpr(RK, () => ev('@ + 1'), /Expected parameter name after @/));
  t('param: names are ASCII identifiers', () => throwsExpr(RK, () => ev('@折现率'), /Expected parameter name/));
  t('param: compile() lists params and fields', () => { const c = E.compile('fcf / (@wacc - @g)'); eqJ(c.params, ['wacc', 'g']); eqJ(c.fields, ['fcf']); });
  t('param: Gordon growth example', () => near(ev('fcf * (1 + @g) / (@wacc - @g)', { fcf: 100 }, { params: { wacc: 0.09, g: 0.02 } }), 102 / 0.07));

  /* ---------------- compile / check API ---------------- */
  t('api: check() never throws', () => { const c = E.check('ev / (ebitda'); assert.strictEqual(c.ok, false); assert.ok(c.pos >= 0); });
  t('api: check() empty formula', () => eqJ(E.check(''), { ok: false, error: 'Unexpected end of formula', pos: 0 }));
  t('api: check() ok result', () => { const c = E.check('sum(ev) / sum(ebitda)'); assert.strictEqual(c.ok, true); assert.strictEqual(c.aggregate, true); eqJ(c.fields, ['ev', 'ebitda']); });
  t('api: error carries a position', () => { const e = throwsExpr(RK, () => E.compile('1 + * 2')); assert.strictEqual(e.pos, 4); });
  t('api: ExprError is an Error', () => { const e = throwsExpr(RK, () => E.compile('1 +')); assert.ok(e instanceof RK.expr.ExprError); assert.strictEqual(e.name, 'ExprError'); });
  t('api: functions list', () => { assert.ok(E.functions.scalar.indexOf('cagr') >= 0); assert.ok(E.functions.aggregate.indexOf('wavg') >= 0); });
  t('api: tokenize', () => eqJ(E.tokenize('a >= 20%').map(x => x.t + ':' + x.v), ['id:a', 'op:>=', 'num:0.2', 'eof:undefined']));

  /* ---------------- security: no code execution, no prototype access ---------------- */
  const srcText = ['rk.expr.js', 'rk.format.js', 'rk.data.js'].map(f => fs.readFileSync(path.join(coreDir, f), 'utf8')).join('\n');
  t('sec: core has no eval / Function / string timers', () => {
    const code = srcText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.ok(!/(^|[^.\w])eval\s*\(/.test(code), 'eval(');
    assert.ok(!/new\s+Function\b|(^|[^.\w])Function\s*\(/.test(code), 'Function(');
    assert.ok(!/set(Timeout|Interval)\s*\(\s*['"`]/.test(code), 'string timer');
  });
  t('sec: no member access syntax', () => { throwsExpr(RK, () => ev('a.constructor', r), /Unexpected character "\."/); throwsExpr(RK, () => ev('a["constructor"]', r)); });
  t('sec: hostile function names are rejected', () => {
    for (const s of ['tostring(1)', 'valueof(1)', 'hasownproperty("a")', '__definegetter__("a", 1)', 'eval("1")', 'function(1)', 'require("fs")', 'process(1)']) throwsExpr(RK, () => ev(s));
  });
  t('sec: constructor-call chains do not parse', () => {
    for (const s of ['constructor("return 1")', 'constructor.constructor("return process")()', '__proto__("x")', '(1).constructor', '"".constructor']) throwsExpr(RK, () => ev(s));
  });
  t('sec: with a schema, inherited names are unknown fields', () => {
    for (const s of ['toString', 'valueOf', 'hasOwnProperty', '`constructor`', '[constructor]', '`__proto__`', '[toString]']) throwsExpr(RK, () => E.compile(s, { fields: [{ name: 'a' }] }));
  });
  t('sec: RK.query rejects inherited names', () => { throwsExpr(RK, () => Q('`constructor` from peers'), /Unknown field/); throwsExpr(RK, () => Q('count() by `toString` from peers')); });
  t('sec: own "__proto__" key of a JSON row is readable', () => assert.strictEqual(ev('`__proto__` + 1', JSON.parse('{"__proto__": 5}')), 6));
  t('sec: hostile inputs never pollute Object.prototype', () => {
    const hostile = ['__proto__', 'constructor', '`__proto__`', '[constructor]', '@__proto__', '@constructor', 'toString', '`toString`',
      'valueOf', '[__proto__]', '`prototype`', 'constructor + 1', '__proto__ in [1]', 'concat(`__proto__`, "x")'];
    for (const s of hostile) { try { E.evaluate(s, JSON.parse('{"__proto__": {"polluted": 1}, "a": 1}'), { env: { params: {} } }); } catch (e) { /* ExprError is fine */ } }
    const ds = RK.data.put({ id: 'hostile', data: JSON.parse('[{"__proto__": {"polluted": 1}, "constructor": "x", "x": 1}]') });
    try { Q('* from hostile'); Q('count() by x from hostile'); RK.data.aggregate(ds.rows, { by: ['x'], measures: [{ op: 'sum', field: 'x' }] }); } catch (e) { /* ok */ }
    const P = Object.getPrototypeOf(RK.util);   // the sandbox's Object.prototype
    assert.strictEqual(P.polluted, undefined);
    assert.strictEqual(({}).polluted, undefined);
    assert.ok(!Object.getOwnPropertyNames(P).some(k => k === 'polluted' || k === 'x'));
  });
  t('sec: no access to the host from formulas', () => {
    for (const s of ['process', 'globalThis', 'window', 'RK', 'require', 'this']) {
      const v = ev(s);  // bare names are just (missing) fields
      assert.ok(v == null, s);
    }
  });
  t('sec: filters with hostile expressions fail closed', () => {
    const warn = console.warn; console.warn = () => {};
    try { RK.store.setFilter('h', { op: 'expr', expr: 'constructor("x")' }); } finally { console.warn = warn; }   // syntax error: filter not installed
    assert.strictEqual(RK.store.filter('h'), null);
    RK.store.clearFilters();
  });

  /* ---------------- never hang ---------------- */
  t('hang: deep nesting fails fast (some error, no hang)', () => {
    for (const s of ['('.repeat(20000) + '1' + ')'.repeat(20000), '-'.repeat(200000) + '1', '['.repeat(50000), 'not '.repeat(50000) + '1', Array(100000).fill('1').join('+')]) {
      const res = within(3000, () => E.compile(s).eval({}));
      assert.ok(res.err, 'expected an error');
      assert.strictEqual(E.check(s).ok, false);
    }
  });
  t('hang: 1 MB string literal', () => assert.strictEqual(within(2000, () => ev('"' + 'a'.repeat(1e6) + '"')).out.length, 1e6));
  t('hang: 100k list items', () => assert.strictEqual(within(3000, () => ev('3 in [' + Array.from({ length: 100000 }, (_, i) => i).join(',') + ']')).out, true));
  t('hang: 100k blanks', () => assert.strictEqual(within(2000, () => ev(' '.repeat(100000) + '1' + ' '.repeat(100000))).out, 1));
  t('hang: invalid inputs throw ExprError', () => {
    for (const s of ['', ')', '(', ',', '1 +', '* 2', '"', "'", '`', '@', '1 ? 2', 'if(', 'a in', 'a not', '[1, 2', '#', '$x', '1 2', 'a b', '%', ';', 'and', 'not', '?:']) {
      within(500, () => throwsExpr(RK, () => E.compile(s), null));
    }
  });
  t('hang: query parser on 100k commas', () => assert.strictEqual(within(3000, () => Q.parse(Array(100000).fill('a').join(','))).out.select.length, 100000));

  /* ---------------- RK.query: clause splitting ---------------- */
  t('q: keyword inside a string is not a clause', () => { const s = Q.parse('company from peers where company == "Sort by"'); assert.strictEqual(s.where, 'company == "Sort by"'); eqJ(s.sort, []); });
  t('q: many keywords inside one string', () => { const s = Q.parse('company where company == "x top 5 from y by z" from peers'); assert.strictEqual(s.limit, null); assert.strictEqual(s.from, 'peers'); assert.strictEqual(s.where, 'company == "x top 5 from y by z"'); });
  t('q: keyword inside single quotes', () => assert.strictEqual(Q.parse("a where b == 'where' sort 1").where, "b == 'where'"));
  t('q: keyword inside backticks', () => eqJ(Q.parse('`EV from peers` from x').select.map(s => s.expr), ['`EV from peers`']));
  t('q: keyword inside [brackets] / parentheses', () => { const s = Q.parse('[Sort by], if(a, "by", "from") from x'); assert.strictEqual(s.select.length, 2); assert.strictEqual(s.from, 'x'); });
  t('q: keywords need surrounding blanks', () => eqJ(Q.parse('sort_order, topline, byproduct from x').select.map(s => s.expr), ['sort_order', 'topline', 'byproduct']));
  t('q: keywords are case-insensitive', () => { const s = Q.parse('COUNT() FROM peers WHERE Region == "europe" ORDER BY 1 ASC LIMIT 3'); assert.strictEqual(s.from, 'peers'); assert.strictEqual(s.limit, 3); eqJ(s.sort, [{ key: '1', dir: 'asc' }]); });
  t('q: newlines and tabs separate clauses', () => assert.strictEqual(Q('count()\nfrom peers\n\twhere region == "Europe"').rows[0].c1, 6));
  t('q: select / show prefix', () => { assert.strictEqual(Q('select count() from peers').rows[0].c1, 18); assert.strictEqual(Q('show count() from peers').rows[0].c1, 18); });
  t('q: clauses in any order', () => eqJ(Q('company sort 1 asc top 2 where ev > 10000 from peers').rows.map(x => x.company), ['Andalina Digital', 'Halvern Instruments']));
  t('q: from "dataset with spaces"', () => {
    RK.data.put({ id: 'my data', data: [{ x: 1 }, { x: 2 }] });
    for (const s of ['sum(x) from "my data"', "sum(x) from 'my data'", 'sum(x) from `my data`', 'sum(x) from my data']) assert.strictEqual(Q(s).rows[0].c1, 3, s);
  });
  t('q: unknown dataset lists the available ones', () => throwsExpr(RK, () => Q('count() from nope'), /Unknown dataset "nope" \(available: .*peers/));
  t('q: no dataset', () => throwsExpr(RK, () => Q('count()'), /Choose a dataset \(from <name>\)/));
  t('q: opts.dataset', () => assert.strictEqual(Q('count()', { dataset: 'financials' }).rows[0].c1, 10));

  /* ---------------- RK.query: select items ---------------- */
  t('q: select * expands every field with title and format', () => {
    const res = Q('* from financials top 1');
    assert.strictEqual(res.columns.length, 12);
    eqJ(res.columns[3], { name: 'revenue', title: 'Revenue', format: '$#,##0.0', type: 'number' });
  });
  t('q: empty select = *', () => assert.strictEqual(Q('from peers top 1').columns.length, 29));
  t('q: *, extra column', () => { const res = Q('*, ev / ebitda_25e as m from peers top 1'); assert.strictEqual(res.columns.length, 30); assert.strictEqual(res.columns[29].title, 'm'); });
  t('q: as "label" / as \'label\' / as `label` / as word / as 中文', () => {
    const res = Q('sum(ev) as "Total EV", sum(ev) as \'B\', sum(ev) as `C D`, sum(ev) as E, sum(ev) as 企业价值 from peers');
    eqJ(res.columns.map(c => c.title), ['Total EV', 'B', 'C D', 'E', '企业价值']);
  });
  t('q: unquoted multi-word label is an error', () => throwsExpr(RK, () => Q('sum(ev) as Total EV from peers'), /Unexpected "as"/));
  t('q: label containing a keyword', () => assert.strictEqual(Q('sum(ev) as "Total by sector" by sector from peers top 1').columns[1].title, 'Total by sector'));
  t('q: format in single quotes with embedded double quotes', () => { const c = Q("sum(ev) as T format '$#,##0.0,,\"bn\"' from peers").columns[0]; assert.strictEqual(c.format, '$#,##0.0,,"bn"'); });
  t('q: unquoted format code with a comma breaks the item list', () => assert.ok(Q.parse('sum(ev) format $#,##0 from peers').select.length === 2));
  t('q: column names: field -> field name, expression -> cN', () => eqJ(Q('company, ev / ebitda_25e, sum(ev) by company from peers top 1').columns.map(c => c.name), ['company', 'c2', 'c3']));
  t('q: trailing comma in select is ignored', () => assert.strictEqual(Q('company, from peers').columns.length, 1));

  /* ---------------- RK.query: formats ---------------- */
  t('q: field keeps its format', () => assert.strictEqual(Q('ev_ebitda_25e from peers top 1').columns[0].format, '0.0x'));
  t('q: aggregate of a field keeps its format', () => eqJ(Q('median(ev_ebitda_25e), sum(ev), pctl(premium_1d, 0.75) from peers'.replace('pctl(premium_1d, 0.75)', 'max(tsr_1y)')).columns.map(c => c.format), ['0.0x', '$#,##0', '0.0%']));
  t('q: count / countd -> #,##0', () => eqJ(Q('count(), countd(sector) from peers').columns.map(c => c.format), ['#,##0', '#,##0']));
  t('q: arithmetic -> no format (General)', () => assert.strictEqual(Q('ev / ebitda_25e from peers top 1').columns[0].format, null));
  t('q: same-unit functions inherit the field format', () => eqJ(Q('round(ev_ebitda_25e, 1), abs(net_debt), median(ev_ebitda_25e) from peers').columns.map(c => c.format), ['0.0x', '$#,##0', '0.0x']));
  t('q: explicit format wins', () => assert.strictEqual(Q('ev / ebitda_25e format "0.0x" from peers top 1').columns[0].format, '0.0x'));

  /* ---------------- RK.query: by / where / sort / top ---------------- */
  t('q: by field', () => eqJ(Q('count() by region from peers').rows.map(x => x.region), ['North America', 'Europe', 'Asia Pacific', 'Latin America']));
  t('q: by title', () => assert.strictEqual(Q('count() by Region from peers').columns[0].name, 'region'));
  t('q: by [bracketed title]', () => assert.strictEqual(Q('count() by [HQ city] from peers').columns[0].name, 'hq_city'));
  t('q: group by alias', () => assert.strictEqual(Q('count() from peers group by region').rows.length, 4));
  t('q: by two fields', () => assert.strictEqual(Q('count() by region, sector from peers').columns.length, 3));
  t('q: by an expression is rejected', () => throwsExpr(RK, () => Q('count() by year(date) from precedents'), /"by" expects field names/));
  t('q: by a quoted string is rejected', () => throwsExpr(RK, () => Q('count() by "Region" from peers'), /"by" expects field names/));
  t('q: grouped non-aggregate column = first row of the group', () => { const res = Q('company, count() by sector from peers'); assert.strictEqual(res.rows[0].company, 'Helios Industrial'); });
  t('q: aggregate without by = one row', () => assert.strictEqual(Q('company, ev > avg(ev) as above from peers').rows.length, 1));
  t('q: where', () => assert.strictEqual(Q('company from peers where region == "europe" and ev > 10000').rows.length, 2));
  t('q: where with in / not in', () => assert.strictEqual(Q('company from peers where region not in ["Europe", "Asia Pacific"]').rows.length, 8));
  t('q: where with @param', () => { assert.strictEqual(Q('company from peers where ev_ebitda_25e > @multiple').rows.length, 11); });
  t('q: where on booleans', () => { assert.strictEqual(Q('company from peers where is_target').rows[0].company, 'Helios Industrial'); assert.strictEqual(Q('count() from peers where not is_target').rows[0].c1, 17); });
  t('q: where on ISO dates (text comparison)', () => assert.strictEqual(Q('count() from precedents where date >= "2023-01-01"').rows[0].c1, 11));
  t('q: where rejects aggregates', () => throwsExpr(RK, () => Q('company from peers where ev > avg(ev)'), /"where" cannot use aggregates/));
  t('q: where with unknown param', () => throwsExpr(RK, () => Q('company from peers where ev > @nope'), /Unknown parameter @nope/));
  t('q: sort by position', () => assert.strictEqual(Q('company, ev from peers sort 2 desc top 1').rows[0].company, 'Sierra Alta Industrial'));
  t('q: sort by label, case-insensitive', () => assert.strictEqual(Q('median(ev_ebitda_25e) as "Median" by sector from peers sort median asc').rows[0].sector, 'Motion & Power Control'));
  t('q: sort by quoted label', () => assert.strictEqual(Q('company, ev / ebitda_25e as "EV/EBITDA" from peers sort "EV/EBITDA" asc top 1').rows[0].company, 'Sierra Alta Industrial'));
  t('q: sort by field name', () => assert.strictEqual(Q('company, ev from peers sort ev asc top 1').rows[0].company, 'Castellari Motion'));
  t('q: sort defaults to desc (text too)', () => assert.strictEqual(Q('company from peers sort company top 1').rows[0].company, 'Vantoro Industrial'));
  t('q: order by alias', () => assert.strictEqual(Q('company, ev from peers order by ev desc top 1').rows[0].company, 'Sierra Alta Industrial'));
  t('q: multi-key sort', () => { const rs = Q('region, sector, count() by region, sector from peers sort 3 desc, 1 asc').rows; assert.strictEqual(rs[0].region, 'Asia Pacific'); assert.strictEqual(rs[0].c3, 2); });
  t('q: nulls sort last both ways', () => {
    for (const dir of ['asc', 'desc']) { const v = Q('premium_1d from precedents sort 1 ' + dir).rows.map(x => x.premium_1d); assert.ok(v.slice(-6).every(x => x === null) && v.slice(0, 15).every(x => x !== null), dir); }
  });
  t('q: NaN sorts last', () => { RK.data.put({ id: 'nan', data: [{ x: 1 }, { x: 0 }, { x: 3 }] }); eqJ(Q('1 / x as r from nan sort r desc').rows.map(x => x.c1), [1, 1 / 3, NaN].map(v => v)); });
  t('q: sort by a column that is not selected is an error', () => throwsExpr(RK, () => Q('company from peers sort mkt_cap'), /Cannot sort by "mkt_cap" — use a column label or position/));
  t('q: sort 0 / out of range', () => { throwsExpr(RK, () => Q('company from peers sort 0'), /Cannot sort by "0"/); throwsExpr(RK, () => Q('company from peers sort 9'), /Cannot sort by "9"/); });
  t('q: top N after sort', () => eqJ(Q('company, ev from peers top 3 sort ev desc').rows.map(x => x.company), ['Sierra Alta Industrial', 'Orbisant Software', 'Kanemori Systems']));
  t('q: limit alias', () => assert.strictEqual(Q('company from peers limit 2').rows.length, 2));
  t('q: global filters apply to queries', () => withFilters({ reg: { field: 'region', op: 'in', values: ['Europe'] } }, () => {
    assert.strictEqual(Q('count() from peers').rows[0].c1, 6);
    assert.strictEqual(Q('count() from peers', { filtered: false }).rows[0].c1, 18);
  }));
  t('q: query.parse result shape', () => {
    const s = Q.parse('avg(ev) as "Avg EV" format "$#,##0", count() by sector, region where ev > 1000 sort 1 desc top 5');
    eqJ(s, { select: [{ expr: 'avg(ev)', as: 'Avg EV', format: '$#,##0' }, { expr: 'count()', as: null, format: null }], by: ['sector', 'region'], where: 'ev > 1000', sort: [{ key: '1', dir: 'desc' }], limit: 5, from: null });
  });
  t('q: spec object instead of text', () => assert.strictEqual(Q({ select: [{ expr: 'count()' }], by: ['sector'], from: 'peers' }).rows.length, 3));

  /* ---------------- computed fields / filters / aggregate() ---------------- */
  t('data: computed field with @param recomputes on setParam', () => {
    const d = RK.data.put({ id: 'cp', data: [{ ev: 100 }], computed: [{ name: 'adj', formula: 'ev * (1 + @wacc)' }] });
    near(d.rows[0].adj, 109);
    RK.store.setParam('wacc', 0.1); near(d.rows[0].adj, 110);
    RK.store.setParam('wacc', 0.09);
  });
  t('data: @param change reaches computed fields that depend on computed fields', () => {
    const d = RK.data.put({ id: 'dep', data: [{ ev: 100 }], computed: [{ name: 'a', formula: 'ev * @wacc' }, { name: 'b', formula: 'a * 2' }] });
    RK.store.setParam('wacc', 0.5);
    try { eqJ([d.rows[0].a, d.rows[0].b], [50, 100]); } finally { RK.store.setParam('wacc', 0.09); }
  });
  t('data: computed fields may use earlier computed fields', () => { const d = RK.data.put({ id: 'cc', data: [{ x: 1 }], computed: [{ name: 'a', formula: 'x + 1' }, { name: 'b', formula: 'a * 2' }] }); assert.strictEqual(d.rows[0].b, 4); });
  t('data: computed order matters (forward reference fails)', () => throwsExpr(RK, () => RK.data.put({ id: 'fw', data: [{ x: 1 }], computed: [{ name: 'b', formula: 'a * 2' }, { name: 'a', formula: 'x + 1' }] }), /Unknown field "a"/));
  t('data: computed aggregate rejected', () => throwsExpr(RK, () => RK.data.get('peers').addComputed({ name: 'bad', formula: 'sum(ev)' }), /Computed fields must be row formulas/));
  t('data: computed errors become null per row', () => { const d = RK.data.put({ id: 'ce', data: [{ x: 1 }], computed: [{ name: 'p', formula: 'x * @not_defined' }] }); assert.strictEqual(d.rows[0].p, null); });
  t('data: in filter is case-insensitive', () => withFilters({ f: { field: 'region', op: 'in', values: ['europe'], datasets: ['peers'] } }, () => assert.strictEqual(RK.data.view('peers').length, 6)));
  t('data: between filter on numbers', () => withFilters({ f: { field: 'ev', op: 'between', min: 10000, max: null, datasets: ['peers'] } }, () => assert.strictEqual(RK.data.view('peers').length, 8)));
  t('data: between filter on ISO dates', () => withFilters({ g: { field: 'date', op: 'between', min: '2025-01-01', datasets: ['precedents'] } }, () => assert.strictEqual(RK.data.view('precedents').length, 6)));
  t('data: filters only apply to datasets that have the field', () => withFilters({ g: { field: 'date', op: 'between', min: '2025-01-01' } }, () => assert.strictEqual(RK.data.view('peers').length, 18)));
  t('data: exclude the filter a chart created itself', () => withFilters({ s: { field: 'sector', op: 'in', values: ['Industrial Automation'], source: 'chart1' } }, () => {
    assert.strictEqual(RK.data.view('peers').length, 6); assert.strictEqual(RK.data.view('peers', { exclude: 'chart1' }).length, 18);
  }));
  t('data: search filter', () => withFilters({ f: { op: 'search', text: 'robot', datasets: ['peers'] } }, () => assert.strictEqual(RK.data.view('peers').length, 1)));
  t('data: expr filter by field name', () => withFilters({ f: { op: 'expr', expr: 'ev_ebitda_25e > 12' } }, () => assert.strictEqual(RK.data.view('peers').length, 6)));
  t('data: view(where) resolves titles', () => assert.strictEqual(RK.data.view('peers', { where: '[Enterprise value] > 10000' }).length, 8));
  t('data: aggregate() helper', () => eqJ(RK.data.aggregate(RK.data.get('peers').rows, { by: ['region'], measures: [{ name: 'n', op: 'count', field: 'company' }] }).map(x => x.n), [5, 6, 4, 3]));

  /* ---------------- RK.format ---------------- */
  const fmt = [
    [8.534, '0.0x', '8.5x'], [-1234.5, '#,##0.0;(#,##0.0)', '(1,234.5)'], [0.1234, '0.0%', '12.3%'], [1234567, '$#,##0.0,,"m"', '$1.2m'],
    [-1234567, '$#,##0.0,,"m";($#,##0.0,,"m")', '($1.2m)'], [1234567, '#,##0,', '1,235'], [1234567, '#,##0,,,', '0'], [1500, '0.0,"k"', '1.5k'],
    [0.052, '+0.0%;-0.0%;0.0%', '+5.2%'], [-0.052, '+0.0%;-0.0%;0.0%', '-5.2%'], [0, '+0.0%;-0.0%;0.0%', '0.0%'], [0, '0.0;(0.0);"–"', '–'],
    [1234.5, '#,##0.00 "USD"', '1,234.50 USD'], [1234.5, '"USD "#,##0', 'USD 1,235'], [1234.5, '\\$#,##0', '$1,235'], [0.25, '0%" margin"', '25% margin'],
    [12.34, '0.0\\x', '12.3x'], [1234, '#,##0_);(#,##0)', '1,234\u2008'], [-1234, '#,##0_);(#,##0)', '(1,234)'], [1234, '[Red]#,##0', '1,234'],
    [0.5, '#.##', '.5'], [12, '000', '012'], [0.5, '0.0#', '0.5'], [0.555, '0.0#', '0.56'], [42, '0.0 "x;y"', '42.0 x;y'], [-42, '0.0 "x;y"', '-42.0 x;y'],
    [0.1234, '0.0%%', '1234.0%%'], [-5, '$#,##0', '-$5'], [-1234.5, '#,##0.0x', '-1,234.5x'], [1234567.891, '#,##0.00', '1,234,567.89'],
    [2.5, '0', '3'], [-2.5, '0', '-3'], [0.125, '0.00', '0.13'], [-0, '0.0', '0.0'], [-0.0001, '0.0', '0.0'], [-0.00001, '#,##0', '0'],
    [1e-7, '0.00', '0.00'], [1e-7, '0.0000000000', '0.0000001000'], [5e-324, '0.0', '0.0'], [1e20, '#,##0', '100,000,000,000,000,000,000'],
    [12.25, 'mult', '12.3x'], [4520, 'usd_m', '$4,520m'], [125, 'bps', '125 bps'], [-12.3, 'acct1', '(12.3)'], [0.1234, 'pct1', '12.3%'],
    [1.5e9, 'auto', '1.5bn'], [-1.5e9, 'auto', '-1.5bn'], [999, 'auto', '999'], [12.5, 'auto', '13'], [0, 'auto', '0'], [1234, 'General', '1234'],
    [123456, 'General', '123,456'], [-12345.6, 'General', '-12,346'], [-0.5, 'General', '-0.5'], [42, '@', '42'], [12.5, 'unknown_preset', '12.5'],
  ];
  for (const [v, code, want] of fmt) t('fmt: ' + v + ' ' + code, () => assert.strictEqual(F(v, code), want));
  const dates = [
    ['2026-10-14', 'dd mmm yyyy', '14 Oct 2026'], ['2026-10-14', 'mmmm d, yyyy', 'October 14, 2026'], ['2026-10-14', 'yyyy-mm-dd', '2026-10-14'],
    ['2026-10-14', 'mm/dd/yy', '10/14/26'], ['2026-10-14', '"Q"q yyyy', 'Q4 2026'], ['2026-10-14', 'q"Q"yy', '4Q26'], ['2026-10-14', 'd-mmm', '14-Oct'],
    ['2026-10-14', 'yyyy"年"m"月"d"日"', '2026年10月14日'], ['2026-10-14', 'yyyy年m月d日', '2026年10月14日'], ['2026-03-01', 'mmm-yy', 'Mar-26'],
    ['2026-02', 'mmm yyyy', 'Feb 2026'], ['2026-10-14T15:30:00Z', 'dd mmm yyyy', '14 Oct 2026'], ['2026-10-14', '\\d mmm', 'd Oct'],
    ['14/10/2026', 'dd mmm yyyy', '14/10/2026'], ['garbage', 'dd mmm yyyy', 'garbage'], ['2026-10-14', 'date', '14 Oct 2026'], ['2026-10-14', 'month', 'Oct 26'],
  ];
  for (const [v, code, want] of dates) t('fmt date: ' + v + ' ' + code, () => assert.strictEqual(F(v, code), want));
  t('fmt: non-zero values show with a 3-section code', () => { assert.strictEqual(F(5, '#,##0;(#,##0);'), '5'); assert.strictEqual(F(-5, '#,##0;(#,##0);'), '(5)'); });
  t('fmt: Date object', () => assert.strictEqual(F(new Date(2026, 9, 14)), '14 Oct 2026'));
  t('fmt: strings pass through numeric codes', () => { assert.strictEqual(F('abc', '0.0'), 'abc'); assert.strictEqual(F('12', '0.0'), '12'); });
  t('fmt: booleans', () => { assert.strictEqual(F(true, '0.0'), 'Yes'); assert.strictEqual(F(false), 'No'); });
  t('fmt: n.a. / n.m. and overrides', () => { assert.strictEqual(F('', '0.0'), 'n.a.'); assert.strictEqual(F(undefined), 'n.a.'); assert.strictEqual(F(Infinity, '0.0'), 'n.m.'); assert.strictEqual(F(null, '0.0', { na: '—' }), '—'); assert.strictEqual(F(NaN, '0.0', { nm: 'NM' }), 'NM'); });
  t('fmt: function spec', () => assert.strictEqual(F(5, v => 'v' + v), 'v5'));
  t('fmt: decimals()', () => eqJ([F.decimals('0.00x'), F.decimals('mult'), F.decimals('#,##0.0#'), F.decimals('date')], [2, 1, 2, null]));
  t('fmt: isDateCode()', () => eqJ([F.isDateCode('mmm'), F.isDateCode('0.0x'), F.isDateCode('#,##0 "mm"'), F.isDateCode('date')], [true, false, false, true]));
  t('fmt: never hangs on long / odd codes', () => { within(1000, () => F(1.5, '#,##0'.repeat(10000))); for (const c of ['0.0"abc', '[Red0.0', '"abc"', '0.0\\', ';', ';;;', '0.0;(0.0);"-";@']) within(200, () => F(-1.5, c)); });

  done();
})().catch(e => { console.error(e); process.exitCode = 1; });
