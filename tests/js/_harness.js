// Shared test harness for the node test files in tests/js (no dependencies).
// Loads the classic core scripts into a fresh vm sandbox, exactly like tests/js/core.test.js.
//
//   RK_CORE_DIR=/path/to/patched/kit/core node tests/js/engine-audit.test.js
//
// lets the integrator run the suites against a patched copy of kit/core before applying it.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '../..');
const coreDir = process.env.RK_CORE_DIR ? path.resolve(process.env.RK_CORE_DIR) : path.join(root, 'kit/core');
const CORE = ['rk.core.js', 'rk.format.js', 'rk.expr.js', 'rk.data.js'];

/** Fresh, isolated RK instance (own Object.prototype, own store, own dataset registry). */
function loadRK() {
  const sandbox = { console, Promise, setTimeout, clearTimeout, Map, Set, Math, JSON, Date };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of CORE) vm.runInContext(fs.readFileSync(path.join(coreDir, f), 'utf8'), sandbox, { filename: f });
  return sandbox.RK;
}

function sample(id) {
  return JSON.parse(fs.readFileSync(path.join(root, 'kit/samples/datasets', id + '.json'), 'utf8'));
}

/** RK with the four sample datasets used by docs/formula-language.md and params @wacc / @g / @multiple loaded. */
async function loadSamples(ids, params) {
  const RK = loadRK();
  const datasets = {};
  for (const id of ids || ['peers', 'financials', 'precedents', 'segment_revenue']) datasets[id] = sample(id);
  await RK.data.load({ bundle: {
    manifest: { params: params || { wacc: { value: 0.09 }, g: { value: 0.02 }, multiple: { value: 10 } } },
    datasets
  } });
  return RK;
}

/** Tiny runner: t(name, fn) collects results; done() prints a summary and sets the exit code. */
function runner(title) {
  const results = [];
  function t(name, fn) {
    const t0 = Date.now();
    try { fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); }
    catch (e) { results.push({ name, ok: false, ms: Date.now() - t0, err: (e && e.message) || String(e) }); }
  }
  function done(opts) {
    opts = opts || {};
    const failed = results.filter(r => !r.ok);
    for (const r of failed) console.error('FAIL', r.name, '\n ', r.err.split('\n').join('\n  '));
    if (opts.verbose) for (const r of results.filter(x => x.ok)) console.log('pass', r.name);
    console.log(`${title}: ${results.length - failed.length}/${results.length} passed${failed.length ? ', ' + failed.length + ' FAILED' : ''}`);
    if (failed.length) process.exitCode = 1;
    return { results, failed };
  }
  return { t, done, results };
}

/** Assert that fn throws an RK ExprError (not a TypeError / RangeError) whose message matches re. */
function throwsExpr(RK, fn, re) {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  if (!err) throw new Error('expected an ExprError, nothing was thrown');
  if (!(err instanceof RK.expr.ExprError)) throw new Error('expected ExprError, got ' + (err && err.name) + ': ' + (err && err.message));
  if (re && !re.test(err.message)) throw new Error('ExprError message ' + JSON.stringify(err.message) + ' does not match ' + re);
  return err;
}

/** Wall-clock guard used by the "never hang" tests. */
function within(ms, fn) {
  const t0 = Date.now();
  let out, err;
  try { out = fn(); } catch (e) { err = e; }
  const dt = Date.now() - t0;
  if (dt > ms) throw new Error('took ' + dt + 'ms (budget ' + ms + 'ms)');
  return { out, err, ms: dt };
}

module.exports = { root, coreDir, loadRK, loadSamples, sample, runner, throwsExpr, within };
