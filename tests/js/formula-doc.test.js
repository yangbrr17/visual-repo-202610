// Run: node tests/js/formula-doc.test.js             verify every example in docs/formula-language.md
//      node tests/js/formula-doc.test.js --verbose   ... and list each query example
//      node tests/js/formula-doc.test.js --write     regenerate the result tables under ```rkq blocks
//
// Executable documentation. In docs/formula-language.md:
//   ```js rk-setup ... ```                 JavaScript run in the sandbox (RK in scope) before the following examples
//   ```rkq ... ```                         one RK.query per block; the markdown table right after it must equal the
//                                          query result rendered with each column's format (first 10 rows)
//   <!-- verify:expr [dataset=peers] [row=N] -->   next table: in every row the last two `code` cells are
//                                          formula and result (row formulas run on row N, aggregates on all rows;
//                                          a result written `≈ 9.15` is compared to the shown precision)
//   <!-- verify:format -->                 next table: last three code cells = value, format code, output
//   <!-- verify:error [dataset=peers] -->  next table: first two code cells = input (a query if it contains " from ",
//                                          or written RK.query("…"), else a formula) and the error message ("…" = prefix)
// Sample data: kit/samples/datasets/{peers,financials,precedents,segment_revenue}.json,
// params @wacc = 9%, @g = 2%, @multiple = 10.0x.
'use strict';
const fs = require('fs');
const path = require('path');
const { root, loadSamples } = require('./_harness');

const DOC = path.join(root, 'docs/formula-language.md');
const WRITE = process.argv.includes('--write');
const VERBOSE = process.argv.includes('--verbose');
const MAX_ROWS = 10;

/** CommonMark-ish code spans of one table row. */
function codeSpans(line) {
  const out = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '`') { i++; continue; }
    let n = 0; while (line[i + n] === '`') n++;
    const fence = '`'.repeat(n);
    let j = i + n, end = -1;
    while (j < line.length) {
      const k = line.indexOf(fence, j);
      if (k < 0) break;
      if (line[k + n] === '`' || line[k - 1] === '`') { j = k + 1; while (line[j] === '`') j++; continue; }
      end = k; break;
    }
    if (end < 0) { i += n; continue; }
    let s = line.slice(i + n, end);
    if (s.length > 1 && s[0] === ' ' && s[s.length - 1] === ' ' && s.trim()) s = s.slice(1, -1);
    out.push(s.replace(/\\\|/g, '|'));
    i = end + n;
  }
  return out;
}

function show(v) {
  if (typeof v === 'number') return Number.isNaN(v) ? 'NaN' : String(Number.isInteger(v) ? v : +v.toPrecision(10));
  if (typeof v === 'string') return JSON.stringify(v);
  if (v === undefined) return 'null';
  return JSON.stringify(v);
}

function sameResult(actual, shown) {
  if (/^≈\s*/.test(shown)) {
    const s = shown.replace(/^≈\s*/, ''), want = +s, dec = (s.split('.')[1] || '').length;
    return typeof actual === 'number' && Math.abs(actual - want) <= 0.5 * Math.pow(10, -dec) + 1e-12;
  }
  return show(actual) === shown;
}

function cell(s) { return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' '); }

function renderTable(RK, res) {
  const head = '| ' + res.columns.map(c => cell(c.title)).join(' | ') + ' |';
  // right-align columns whose values are numbers (query columns built from expressions are typed 'number' even for text)
  const numeric = res.columns.map(c => res.rows.every(r => r[c.name] == null || typeof r[c.name] === 'number'));
  const sep = '|' + numeric.map(n => (n ? '---:' : '---')).join('|') + '|';
  const body = res.rows.slice(0, MAX_ROWS).map(r => '| ' + res.columns.map(c => cell(RK.format(r[c.name], c.format))).join(' | ') + ' |');
  const more = res.rows.length > MAX_ROWS ? ['', `*… ${res.rows.length - MAX_ROWS} more rows / 另有 ${res.rows.length - MAX_ROWS} 行*`] : [];
  return [head, sep].concat(body, more).join('\n');
}

