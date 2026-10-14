// Run: node tests/js/engine-audit.test.js           regression suite for research/engine-audit.md
//      node tests/js/engine-audit.test.js --list    ... and list every test
//
// The 36 findings of research/engine-audit.md (IDs E* = rk.expr.js, F* = rk.format.js, Q* = rk.data.js) are fixed.
// Their tests used to live here as a known-bug suite. They now live in the main suite, tests/js/engine.test.js, in the
// section "regressions: research/engine-audit.md", with the finding ID at the start of each test name. This file runs
// exactly those tests, through the main() that engine.test.js exports. It also fails when a finding has no
// regression test, so the audit stays pinned down if tests are renamed or removed.
//
//   RK_CORE_DIR=/path/to/patched/kit/core node tests/js/engine-audit.test.js   # run against another copy of kit/core
'use strict';
const runEngine = require('./engine.test.js');

const FINDINGS = [
  'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10', 'E11', 'E12',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10',
  'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9', 'Q10', 'Q11', 'Q12', 'Q13', 'Q14'
];
const ID = /^([EFQ]\d+) /;

runEngine({
  title: 'engine-audit.test.js (research/engine-audit.md regressions)',
  only: name => ID.test(name),
  verbose: process.argv.includes('--list')
}).then(res => {
  const perId = {};
  for (const r of res.results) { const id = r.name.match(ID)[1]; perId[id] = (perId[id] || 0) + 1; }
  const missing = FINDINGS.filter(id => !perId[id]);
  const unknown = Object.keys(perId).filter(id => FINDINGS.indexOf(id) < 0);
  if (missing.length) console.error('FAIL no regression test for ' + missing.join(', '));
  if (unknown.length) console.error('FAIL tests name unknown finding IDs: ' + unknown.join(', '));
  console.log(`findings: ${FINDINGS.length - missing.length}/${FINDINGS.length} covered (${FINDINGS.map(id => id + ':' + (perId[id] || 0)).join(' ')})`);
  if (missing.length || unknown.length) process.exitCode = 1;
}).catch(e => { console.error(e); process.exitCode = 1; });