function opts(comment) {
  const o = {};
  comment.replace(/(\w+)=("[^"]*"|\S+)/g, (_, k, v) => { o[k] = v.replace(/^"|"$/g, ''); });
  return o;
}

(async function main() {
  const RK = await loadSamples();
  let text = fs.readFileSync(DOC, 'utf8');
  const lines = text.split('\n');
  const stats = { setup: 0, query: 0, expr: 0, format: 0, error: 0 };
  const failures = [];
  const out = [];
  const fail = (lineNo, what, msg) => failures.push(`docs/formula-language.md:${lineNo + 1} ${what}\n    ${msg}`);
  const tableAt = (i) => { let j = i; while (j < lines.length && !lines[j].trim()) j++; const s = j; while (j < lines.length && lines[j].trim().startsWith('|')) j++; return { start: s, end: j }; };
  const ctxRows = (o) => { const ds = RK.data.get(o.dataset || 'peers'); return { ds, rows: ds.rows }; };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^```(js rk-setup|rkq)\s*$/);
    if (fence) {
      let j = i + 1; const body = [];
      while (j < lines.length && !/^```\s*$/.test(lines[j])) body.push(lines[j++]);
      for (let k = i; k <= j; k++) out.push(lines[k]);
      if (fence[1] === 'js rk-setup') {
        try { new Function('RK', body.join('\n'))(RK); stats.setup++; } catch (e) { fail(i, 'rk-setup', e.message); }   // test harness only
        i = j; continue;
      }
      const q = body.filter(l => l.trim() && !l.trim().startsWith('--')).join(' ').trim();
      let rendered;
      try {
        const res = RK.query(q);
        rendered = renderTable(RK, res); stats.query++;
        const head = (lines.slice(0, i).reverse().find(l => /^### /.test(l)) || '').replace(/^### (\S+).*/, '$1');
        if (VERBOSE) console.log(`  query ${head.padEnd(5)} ${String(res.rows.length).padStart(2)} rows x ${res.columns.length} cols  ${q.length > 70 ? q.slice(0, 67) + '...' : q}`);
      } catch (e) { fail(i, 'query: ' + q, (e.name || 'Error') + ': ' + e.message); rendered = null; }
      const tb = tableAt(j + 1);
      const existing = lines.slice(tb.start, tb.end).join('\n');
      // keep a trailing "… n more rows" note together with the table
      let noteEnd = tb.end;
      if (lines[tb.end] !== undefined && !lines[tb.end].trim() && /^\*… \d+ more rows/.test(lines[tb.end + 1] || '')) noteEnd = tb.end + 2;
      const existingFull = lines.slice(tb.start, noteEnd).join('\n');
      if (rendered !== null && existingFull !== rendered) {
        if (!WRITE) fail(i, 'query result differs: ' + q, 'expected (doc):\n' + (existing || '(no table)') + '\n    actual:\n' + rendered);
      }
      for (let k = j + 1; k < tb.start; k++) out.push(lines[k]);
      if (WRITE && rendered !== null) { out.push(rendered); if ((lines[noteEnd] || '').trim()) out.push(''); }
      else for (let k = tb.start; k < noteEnd; k++) out.push(lines[k]);
      i = noteEnd - 1;
      continue;
    }
    out.push(line);
    const v = line.match(/^<!--\s*verify:(expr|format|error)\b(.*?)-->/);
    if (!v) continue;
    const kind = v[1], o = opts(v[2]);
    const tb = tableAt(i + 1);
    for (let k = tb.start + 2; k < tb.end; k++) {
      const spans = codeSpans(lines[k]);
      try {
        if (kind === 'expr') {
          if (spans.length < 2) throw new Error('row needs two code cells (formula, result)');
          const [src, want] = spans.slice(-2);
          const { ds, rows } = ctxRows(o);
          const c = RK.expr.compile(src, { fields: ds.fields });
          const env = { params: RK.store.params() };
          const got = c.aggregate ? c.eval(rows, env) : c.eval(rows[+(o.row || 0)], env);
          if (!sameResult(got, want)) throw new Error(`\`${src}\` -> ${show(got)}, doc says ${want}`);
          stats.expr++;
        } else if (kind === 'format') {
          if (spans.length < 3) throw new Error('row needs three code cells (value, code, output)');
          const [val, code, want] = spans.slice(-3);
          const value = val === 'null' ? null : /^-?[\d.]+(e[+-]?\d+)?$/i.test(val) || /^-?(NaN|Infinity)$/.test(val) ? Number(val) : JSON.parse(val);
          const got = RK.format(value, code);
          if (got !== want) throw new Error(`RK.format(${val}, '${code}') -> ${JSON.stringify(got)}, doc says ${JSON.stringify(want)}`);
          stats.format++;
        } else {
          if (spans.length < 2) throw new Error('row needs two code cells (input, message)');
          const [src, want] = spans.slice(0, 2);
          let err = null;
          try {
            const call = src.match(/^RK\.query\(("(?:[^"\\]|\\.)*")\)$/);
            if (call) RK.query(JSON.parse(call[1]));
            else if (/\sfrom\s/i.test(' ' + src + ' ')) RK.query(src);
            else { const { ds, rows } = ctxRows(o); const c = RK.expr.compile(src, { fields: ds.fields }); c.aggregate ? c.eval(rows, { params: RK.store.params() }) : c.eval(rows[0], { params: RK.store.params() }); }
          } catch (e) { err = e; }
          if (!err) throw new Error(`\`${src}\` did not throw`);
          if (!(err instanceof RK.expr.ExprError)) throw new Error(`\`${src}\` threw ${err.name}: ${err.message} (expected ExprError)`);
          const prefix = want.replace(/…$/, '');
          if (want.endsWith('…') ? !err.message.startsWith(prefix) : err.message !== want) throw new Error(`\`${src}\` -> "${err.message}", doc says "${want}"`);
          stats.error++;
        }
      } catch (e) { fail(k, 'verify:' + kind, e.message); }
    }
  }

  // completeness: every function the engine exposes is documented in §8
  const sec8 = (text.split(/^## 8\. /m)[1] || '').split(/^## 9\. /m)[0];
  const documented = new Set((sec8.match(/`[a-z_0-9]+\(/g) || []).map(x => x.slice(1, -1)));
  (sec8.match(/\/ `([a-z_0-9]+)`/g) || []).forEach(x => documented.add(x.replace(/\/ `|`/g, '')));   // aliases: "/ `iif`"
  const engineFns = RK.expr.functions.scalar.concat(RK.expr.functions.aggregate, ['iif']);
  const missing = engineFns.filter(f => !documented.has(f));
  stats.functions = engineFns.length;
  if (missing.length) fail(0, '§8 function reference', 'not documented: ' + missing.join(', '));

  if (WRITE) { fs.writeFileSync(DOC, out.join('\n')); console.log('tables rewritten'); }
  for (const f of failures) console.error('FAIL', f);
  const total = stats.query + stats.expr + stats.format + stats.error;
  console.log(`formula-doc: ${stats.query} queries, ${stats.expr} formulas, ${stats.format} format codes, ${stats.error} error messages, ${stats.setup} setup blocks — ${total - failures.length}/${total} verified${failures.length ? ', ' + failures.length + ' FAILED' : ''}; ${stats.functions} engine functions documented`);
  console.log(`core: ${path.relative(root, require('./_harness').coreDir) || '.'}, node ${process.version}`);
  if (failures.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
