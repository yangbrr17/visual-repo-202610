# Engine audit — `rk.expr.js`, `rk.format.js`, `rk.data.js`

*2026-10-14 · scope: the formula language (`RK.expr`), number/date formats (`RK.format`), and the data layer
(`RK.query` text parser and executor, filters, `RK.data.aggregate`, computed fields, `@params`) in `kit/core` as of
commit `88a4097`.*

## Summary

- **36 defects** with a failing test and a patch each: 2 high, 10 medium and 24 low severity. The patches are in this file.
  Their failing tests are in `tests/js/engine-audit.test.js`. That file has 128 tests: **0/128 pass today** and
  **128/128 pass with all patches applied**.
- **Security: no path to code execution.** The engine never calls `eval`, `Function` or string timers. The language
  has no member access, indexing or call-on-value syntax. Functions are looked up by name in fixed tables. Prototype
  names never execute anything. Object.prototype is never polluted (both are tested). There are three hardening gaps
  that let *values* leak or names break: E7, F6 (crash on `format "constructor"`) and Q13.
- **Never hangs, but some inputs throw the wrong error.** No input hangs, but three cases are wrong:
  - Pathological inputs raise `RangeError` instead of `ExprError` (E10).
  - Three regexes backtrack in O(n²) time (Q8: 50k blanks = 3–20 s).
  - Field suggestions are O(n²) (E11: a 100k-character name = 5 s).
- **The finding with the most client impact is display rounding (F1).** `RK.format` rounds through binary
  `toFixed`. Values on an exact .x5 boundary therefore render differently from Excel: 10.35 shows as "10.3x" where Excel
  shows "10.4x". On the bundled sample data, **121 of 26,456 rendered cells change** with the patch. Two examples are
  Corvane's revenue growth (now "7.0%", Excel "7.1%") and Brightwell's EV/revenue (now "1.6x", Excel "1.7x"). In a
  pitchbook these do not tie to the model.
- **The second is wrong column formats from the query console (Q4).**
  - `pct_change(revenue_26e, revenue_25e)` is formatted `$#,##0`, so a 7% growth renders as "$0".
  - `year(date)` inherits `dd mmm yyyy`, so 2019 renders as "01 Jan 1970".
- An integrator change landed while this audit ran (`88a4097`, "chained computed fields"). It already fixes
  `@param` propagation to dependent computed fields, and its regression test is now in `engine.test.js`. Q9 covers what
  is left: redefinition order and self-reference.

| Test file | Purpose | Today | With patches |
|---|---|---|---|
| `tests/js/core.test.js` (existing, now honours `RK_CORE_DIR`) | smoke | 57/57 | 57/57 |
| `tests/js/engine.test.js` (new) | 378 edge-case tests of current, documented behaviour | 378/378 | 378/378 |
| `tests/js/engine-audit.test.js` (new) | 128 known-bug tests, IDs below | **0/128** | **128/128** |
| `tests/js/formula-doc.test.js` (new) | executes every example in `docs/formula-language.md` | 138/138 | 138/138 |

```bash
node tests/js/engine.test.js && node tests/js/core.test.js && node tests/js/formula-doc.test.js   # green suite
node tests/js/engine-audit.test.js --list                                                           # known bugs
RK_CORE_DIR=/tmp/patched/kit/core node tests/js/engine-audit.test.js                                # try patches first
```

`engine-audit.test.js` exits with code 1 until the patches land. If a CI step later globs `tests/js/*.test.js`,
exclude that file or run it with `|| true`. The shared harness is `tests/js/_harness.js`. It loads the classic scripts into a `vm` sandbox, as `core.test.js` does.
`RK_CORE_DIR` points every suite at a patched copy of `kit/core`.

## How to apply

The diffs below are consecutive commits on top of `88a4097`. Applied in ID order (E → F → Q), all of them apply cleanly
with `git apply`. The extraction one-liner below applies all of them as a single patch, which was also verified.

```bash
awk '/^```diff$/{f=1;next} /^```$/{f=0} f' research/engine-audit.md > /tmp/engine-audit.patch
git apply --check /tmp/engine-audit.patch && git apply /tmp/engine-audit.patch
node tests/js/engine-audit.test.js && node tests/js/engine.test.js && node tests/js/core.test.js && node tests/js/formula-doc.test.js
```

Each patch can also be applied on its own, except for these dependencies (textual or runtime):

- E3 needs E2.
- E12 needs E10.
- F2, F3, F4 and F8 need F1, which adds the `fixed()` helper.
- F4 and F6 need F2, which adds `general()`.
- F8 needs F7.
- F10 needs F9.
- Q3 needs Q1.
- Q8 needs Q1 and Q7.

After merging, do the following:

1. Move the now-passing tests from `engine-audit.test.js` into `engine.test.js`.
2. Delete the matching rows in §15 "Known issues" of `docs/formula-language.md`.
3. Run `node tests/js/formula-doc.test.js`. All 138 examples are tie-free, so they verify on both cores.
4. Port the Q9 self-reference check to `py/reportkit/validate.py`. Without it, a self-referencing computed field
   passes the build and only fails when the browser loads it.
5. Re-shoot screenshots, because F1 changes display rounding on .x5 boundaries.

## Findings

| ID | Sev. | Area | Defect | Tests |
|---|---|---|---|---|
| F1 | **High** | format | Display rounding uses binary `toFixed`, so it does not tie to Excel (10.35 → "10.3x", 2.675 → "$2.67") | 13 |
| Q4 | **High** | query | Column format inherited from the first argument of any function (`pct_change` → "$0", `year(date)` → "01 Jan 1970") | 4 |
| E1 | Medium | expr | Non-numeric text compared with a number acts as 0 (`"n.a." < 6` is true; every ISO date `< 2021`); `"a" >= "A"` false while `"a" == "A"` | 5 |
| E2 | Medium | expr | Aggregate arity unchecked: `wavg(v)`, `sum()` throw TypeError at evaluation (`check()` says ok); `sum(v, w)` ignores `w`; `pctl(v, field)` silently returns the min | 8 |
| E4 | Medium | expr | `round()`: `round(1.005, 2)` = 1, `round(-2.5)` = -2, `round(1e300, 10)` = Infinity | 8 |
| E6 | Medium | expr | `min()`/`max()` aggregates: RangeError between 100k and 200k rows (`Math.min.apply`); `min(date)` is null | 4 |
| F2 | Medium | format | General (the default format) renders -123456 as "-,123,456", 0.000123 as "0", -0.0023 as "-0" | 5 |
| Q1 | Medium | query | `sort by x` is parsed as `sort` + `by x` (group by): confusing error or wrong grouping | 2 |
| Q2 | Medium | query | Escaped quotes (`"a \" sort x"`) end the string in the clause splitter | 2 |
| Q3 | Medium | query | `` by `HQ city` `` fails: backticks are stripped before compiling | 2 |
| Q5 | Medium | query | `top -3` drops the last 3 rows; `top 0` / `top ten` return everything silently | 4 |
| Q9 | Medium | data | Redefining a computed field leaves dependants stale; `x = x * (1 + @g)` compounds on every slider move | 2 |
| E3 | Low | expr | Nested aggregates: the message says "use it in a grouped query", which is misleading | 2 |
| E5 | Low | expr | `wavg()` returns n.a. when any weight is NaN (e.g. a division by zero) | 2 |
| E7 | Low (hardening) | expr | Plain-object lookups expose Object.prototype: `constructor` / `__proto__` lex as keywords; without a schema, `` `constructor` ``, `[toString]`, `@constructor` return native functions | 9 |
| E8 | Low | expr | `clamp(5)` = 0, `between(-5, null, 10)` = false (null bound treated as 0) | 4 |
| E9 | Low | expr | `contains("a null b", null)` is true; `endswith(s, "")` false but `startswith(s, "")` true | 3 |
| E10 | Low | expr | ~1,000 nested parentheses or 10k-term sums throw RangeError, not ExprError | 4 |
| E11 | Low | expr | Unknown-field suggestion is O(n²): a 100k-character name blocks for ~5 s | 1 |
| E12 | Low | expr | An aggregate formula evaluated on one record throws `TypeError: rows.map is not a function` | 1 |
| F3 | Low | format | ≥ 1e21: "1e,+21"; 1.5e300 → "1.5e+3" (reads as 1,500) | 3 |
| F4 | Low | format | `auto`: 999,950 → "1000k", 999.95 → "1000", -0.0001 → "-0" | 3 |
| F5 | Low | format | Invalid Date → "aN undefined NaN"; "2026-13-45" → 14 Feb 2027; `2026` with `yyyy` → "1970" | 6 |
| F6 | Low | format | `format "constructor"` throws TypeError; typo `usd_mn` becomes a date code ("us1_1n") | 5 |
| F7 | Low | format | Empty zero section (`#,##0;(#,##0);`, Excel's hide-zero idiom) is ignored | 1 |
| F8 | Low | format | With an explicit negative section, values that round to 0 show "-0.0%", "(0.0)", "+0.0%" | 5 |
| F9 | Low | format | `[$€-407]` drops the currency; `[$-409]` leaks into dates (and turned date codes numeric) | 3 |
| F10 | Low | format | `ddd` / `dddd` print "1414" | 2 |
| Q6 | Low | query | A repeated clause silently replaces the first (`where a where b` ignores `a`) | 2 |
| Q7 | Low | query | `format` before `as` in a select item fails | 1 |
| Q8 | Low | query | O(n²) regex backtracking in select-item / sort parsing (50k blanks → 3–20 s) | 3 |
| Q10 | Low | filters | `not_in` is case-sensitive, `in` is not | 1 |
| Q11 | Low | filters | `expr` filters compile without the schema: titles / case variants are silently not applied | 2 |
| Q12 | Low | data | `RK.data.aggregate({op, field})` does not quote field names with blanks | 2 |
| Q13 | Low (hardening) | data | A field named `__proto__` is dropped from query output / computed rows (assignment swaps the prototype) | 2 |
| Q14 | Low | query | Expression columns are always typed `number` (text and dates included) | 2 |

### Security review

Attack surface: a client can type any text into the query console, and formulas come from dataset JSON, filter specs
and `text-block` placeholders. Results:

| Vector | Result | Tests |
|---|---|---|
| `eval` / `new Function` / string timers in `rk.expr.js`, `rk.format.js`, `rk.data.js` | none; the comments are stripped and the source is grepped in a test | `engine.test.js` "sec: core has no eval…" |
| Member access / indexing / calling a value (`a.constructor`, `a["x"]`, `(1).constructor`, `constructor.constructor("…")()`) | no grammar for any of these; they fail as syntax errors | "sec: no member access syntax", "constructor-call chains" |
| Function names that name prototype methods (`tostring(1)`, `valueof(1)`, `hasownproperty("a")`, `__definegetter__(…)`) | `Unknown function`. Names are lower-cased before the lookup, so `toString` becomes `tostring`, which is not on Object.prototype | "sec: hostile function names" |
| `constructor(…)` | today it lexes as a **keyword** because `KEYWORDS` is a plain object, so it is a syntax error. That protection is accidental: with E7 only half applied (keywords fixed, function tables not), `constructor(c, a, b)` would resolve `LAZY.constructor` and behave like `if()`, and `SCALAR.constructor` is `Object`. Still no code execution, but E7 fixes every table at once | E7 tests |
| Field names `` `constructor` ``, `[toString]` (no schema) | return `Object` / `Object.prototype.toString` as *values*. They cannot be called, and arithmetic turns them into null. With a schema (RK.query, computed fields, `view(where)`) they are `Unknown field` | E7 tests; "sec: with a schema…" |
| `@constructor`, `@__proto__` | `in` operator on the params object returns `Object` / `Object.prototype` | E7 |
| Prototype pollution through rows / field defs / `__proto__` keys in JSON | none. `Object.prototype` is checked after hostile formulas, queries and `aggregate()` over a dataset whose rows contain `"__proto__": {"polluted": 1}`. A field literally named `__proto__` *loses its value* (Q13), but nothing leaks out of that object | "sec: hostile inputs never pollute Object.prototype", Q13 |
| `format "constructor"` / `"toString"` presets | `TypeError` thrown from `RK.format`, so a malformed dataset `format` can break rendering. This is a denial of service only | F6 |
| Resource exhaustion | no infinite loop exists: every tokenizer branch consumes input. Super-linear cases are Q8 (regex), E11 (edit distance) and E10 (recursion depth); all three are fixed | "hang: …", Q8, E10, E11 |

Out of scope, but worth checking during component review: query labels, cell values and dataset strings are data, so
components must render them with `textContent` or `RK.util.escapeHTML`, not `innerHTML`.

### Observations without a patch (documented in `docs/formula-language.md` or left as design decisions)

- **Excel differences (kept, documented in §6).** `-2^2` = -4 (Excel 4) and `2^3^2` = 512 (Excel 64). There is no `&`
  concatenation. `%` applies only to number literals. There is no modulo operator.
- **Two-valued null logic.** `null > 1` and `null <= 1` are both false, so `not (x > 1)` differs from `x <= 1`. This is
  documented, with the workaround `x != null and …`.
- **Grouped query, non-aggregate column → first row of the group** (`company, count() by sector`). Like SQL without
  `ONLY_FULL_GROUP_BY`. Documented. Consider an explicit error or `first()`.
- **Group keys collide.** Keys are joined with `\u0001` and stringified, so `null`, `""` and a missing value fall in one
  group, and so do `1` and `"1"`. `countd()` and `by` are case-sensitive while `==` / `in` are not. Documented.
- **`sort` defaults to `desc`, even for text, and positions count the `by` columns first.** This matches the architecture
  examples (`… by sector sort 2 desc`). Documented with a tip.
- **Escapes.** `"\n"` is the letter `n`: a backslash keeps the next character literally. There is no `count(*)`, and
  parameter names are ASCII only (`@折现率` is an error). Full-width IME punctuation `（，）％` is part of an
  identifier. All of these are documented.
- **`[2025 Sales]` is read as a list.** The bracket-name heuristic rejects text that starts with a digit; backticks
  work. Documented.
- **Minor numeric coercions.** `number(" ")` = 0 (JS `Number(" ")`). `log(8, 1)` = Infinity and `log(8, 0)` = -0; Excel
  gives #DIV/0! and #NUM!. Both display as n.m. or 0. Low value, no patch.
- **`RK.expr.compile` caches by source text without bounds** when called without `fields`. That path is used by
  `setFilter({op: 'expr'})`, and a long session typing many distinct expressions grows a `Map` forever. Cap it, e.g. LRU 500.
- **`between` / `eq` filter ops.** `between` on a string field passes every row (`"Asia" - "A"` is NaN). `eq` is strict
  and case-sensitive, unlike `in` and the `==` operator.
- **Python port (`py/reportkit/expr.py`).** It matches the JS tokenizer, except that it already treats
  `constructor` / `__proto__` as identifiers (JS: keywords, E7). Apply the Q9 self-reference rule there as well.

---

## Patches (in apply order)

Every block below is a unified diff against the state left by the previous block, starting from `88a4097`. Each heading names the failing tests (prefix in `tests/js/engine-audit.test.js`).

### E1 — Comparisons with text that is not a number

*kit/core/rk.expr.js · tests: `E1 …` in engine-audit.test.js*

`cmp()` returned `num(a) - num(b)`, and `num("n.a.")` is `null`, which coerces to 0. So `"n.a." < 6` → `-6 < 0` →
**true**. Text placeholders in numeric columns ("n.a.", "NM" from data vendors) pass `where ev_ebitda < 10` screens.
An ISO date compared with a number is also "less than" every number: `count() … where date < 2021` returns all 21 deals.
`"a".localeCompare("A")` is -1, so `"a" >= "A"` is false while `"a" == "A"` is true.
**Fix:** a non-numeric side makes `cmp` return NaN, so every ordering comparison is false, as with null. Text
compares with `sensitivity: 'accent'`, consistent with the case-insensitive `==`.

```diff
diff --git a/kit/core/rk.expr.js b/kit/core/rk.expr.js
index fe22ccc..6a87fd6 100644
--- a/kit/core/rk.expr.js
+++ b/kit/core/rk.expr.js
@@ -250,8 +250,11 @@
     return a == b; // eslint-disable-line eqeqeq
   }
   function cmp(a, b) {
-    if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
-    return num(a) - num(b);
+    // case-insensitive like eq(), so "a" >= "A" agrees with "a" == "A"
+    if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b, undefined, { sensitivity: 'accent' });
+    var x = num(a), y = num(b);
+    // text that is not a number ("n.a.", "NM", "2021-03-18") is not comparable with a number: NaN makes <, >, <=, >= false
+    return x === null || y === null ? NaN : x - y;
   }
   function arith(op, a, b) {
     if (op === '+' && (typeof a === 'string' || typeof b === 'string')) return String(isNull(a) ? '' : a) + String(isNull(b) ? '' : b);
```

### E2 — Aggregate argument counts

*kit/core/rk.expr.js · tests: `E2 …` in engine-audit.test.js*

`agg()` called `inner[1](…)` without checking arity. `wavg(v)` and `sum()` therefore crash with
`TypeError: inner[1] is not a function` at **evaluation** time, while `RK.expr.check('wavg(v)')` reports `ok: true`.
`sum(v, w)` silently ignores `w`. `pctl(v, w)` evaluates the field `w` against a `null` row, giving p = null = 0,
i.e. the minimum. **Fix:** an arity table (default 1; `count` 0–1, `pctl` 1–2, `wavg` 2) is checked at compile time.
`pctl`'s percentile must not reference fields.

```diff
diff --git a/kit/core/rk.expr.js b/kit/core/rk.expr.js
index 6a87fd6..e044311 100644
--- a/kit/core/rk.expr.js
+++ b/kit/core/rk.expr.js
@@ -361,6 +361,15 @@
     if ((node.name === 'min' || node.name === 'max') && node.args.length > 1) return false;
     return true;
   }
+  // allowed argument counts [min, max] of aggregate functions (default: exactly 1)
+  var AGG_ARITY = { count: [0, 1], wavg: [2, 2], pctl: [1, 2], percentile: [1, 2] };
+  function usesField(node) {
+    if (!node || typeof node !== 'object') return false;
+    if (node.type === 'field') return true;
+    var kids = [node.a, node.b, node.c].concat(node.args || [], node.items || []);
+    for (var i = 0; i < kids.length; i++) if (kids[i] && usesField(kids[i])) return true;
+    return false;
+  }
   function containsAgg(node) {
     if (!node || typeof node !== 'object') return false;
     if (isAggCall(node)) return true;
@@ -490,7 +499,13 @@
   Compiler.prototype.agg = function (node) {
     var self = this;
     if (isAggCall(node)) {
-      var name = node.name;
+      var name = node.name, ar = AGG_ARITY[name] || [1, 1], argc = node.args.length;
+      if (argc < ar[0] || argc > ar[1]) {
+        throw new ExprError(name + '() expects ' + (ar[0] === ar[1] ? ar[0] : ar[0] + '-' + ar[1]) + ' argument' + (ar[0] === 1 && ar[1] === 1 ? '' : 's') + ', got ' + argc, node.pos);
+      }
+      if (name !== 'wavg' && argc === 2 && usesField(node.args[1])) {
+        throw new ExprError(name + '() percentile must be a number or @param (e.g. 0.9 or 90%), not a field', node.pos);
+      }
       if (name === 'count' && node.args.length === 0) return function (rows) { return rows.length; };
       var inner = node.args.map(function (n) { return self.row(n); });
       if (AGG_EXTRA[name]) {
```

### E3 — Nested aggregates — misleading message

*kit/core/rk.expr.js · tests: `E3 …` in engine-audit.test.js*

`sum(sum(v))` throws "sum() is an aggregate — use it in a grouped query or summary metric". The user is already writing
a summary metric. **Fix:** detect the nesting in `agg()` and say "Aggregates cannot be nested: sum() contains another
aggregate — compute the inner value in its own column or computed field".

```diff
diff --git a/kit/core/rk.expr.js b/kit/core/rk.expr.js
index e044311..9132a8f 100644
--- a/kit/core/rk.expr.js
+++ b/kit/core/rk.expr.js
@@ -506,6 +506,9 @@
       if (name !== 'wavg' && argc === 2 && usesField(node.args[1])) {
         throw new ExprError(name + '() percentile must be a number or @param (e.g. 0.9 or 90%), not a field', node.pos);
       }
+      for (var ni = 0; ni < argc; ni++) {
+        if (containsAgg(node.args[ni])) throw new ExprError('Aggregates cannot be nested: ' + name + '() contains another aggregate — compute the inner value in its own column or computed field', node.pos);
+      }
       if (name === 'count' && node.args.length === 0) return function (rows) { return rows.length; };
       var inner = node.args.map(function (n) { return self.row(n); });
       if (AGG_EXTRA[name]) {
```

### E4 — `round()` is not Excel's ROUND

*kit/core/rk.expr.js · tests: `E4 …` in engine-audit.test.js*

`Math.round(x * 10^d) / 10^d` has two problems:
- It inherits binary error: `1.005 * 100 = 100.49999999999999`, so the result is 1 (Excel: 1.01), and
  `round(1.255, 2)` = 1.25.
- `Math.round` rounds .5 towards +∞, so `round(-2.5)` = -2 (Excel: -3).

`round(1e300, 10)` overflows to Infinity, and fractional digits (`round(x, 1.5)`) are not truncated. **Fix:** round
`|x|·10^d` at 15 significant digits, half away from zero, return x when the scaled value is not finite, and truncate d.

```diff
diff --git a/kit/core/rk.expr.js b/kit/core/rk.expr.js
index 9132a8f..d57176a 100644
--- a/kit/core/rk.expr.js
+++ b/kit/core/rk.expr.js
@@ -282,7 +282,15 @@
 
   var SCALAR = {
     abs: function (x) { x = num(x); return x === null ? null : Math.abs(x); },
-    round: function (x, d) { x = num(x); if (x === null) return null; var f = Math.pow(10, num(d) || 0); return Math.round(x * f) / f; },
+    round: function (x, d) {
+      x = num(x); if (x === null) return null;
+      d = Math.trunc(num(d) || 0);                        // Excel truncates num_digits
+      var f = Math.pow(10, d), y = Math.abs(x) * f;
+      if (!isFinite(y)) return x;
+      y = Math.round(+y.toPrecision(15));                 // 1.005 * 100 = 100.49999999999999 -> 100.5 -> 101
+      y = d >= 0 ? y / f : y * Math.pow(10, -d);
+      return y === 0 ? 0 : (x < 0 ? -y : y);              // half away from zero, like Excel ROUND()
+    },
     floor: function (x) { x = num(x); return x === null ? null : Math.floor(x); },
     ceil: function (x) { x = num(x); return x === null ? null : Math.ceil(x); },
     sqrt: function (x) { x = num(x); return x === null ? null : (x < 0 ? NaN : Math.sqrt(x)); },
```

### E5 — `wavg()` with a NaN weight

*kit/core/rk.expr.js · tests: `E5 …` in engine-audit.test.js*

A weight computed as a division by zero is NaN. `w += NaN` makes the total NaN, so the result is null (n.a.) for the
whole group. **Fix:** skip rows whose weight is NaN, as is already done for NaN values.

```diff
diff --git a/kit/core/rk.expr.js b/kit/core/rk.expr.js
index d57176a..bf55a79 100644
--- a/kit/core/rk.expr.js
+++ b/kit/core/rk.expr.js
@@ -353,7 +353,7 @@
       var s = 0, w = 0;
       for (var i = 0; i < vals.length; i++) {
         var x = num(vals[i]), y = num(weights[i]);
-        if (x === null || y === null || isNaN(x)) continue;
+        if (x === null || y === null || isNaN(x) || isNaN(y)) continue;
         s += x * y; w += y;
       }
       return w ? s / w : null;
```

### E6 — `min()` / `max()` aggregates

*kit/core/rk.expr.js · tests: `E6 …` in engine-audit.test.js*

`Math.min.apply(null, values)` exceeds the engine's argument limit between 100k and 200k values (V8 default stack): `RangeError: Maximum call
stack size exceeded`. This also affects components that call `RK.expr.agg.min` (comps-table, donut, scenario-switch).
Separately, `numbers()` drops ISO date strings, so `min(date)` / `max(date)` ("first / last deal") return null.
**Fix:** a loop; when a column has no numbers, compare its strings.

```diff
diff --git a/kit/core/rk.expr.js b/kit/core/rk.expr.js
index bf55a79..11025db 100644
--- a/kit/core/rk.expr.js
+++ b/kit/core/rk.expr.js
@@ -273,6 +273,16 @@
     for (var i = 0; i < vals.length; i++) { var v = num(vals[i]); if (v !== null && !isNaN(v)) out.push(v); }
     return out;
   }
+  /** min (dir -1) / max (dir 1) without Function.apply (RangeError above ~120k rows); all-text columns
+   *  such as ISO dates ("2019-03-18") compare as text so min(date) / max(date) work. */
+  function extreme(vals, dir) {
+    var a = numbers(vals), best = null, i;
+    if (!a.length) {
+      for (i = 0; i < vals.length; i++) if (typeof vals[i] === 'string' && vals[i] !== '') a.push(vals[i]);
+    }
+    for (i = 0; i < a.length; i++) if (best === null || (dir < 0 ? a[i] < best : a[i] > best)) best = a[i];
+    return best;
+  }
   function quantile(sorted, p) {
     if (!sorted.length) return null;
     var idx = (sorted.length - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx);
@@ -331,8 +341,8 @@
     sum: function (v) { var a = numbers(v); return a.length ? a.reduce(function (s, x) { return s + x; }, 0) : null; },
     avg: function (v) { var a = numbers(v); return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : null; },
     median: function (v) { var a = numbers(v).sort(function (x, y) { return x - y; }); return quantile(a, 0.5); },
-    min: function (v) { var a = numbers(v); return a.length ? Math.min.apply(null, a) : null; },
-    max: function (v) { var a = numbers(v); return a.length ? Math.max.apply(null, a) : null; },
+    min: function (v) { return extreme(v, -1); },
+    max: function (v) { return extreme(v, 1); },
     count: function (v) { var c = 0; for (var i = 0; i < v.length; i++) if (!isNull(v[i])) c++; return c; },
     countd: function (v) { var s = new Set(); for (var i = 0; i < v.length; i++) if (!isNull(v[i])) s.add(v[i]); return s.size; },
     stdev: function (v) {
```

### E7 — Object.prototype reachable through plain-object lookups (hardening)

*kit/core/rk.expr.js · tests: `E7 …` in engine-audit.test.js*

`KEYWORDS`, `SCALAR`, `AGG`, `AGG_EXTRA` and `LAZY` are plain objects, and field and param reads use `row[name]` and
`name in params`. Consequences:
- `constructor` and `__proto__` lex as keywords, so a field with that name is unusable, with the error "Unexpected
  keyword". The Python validator accepts such names, so the browser then rejects a dataset the build passed.
- Without a schema, `` `constructor` `` evaluates to the `Object` function, `[toString]` to a native function, and
  `@__proto__` to `Object.prototype`.
- A query column for a schema field missing in a row (`` `constructor` from ctor ``) returns the `Object` function as
  the cell value.

No code execution is possible (see the security review). **Fix:** a `has()` own-property helper for every table
lookup, field read and param read.

```diff
diff --git a/kit/core/rk.expr.js b/kit/core/rk.expr.js
index 11025db..f641c30 100644
--- a/kit/core/rk.expr.js
+++ b/kit/core/rk.expr.js
@@ -33,6 +33,8 @@
   var IDENT_PART = /[A-Za-z0-9_À-￿]/;
   var OPS = ['==', '!=', '<>', '<=', '>=', '&&', '||', '+', '-', '*', '/', '^', '<', '>', '=', '!', '(', ')', ',', '?', ':', '[', ']'];
   var KEYWORDS = { and: 1, or: 1, not: 1, in: 1, true: 1, false: 1, null: 1 };
+  // own-property lookups only: "constructor", "__proto__", "toString" ... must never resolve to Object.prototype members
+  function has(obj, key) { return obj != null && Object.prototype.hasOwnProperty.call(obj, key); }
 
   function tokenize(src) {
     var toks = [], i = 0, n = src.length;
@@ -78,7 +80,7 @@
         var id = '';
         while (i < n && IDENT_PART.test(src[i])) id += src[i++];
         var low = id.toLowerCase();
-        if (KEYWORDS[low]) toks.push({ t: 'kw', v: low, pos: start });
+        if (has(KEYWORDS, low)) toks.push({ t: 'kw', v: low, pos: start });
         else toks.push({ t: 'id', v: id, pos: start });
         continue;
       }
@@ -373,8 +375,8 @@
 
   function isAggCall(node) {
     if (node.type !== 'call') return false;
-    if (AGG_EXTRA[node.name]) return true;
-    if (!AGG[node.name]) return false;
+    if (has(AGG_EXTRA, node.name)) return true;
+    if (!has(AGG, node.name)) return false;
     // min/max with 2+ args are scalar
     if ((node.name === 'min' || node.name === 'max') && node.args.length > 1) return false;
     return true;
@@ -443,13 +445,13 @@
       case 'field': {
         var name = this.resolve(node.name, node.pos);
         if (this.fieldsUsed.indexOf(name) < 0) this.fieldsUsed.push(name);
-        return function (row) { return row ? row[name] : null; };
+        return function (row) { return has(row, name) ? row[name] : null; };
       }
       case 'param': {
         if (this.paramsUsed.indexOf(node.name) < 0) this.paramsUsed.push(node.name);
         return function (row, env) {
           var p = env && env.params ? env.params : (RK.store ? RK.store.params() : {});
-          if (!(node.name in p)) throw new ExprError('Unknown parameter @' + node.name, node.pos);
+          if (!has(p, node.name)) throw new ExprError('Unknown parameter @' + node.name, node.pos);
           return p[node.name];
         };
       }
@@ -497,7 +499,7 @@
 
   Compiler.prototype.scalarCall = function (node, args) {
     var name = node.name;
-    if (LAZY[name]) {
+    if (has(LAZY, name)) {
       if (args.length < 2) throw new ExprError('if(condition, then, else) needs at least 2 arguments', node.pos);
       return function (r, e) { return args[0](r, e) ? args[1](r, e) : (args[2] ? args[2](r, e) : null); };
     }
@@ -508,7 +510,7 @@
         return vals.length ? mm.apply(null, vals) : null;
       };
     }
-    var fn = SCALAR[name];
+    var fn = has(SCALAR, name) ? SCALAR[name] : null;
     if (!fn) throw new ExprError('Unknown function ' + name + '()', node.pos);
     return function (r, e) { return fn.apply(null, args.map(function (f) { return f(r, e); })); };
   };
```

### E8 — `clamp()` / `between()` with a missing bound

*kit/core/rk.expr.js · tests: `E8 …` in engine-audit.test.js*

`Math.max(null, …)` treats null as 0: `clamp(5)` = 0 and `clamp(-5, null, 3)` = 0. `between(-5, null, 10)` is false
because `-5 >= 0` is false. The store's `between` filter already treats a null bound as open. **Fix:** a null bound is
unbounded.

```diff
diff --git a/kit/core/rk.expr.js b/kit/core/rk.expr.js
index f641c30..7c16bee 100644
--- a/kit/core/rk.expr.js
+++ b/kit/core/rk.expr.js
@@ -312,7 +312,13 @@
     log: function (x, b) { x = num(x); if (x === null) return null; if (x <= 0) return NaN; return b == null ? Math.log10(x) : Math.log(x) / Math.log(num(b)); },
     log10: function (x) { x = num(x); return x === null ? null : (x <= 0 ? NaN : Math.log10(x)); },
     sign: function (x) { x = num(x); return x === null ? null : Math.sign(x); },
-    clamp: function (x, lo, hi) { x = num(x); return x === null ? null : Math.max(num(lo), Math.min(num(hi), x)); },
+    clamp: function (x, lo, hi) {
+      x = num(x); lo = num(lo); hi = num(hi);              // a null / missing bound means "no bound"
+      if (x === null) return null;
+      if (lo !== null && x < lo) x = lo;
+      if (hi !== null && x > hi) x = hi;
+      return x;
+    },
     div: function (a, b) { a = num(a); b = num(b); return a === null || b === null || b === 0 ? null : a / b; },
     pct_change: function (a, b) { a = num(a); b = num(b); return a === null || b === null ? null : (b === 0 ? NaN : a / b - 1); },
     cagr: function (end, start, years) {
@@ -323,7 +329,7 @@
     },
     coalesce: function () { for (var i = 0; i < arguments.length; i++) if (!isNull(arguments[i]) && !(typeof arguments[i] === 'number' && isNaN(arguments[i]))) return arguments[i]; return null; },
     isnull: function (x) { return isNull(x) || (typeof x === 'number' && isNaN(x)); },
-    between: function (x, lo, hi) { x = num(x); return x !== null && x >= num(lo) && x <= num(hi); },
+    between: function (x, lo, hi) { x = num(x); lo = num(lo); hi = num(hi); return x !== null && (lo === null || x >= lo) && (hi === null || x <= hi); },
     number: function (x) { return num(x); },
     text: function (x, f) { return f != null && RK.format ? RK.format(x, f) : (isNull(x) ? '' : String(x)); },
     len: function (s) { return isNull(s) ? 0 : String(s).length; },
```

### E9 — String predicates and null

*kit/core/rk.expr.js · tests: `E9 …` in engine-audit.test.js*

`String(null)` is `"null"`, so `contains("a null b", null)` is true. `"abc".slice(-0)` is `"abc"`, so
`endswith("abc", "")` is false while `startswith("abc", "")` is true. **Fix:** a null needle never matches; an empty
suffix matches.

```diff
diff --git a/kit/core/rk.expr.js b/kit/core/rk.expr.js
index 7c16bee..3b43348 100644
--- a/kit/core/rk.expr.js
+++ b/kit/core/rk.expr.js
@@ -336,9 +336,9 @@
     lower: function (s) { return isNull(s) ? s : String(s).toLowerCase(); },
     upper: function (s) { return isNull(s) ? s : String(s).toUpperCase(); },
     concat: function () { return [].slice.call(arguments).map(function (v) { return isNull(v) ? '' : String(v); }).join(''); },
-    contains: function (s, sub) { return !isNull(s) && String(s).toLowerCase().indexOf(String(sub).toLowerCase()) >= 0; },
-    startswith: function (s, p) { return !isNull(s) && String(s).toLowerCase().indexOf(String(p).toLowerCase()) === 0; },
-    endswith: function (s, p) { if (isNull(s)) return false; s = String(s).toLowerCase(); p = String(p).toLowerCase(); return s.slice(-p.length) === p; },
+    contains: function (s, sub) { return !isNull(s) && sub != null && String(s).toLowerCase().indexOf(String(sub).toLowerCase()) >= 0; },
+    startswith: function (s, p) { return !isNull(s) && p != null && String(s).toLowerCase().indexOf(String(p).toLowerCase()) === 0; },
+    endswith: function (s, p) { if (isNull(s) || p == null) return false; s = String(s).toLowerCase(); p = String(p).toLowerCase(); return !p.length || s.slice(-p.length) === p; },
     year: function (d) { d = toDate(d); return d ? d.getFullYear() : null; },
     month: function (d) { d = toDate(d); return d ? d.getMonth() + 1 : null; },
     quarter: function (d) { d = toDate(d); return d ? Math.floor(d.getMonth() / 3) + 1 : null; }
```

### E10 — Stack overflow surfaces as RangeError

*kit/core/rk.expr.js · tests: `E10 …` in engine-audit.test.js*

The recursive-descent parser, the compiler and the closures recurse per nesting level. About 1,000 nested parentheses,
or a 10,000-term `1+1+…` (a left-deep tree), throw `RangeError` (Firefox: `InternalError: too much recursion`) instead
of `ExprError`. `check()` still catches it. **Fix:** convert stack overflows in `compile()` and during evaluation into
`ExprError("Formula is too deeply nested or too long — …")`.

```diff
diff --git a/kit/core/rk.expr.js b/kit/core/rk.expr.js
index 3b43348..9a89816 100644
--- a/kit/core/rk.expr.js
+++ b/kit/core/rk.expr.js
@@ -578,6 +578,16 @@
    * ------------------------------------------------------------------ */
   var cache = new Map();
 
+  // A stack overflow (thousands of nested parentheses / terms) surfaces as an ExprError, not a RangeError
+  // (V8 / JavaScriptCore) or InternalError "too much recursion" (Firefox).
+  function tooDeep(e) {
+    var overflow = e && (e instanceof RangeError || e.name === 'InternalError') && /stack|recursion/i.test(e.message);
+    return overflow ? new ExprError('Formula is too deeply nested or too long — split it into several computed fields') : e;
+  }
+  function guardDepth(fn) {
+    return function (x, env) { try { return fn(x, env); } catch (e) { throw tooDeep(e); } };
+  }
+
   /**
    * compile(src, {fields}) -> { src, aggregate, fields, params, eval(row|rows, env) }
    * fields: dataset schema fields (array of {name,title}) for validation & title matching.
@@ -586,10 +596,13 @@
     opts = opts || {};
     var key = opts.fields ? null : src;
     if (key && cache.has(key)) return cache.get(key);
-    var ast = new Parser(tokenize(String(src))).parse();
-    var c = new Compiler(opts);
-    var aggregate = containsAgg(ast);
-    var fn = aggregate ? c.agg(ast) : c.row(ast);
+    var ast, c, aggregate, fn;
+    try {
+      ast = new Parser(tokenize(String(src))).parse();
+      c = new Compiler(opts);
+      aggregate = containsAgg(ast);
+      fn = guardDepth(aggregate ? c.agg(ast) : c.row(ast));
+    } catch (e) { throw tooDeep(e); }
     var out = { src: src, ast: ast, aggregate: aggregate, fields: c.fieldsUsed, params: c.paramsUsed, eval: fn };
     if (key) cache.set(key, out);
     return out;
```

### E11 — Unbounded edit-distance suggestions

*kit/core/rk.expr.js · tests: `E11 …` in engine-audit.test.js*

`levenshtein(name, field)` is O(|name|·|field|) per field, with an (|name|+1)-row matrix. A pasted 100k-character
identifier blocks the UI for about 5 s, and the error echoes the whole name. **Fix:** no suggestions for names longer
than 64 characters, and the name in the message is truncated.

```diff
diff --git a/kit/core/rk.expr.js b/kit/core/rk.expr.js
index 9a89816..aeef59e 100644
--- a/kit/core/rk.expr.js
+++ b/kit/core/rk.expr.js
@@ -429,9 +429,11 @@
     });
     return function (name, pos) {
       if (Object.prototype.hasOwnProperty.call(byKey, norm(name))) return byKey[norm(name)];
-      var sugg = names.map(function (n) { return [n, levenshtein(norm(name), norm(n))]; })
+      var key = norm(name);   // edit distance is O(len^2): no suggestions for absurdly long names (pasted text)
+      var sugg = key.length > 64 ? [] : names.map(function (n) { return [n, levenshtein(key, norm(n).slice(0, 64))]; })
         .sort(function (x, y) { return x[1] - y[1]; }).slice(0, 3).map(function (x) { return x[0]; });
-      throw new ExprError('Unknown field "' + name + '"' + (sugg.length ? ' — did you mean ' + sugg.join(', ') + '?' : ''), pos);
+      var shown = name.length > 80 ? name.slice(0, 77) + '...' : name;
+      throw new ExprError('Unknown field "' + shown + '"' + (sugg.length ? ' — did you mean ' + sugg.join(', ') + '?' : ''), pos);
     };
   }
 
```

### E12 — Aggregate formula on a single record

*kit/core/rk.expr.js · tests: `E12 …` in engine-audit.test.js*

`RK.expr.compile('sum(v)').eval({v: 1})` throws `TypeError: rows.map is not a function`. **Fix:** throw a clear
ExprError: '"sum(v)" is an aggregate formula (sum, avg, ...): evaluate it on an array of rows, not a single record'.
The existing `core.test.js` test "expr agg in row errors" expects a throw, so it is kept.

```diff
diff --git a/kit/core/rk.expr.js b/kit/core/rk.expr.js
index aeef59e..e3c2d77 100644
--- a/kit/core/rk.expr.js
+++ b/kit/core/rk.expr.js
@@ -586,6 +586,13 @@
     var overflow = e && (e instanceof RangeError || e.name === 'InternalError') && /stack|recursion/i.test(e.message);
     return overflow ? new ExprError('Formula is too deeply nested or too long — split it into several computed fields') : e;
   }
+  // an aggregate formula needs the rows of a group: say so instead of "TypeError: rows.map is not a function"
+  function asRows(fn, src) {
+    return function (rows, env) {
+      if (!Array.isArray(rows)) throw new ExprError('"' + src + '" is an aggregate formula (sum, avg, ...): evaluate it on an array of rows, not a single record');
+      return fn(rows, env);
+    };
+  }
   function guardDepth(fn) {
     return function (x, env) { try { return fn(x, env); } catch (e) { throw tooDeep(e); } };
   }
@@ -603,7 +610,7 @@
       ast = new Parser(tokenize(String(src))).parse();
       c = new Compiler(opts);
       aggregate = containsAgg(ast);
-      fn = guardDepth(aggregate ? c.agg(ast) : c.row(ast));
+      fn = guardDepth(aggregate ? asRows(c.agg(ast), src) : c.row(ast));
     } catch (e) { throw tooDeep(e); }
     var out = { src: src, ast: ast, aggregate: aggregate, fields: c.fieldsUsed, params: c.paramsUsed, eval: fn };
     if (key) cache.set(key, out);
```

### F1 — Display rounding does not match Excel

*kit/core/rk.format.js · tests: `F1 …` in engine-audit.test.js*

`renderNum()` used `v.toFixed(d)`, which rounds the *binary* value. Doubles just below a .x5 boundary therefore round
down: 10.35 → "10.3x", 8.85 → "8.8x", 2.675 → "$2.67", 1.005 → "1.00". Excel rounds the 15-significant-digit decimal
value half away from zero (10.4x, 8.9x, $2.68, 1.01). On the bundled samples the patch changes 121 of 26,456 rendered
cells. Examples: `peers` Corvane Automation revenue growth 0.0705 ("7.0%" → "7.1%"), `precedents` Brightwell Motion
EV/revenue 1.65 ("1.6x" → "1.7x"), `ntm_multiple` 8.95 ("8.9x" → "9.0x"), and 22 `price_perf` values. **Fix:** a
`fixed(v, d)` helper that rounds `v·10^d` at 15 significant digits and builds the digit string from the integer, with
no second division. It also clamps `d` to 0–20; `toFixed(101)` threw RangeError.

```diff
diff --git a/kit/core/rk.format.js b/kit/core/rk.format.js
index 1efc2c5..30e362f 100644
--- a/kit/core/rk.format.js
+++ b/kit/core/rk.format.js
@@ -143,9 +143,23 @@
     return out;
   }
 
+  /**
+   * v.toFixed(d) for v >= 0, rounded like Excel: half away from zero on the 15-significant-digit
+   * decimal value, so 10.35 -> "10.4" (toFixed: "10.3"), 2.675 -> "2.68", 1.005 -> "1.01". d is clamped to 0..20.
+   */
+  function fixed(v, d) {
+    d = Math.max(0, Math.min(20, d || 0));
+    var y = +(v * Math.pow(10, d)).toPrecision(15);
+    if (!(y < 9007199254740992)) return v.toFixed(d);
+    var s = String(Math.round(y));
+    if (!d) return s;
+    while (s.length <= d) s = '0' + s;
+    return s.slice(0, s.length - d) + '.' + s.slice(s.length - d);
+  }
+
   function renderNum(abs, t) {
     var v = abs * Math.pow(100, t.percent) / Math.pow(1000, t.scale);
-    var s = v.toFixed(t.maxDec);
+    var s = fixed(v, t.maxDec);
     var parts = s.split('.');
     var ip = parts[0], dp = parts[1] || '';
     // trim optional decimals (#)
```

### F2 — General format

*kit/core/rk.format.js · tests: `F2 …` in engine-audit.test.js*

General is used for every column without a format: most query expressions, `text(x)` and `RK.format(v)`. Three bugs:
- `groupDigits(String(Math.round(v)))` groups the minus sign as a digit, so -123,456 → "-,123,456".
- `toFixed(2)` turns 0.000123 into "0" and -0.0023 into "-0" (seen on `monthly_returns`).
- ≥ 1e21 gives "1e,+21".

**Fix:** group |v| and then add the sign; keep 3 significant digits below 0.01; never print a minus on zero.

```diff
diff --git a/kit/core/rk.format.js b/kit/core/rk.format.js
index 30e362f..07611fb 100644
--- a/kit/core/rk.format.js
+++ b/kit/core/rk.format.js
@@ -234,6 +234,14 @@
     if (abs !== 0 && abs < 1) return (v < 0 ? config.minus : '') + trimZeros(abs.toFixed(Math.max(d, 2)));
     return (v < 0 ? config.minus : '') + trimZeros(abs.toFixed(abs < 10 ? d : 0));
   }
+  /** Default format when a field has none: grouped integers from 10,000, 2 decimals, small values keep 3 significant digits. */
+  function general(v) {
+    var abs = Math.abs(v), s;
+    if (abs >= 1e4) s = groupDigits(fixed(abs, 0));          // group the digits, then add the sign: not "-,123,456"
+    else if (abs >= 0.01 || abs === 0) s = trimZeros(fixed(abs, 2));
+    else s = String(+abs.toPrecision(3));                      // 0.000123 -> "0.000123", not "0"
+    return v < 0 && /[1-9]/.test(s) ? config.minus + s : s;
+  }
   function trimZeros(s) { return s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s; }
 
   /* ---------------- public API ---------------- */
@@ -245,7 +253,7 @@
     if (cache[code]) return cache[code];
     var fn;
     if (code === 'auto') fn = function (v) { return compact(v, 1); };
-    else if (code === 'General') fn = function (v) { return Math.abs(v) >= 1e4 ? groupDigits(String(Math.round(v))) : trimZeros(v.toFixed(2)); };
+    else if (code === 'General') fn = general;
     else if (code === '@') fn = function (v) { return String(v); };
     else if (isNumericCode(code)) fn = compileNumeric(code);
     else if (/[ymdq]/.test(code.replace(/"[^"]*"/g, ''))) fn = compileDate(code);
```

### F3 — Numbers ≥ 1e21

*kit/core/rk.format.js · tests: `F3 …` in engine-audit.test.js*

`toFixed` switches to exponent notation from 1e21. The code then splits on "." and groups the mantissa:
`F(1.5e300, '#,##0')` → **"1.5e+3"**, which reads as 1,500. **Fix (inside `fixed()`):** once beyond 2^53, print the
15 significant digits followed by zeros, as Excel does.

```diff
diff --git a/kit/core/rk.format.js b/kit/core/rk.format.js
index 07611fb..e4c6540 100644
--- a/kit/core/rk.format.js
+++ b/kit/core/rk.format.js
@@ -150,7 +150,14 @@
   function fixed(v, d) {
     d = Math.max(0, Math.min(20, d || 0));
     var y = +(v * Math.pow(10, d)).toPrecision(15);
-    if (!(y < 9007199254740992)) return v.toFixed(d);
+    if (!(y < 9007199254740992)) {
+      // more digits than a double holds (toFixed even switches to "1.5e+300" from 1e21): 15 significant digits, like Excel
+      var p = v.toPrecision(15), e = p.indexOf('e');
+      if (e >= 0) { var dg = p.slice(0, e).replace('.', ''); p = dg + new Array(+p.slice(e + 1) - dg.length + 2).join('0'); }
+      var parts = p.split('.'), dec = parts[1] || '';
+      while (dec.length < d) dec += '0';
+      return parts[0] + (d ? '.' + dec.slice(0, d) : '');
+    }
     var s = String(Math.round(y));
     if (!d) return s;
     while (s.length <= d) s = '0' + s;
```

### F4 — `auto` compact format

*kit/core/rk.format.js · tests: `F4 …` in engine-audit.test.js*

The unit is chosen before rounding, so 999,950 → "1000k" (should be "1m") and 999.95 → "1000" (should be "1k").
Tiny negatives print "-0". **Fix:** promote to the next unit when the rounded value reaches 1,000, and add the sign only
to non-zero output.

```diff
diff --git a/kit/core/rk.format.js b/kit/core/rk.format.js
index e4c6540..d31fe6f 100644
--- a/kit/core/rk.format.js
+++ b/kit/core/rk.format.js
@@ -233,13 +233,21 @@
   /* ---------------- compact auto ---------------- */
 
   function compact(v, decimals) {
-    var abs = Math.abs(v), d = decimals == null ? 1 : decimals;
-    for (var i = 0; i < config.compactUnits.length; i++) {
-      var u = config.compactUnits[i];
-      if (abs >= u[0]) return (v < 0 ? config.minus : '') + trimZeros((abs / u[0]).toFixed(d)) + u[1];
+    var abs = Math.abs(v), d = decimals == null ? 1 : decimals, units = config.compactUnits, s = null;
+    for (var i = 0; i < units.length && s === null; i++) {
+      var u = units[i];
+      if (abs < u[0]) continue;
+      s = fixed(abs / u[0], d);
+      // 999,950 -> "1m", not "1000k"
+      if (i > 0 && +s >= 1000) { u = units[i - 1]; s = fixed(abs / u[0], d); }
+      s = trimZeros(s) + u[1];
     }
-    if (abs !== 0 && abs < 1) return (v < 0 ? config.minus : '') + trimZeros(abs.toFixed(Math.max(d, 2)));
-    return (v < 0 ? config.minus : '') + trimZeros(abs.toFixed(abs < 10 ? d : 0));
+    if (s === null) {
+      s = trimZeros(fixed(abs, abs !== 0 && abs < 1 ? Math.max(d, 2) : abs < 10 ? d : 0));
+      var k = units[units.length - 1];
+      if (+s >= k[0]) s = trimZeros(fixed(abs / k[0], d)) + k[1];      // 999.95 -> "1k", not "1000"
+    }
+    return v < 0 && /[1-9]/.test(s) ? config.minus + s : s;              // no "-0"
   }
   /** Default format when a field has none: grouped integers from 10,000, 2 decimals, small values keep 3 significant digits. */
   function general(v) {
```

### F5 — Dates

*kit/core/rk.format.js · tests: `F5 …` in engine-audit.test.js*

Three bugs:
- `new Date(NaN)` renders as "aN undefined NaN".
- `"2026-13-45"` silently rolls over to 14 Feb 2027, and `"2026-02-30"` to 02 Mar 2026.
- A numeric fiscal year 2026 with `yyyy`, or `year(2026)` in formulas, is read as 2026 ms after the epoch, giving
  "1970".

**Fix:** an Invalid Date is n.a.; ISO month and day are validated, and an invalid date string passes through unchanged
like any unparseable date; an integer from 1000 to 9999 is a year.

```diff
diff --git a/kit/core/rk.format.js b/kit/core/rk.format.js
index d31fe6f..efc5b01 100644
--- a/kit/core/rk.format.js
+++ b/kit/core/rk.format.js
@@ -197,11 +197,19 @@
   /* ---------------- dates ---------------- */
 
   function toDate(v) {
-    if (v instanceof Date) return v;
-    if (typeof v === 'number') return new Date(v);
+    if (v instanceof Date) return isNaN(v) ? null : v;
+    if (typeof v === 'number') {
+      if (!isFinite(v)) return null;
+      // a bare 4-digit integer is a (fiscal) year, not 2026 ms after 1 Jan 1970
+      return v % 1 === 0 && v >= 1000 && v <= 9999 ? new Date(v, 0, 1) : new Date(v);
+    }
     if (typeof v === 'string') {
       var m = v.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
-      if (m) return new Date(+m[1], +m[2] - 1, +(m[3] || 1));
+      if (m) {
+        var mo = +m[2], day = +(m[3] || 1);
+        if (mo < 1 || mo > 12 || day < 1 || day > new Date(+m[1], mo, 0).getDate()) return null;   // "2026-13-45": no silent roll-over
+        return new Date(+m[1], mo - 1, day);
+      }
       var d = new Date(v);
       return isNaN(d) ? null : d;
     }
@@ -288,7 +296,7 @@
       if (isDateCode(spec)) return compile(spec)(v);
       return v;
     }
-    if (v instanceof Date) return compile(spec || 'date')(v);
+    if (v instanceof Date) return isNaN(v) ? ((opts && opts.na != null) ? opts.na : config.na) : compile(spec || 'date')(v);
     if (typeof v === 'boolean') return v ? 'Yes' : 'No';
     if (!isFinite(v)) return (opts && opts.nm != null) ? opts.nm : config.nm;
     return compile(spec)(v);
```

### F6 — Preset lookup and mistyped presets

*kit/core/rk.format.js · tests: `F6 …` in engine-audit.test.js*

`presets[code]` is a plain-object lookup, so `format: "constructor"` makes `code` the `Object` function and
`code.replace` throws **TypeError** inside `RK.format`. A malformed dataset `format` breaks the whole block. A typo such
as `usd_mn` or `eur_mm` contains d/m/y, becomes a date code, and renders 4,520 as "us1_1n". **Fix:** own-property
preset lookup. An identifier-like code that is not made only of date tokens is treated as an unknown preset and
rendered with General.

```diff
diff --git a/kit/core/rk.format.js b/kit/core/rk.format.js
index efc5b01..fb99506 100644
--- a/kit/core/rk.format.js
+++ b/kit/core/rk.format.js
@@ -272,22 +272,30 @@
   function compile(spec) {
     if (typeof spec === 'function') return spec;
     var code = spec == null || spec === '' ? 'General' : String(spec);
-    if (presets[code]) code = presets[code];
+    if (isPreset(code)) code = presets[code];
     if (cache[code]) return cache[code];
     var fn;
     if (code === 'auto') fn = function (v) { return compact(v, 1); };
     else if (code === 'General') fn = general;
     else if (code === '@') fn = function (v) { return String(v); };
     else if (isNumericCode(code)) fn = compileNumeric(code);
-    else if (/[ymdq]/.test(code.replace(/"[^"]*"/g, ''))) fn = compileDate(code);
-    else fn = function (v) { return String(v); };
+    else if (looksLikeDate(code)) fn = compileDate(code);
+    else fn = general;   // unknown preset name (typo) or plain text: readable number, not a garbled date
     cache[code] = fn;
     return fn;
   }
 
+  function isPreset(name) { return Object.prototype.hasOwnProperty.call(presets, name); }   // not "constructor", "toString" ...
+  function looksLikeDate(code) {
+    var bare = code.replace(/"[^"]*"/g, '').replace(/\\./g, '');
+    if (!/[ymdq]/.test(bare)) return false;
+    // a bare identifier that is not made only of date tokens ("usd_mn", "pct_1") is a mistyped preset name
+    return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(bare) || /^(?:yyyy|yy|mmmm|mmm|mm|m|dd|d|q)+$/.test(bare);
+  }
+
   function isDateCode(spec) {
-    var code = presets[spec] || spec;
-    return typeof code === 'string' && !isNumericCode(code) && /[ymdq]/.test(code.replace(/"[^"]*"/g, ''));
+    var code = isPreset(spec) ? presets[spec] : spec;
+    return typeof code === 'string' && !isNumericCode(code) && looksLikeDate(code);
   }
 
   function format(v, spec, opts) {
@@ -310,8 +318,8 @@
   format.isDateCode = isDateCode;
   /** Number of decimals a format code shows — useful for axis label precision. */
   format.decimals = function (spec) {
-    var code = presets[spec] || spec;
-    if (!code || !isNumericCode(code)) return null;
+    var code = isPreset(spec) ? presets[spec] : spec;
+    if (typeof code !== 'string' || !isNumericCode(code)) return null;
     return parseNumSection(splitSections(code)[0]).maxDec;
   };
 
```

### F7 — Empty zero section

*kit/core/rk.format.js · tests: `F7 …` in engine-audit.test.js*

Excel's `#,##0;(#,##0);` (empty third section) hides zeros; ReportKit printed "0". **Fix:** an empty zero section
renders "". An empty *negative* section keeps falling back to the positive section with a minus, deliberately safer
than Excel, which would hide negatives on a typo.

```diff
diff --git a/kit/core/rk.format.js b/kit/core/rk.format.js
index fb99506..bdde83d 100644
--- a/kit/core/rk.format.js
+++ b/kit/core/rk.format.js
@@ -182,7 +182,9 @@
     var pos = parseNumSection(secs[0]);
     var neg = secs[1] != null && secs[1] !== '' ? parseNumSection(secs[1]) : null;
     var zero = secs[2] != null && secs[2] !== '' ? parseNumSection(secs[2]) : null;
+    var hideZero = secs.length > 2 && secs[2] === '';      // Excel "#,##0;(#,##0);" idiom: blank for zero
     return function (v) {
+      if (v === 0 && hideZero) return '';
       if (v === 0 && zero) return renderNum(0, zero);
       if (v < 0) {
         if (neg) return renderNum(-v, neg);
```

### F8 — Values that round to zero

*kit/core/rk.format.js · tests: `F8 …` in engine-audit.test.js*

The "never print -0.0" rule only applied when there was no explicit negative section, and it tested the whole output
string for digits, so `0.0" FY25"` gave "-0.0 FY25". With explicit sections, -0.0004 shows as "-0.0%" with
`delta_pct`, and 0.0004 as "+0.0%". -0.04 shows as "(0.0)" with `acct1`. **Fix:** a value that rounds to zero at
the section's precision uses the zero section, or else the unsigned positive section. This is a deliberate,
documented deviation from Excel for client output.

```diff
diff --git a/kit/core/rk.format.js b/kit/core/rk.format.js
index bdde83d..b6f63d0 100644
--- a/kit/core/rk.format.js
+++ b/kit/core/rk.format.js
@@ -183,15 +183,14 @@
     var neg = secs[1] != null && secs[1] !== '' ? parseNumSection(secs[1]) : null;
     var zero = secs[2] != null && secs[2] !== '' ? parseNumSection(secs[2]) : null;
     var hideZero = secs.length > 2 && secs[2] === '';      // Excel "#,##0;(#,##0);" idiom: blank for zero
+    // value that shows as zero at the section's precision (-0.0004 with "0.0%")
+    function roundsToZero(abs, t) { return !/[1-9]/.test(fixed(abs * Math.pow(100, t.percent) / Math.pow(1000, t.scale), t.maxDec)); }
     return function (v) {
       if (v === 0 && hideZero) return '';
       if (v === 0 && zero) return renderNum(0, zero);
-      if (v < 0) {
-        if (neg) return renderNum(-v, neg);
-        var out = renderNum(-v, pos);
-        // do not print "-0.0"
-        return /[1-9]/.test(out) ? config.minus + out : out;
-      }
+      // never "-0.0", "(0.0)" or "+0.0%": a value that rounds to zero uses the zero section, else the unsigned positive one
+      if (v !== 0 && roundsToZero(Math.abs(v), v < 0 && neg ? neg : pos)) return renderNum(0, zero || pos);
+      if (v < 0) return neg ? renderNum(-v, neg) : config.minus + renderNum(-v, pos);
       return renderNum(v, pos);
     };
   }
```

### F9 — Excel `[$…]` tags

*kit/core/rk.format.js · tests: `F9 …` in engine-audit.test.js*

`[$€-407]#,##0` is a common Excel euro format; it rendered "1,234" with no symbol. In date codes, `[$-409]dd mmm yyyy`
was worse: the `0` inside the tag made `isNumericCode()` true, so the date code was formatted as a number. **Fix:**
keep the currency text of `[$xxx-…]` tags, drop locale-only tags, and ignore `[...]` when classifying a code.

```diff
diff --git a/kit/core/rk.format.js b/kit/core/rk.format.js
index b6f63d0..280abe9 100644
--- a/kit/core/rk.format.js
+++ b/kit/core/rk.format.js
@@ -74,7 +74,10 @@
     return out;
   }
 
-  function isNumericCode(code) { return /[0#?]/.test(code.replace(/"[^"]*"/g, '').replace(/\\./g, '')); }
+  /** Text an Excel [...] tag contributes: "$€-407" -> "€", "$USD" -> "USD", "Red" / "$-409" -> "". */
+  function bracketText(tag) { return tag[0] === '$' ? tag.slice(1).split('-')[0] : ''; }
+
+  function isNumericCode(code) { return /[0#?]/.test(code.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '')); }
 
   /**
    * Parse one numeric section into a template:
@@ -96,7 +99,11 @@
         continue;
       }
       if (c === '\\') { if (numBuf) { flushNum(); numberDone = true; } tokens.push({ t: 'lit', v: sec[i + 1] || '' }); i++; continue; }
-      if (c === '[') { var k = sec.indexOf(']', i); i = k < 0 ? sec.length : k; continue; } // [Red], [$-409] ...
+      if (c === '[') { // [Red], [$-409] are dropped; [$€-407] / [$USD] keep their currency text
+        var k = sec.indexOf(']', i), cur = bracketText(sec.slice(i + 1, k < 0 ? sec.length : k));
+        if (cur) { if (numBuf) { flushNum(); numberDone = true; } tokens.push({ t: 'lit', v: cur }); }
+        i = k < 0 ? sec.length : k; continue;
+      }
       if (c === '_') { if (numBuf) { flushNum(); numberDone = true; } tokens.push({ t: 'lit', v: ' ' }); i++; continue; } // width of next char
       if (c === '*') { i++; continue; } // repeat-fill: ignore
       if (!numberDone && (c === '0' || c === '#' || c === '?' || (c === '.' && !/\./.test(numBuf)) || (c === ',' && (numBuf || seenNumber)))) {
@@ -218,7 +225,7 @@
   }
 
   function compileDate(code) {
-    var re = /"[^"]*"|\\.|yyyy|yy|mmmm|mmm|mm|m|dd|d|q/g;
+    var re = /"[^"]*"|\\.|\[[^\]]*\]|yyyy|yy|mmmm|mmm|mm|m|dd|d|q/g;
     return function (v) {
       var d = toDate(v);
       if (!d) return String(v);
@@ -233,7 +240,7 @@
           case 'dd': return ('0' + d.getDate()).slice(-2);
           case 'd': return String(d.getDate());
           case 'q': return String(Math.floor(d.getMonth() / 3) + 1);
-          default: return tk[0] === '"' ? tk.slice(1, -1) : tk.slice(1);
+          default: return tk[0] === '"' ? tk.slice(1, -1) : tk[0] === '[' ? bracketText(tk.slice(1, -1)) : tk.slice(1);
         }
       });
     };
```

### F10 — Weekday tokens

*kit/core/rk.format.js · tests: `F10 …` in engine-audit.test.js*

`ddd` / `dddd` matched `dd` + `d`, so "Wed 14 Oct" printed as "1414 14 Oct". **Fix:** `ddd` → "Wed", `dddd` →
"Wednesday" (`config.days`, `config.daysLong`).

```diff
diff --git a/kit/core/rk.format.js b/kit/core/rk.format.js
index 280abe9..fa08711 100644
--- a/kit/core/rk.format.js
+++ b/kit/core/rk.format.js
@@ -25,6 +25,8 @@
     minus: '-',
     months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
     monthsLong: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
+    days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
+    daysLong: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
     compactUnits: [[1e12, 'tn'], [1e9, 'bn'], [1e6, 'm'], [1e3, 'k']]
   };
 
@@ -225,7 +227,7 @@
   }
 
   function compileDate(code) {
-    var re = /"[^"]*"|\\.|\[[^\]]*\]|yyyy|yy|mmmm|mmm|mm|m|dd|d|q/g;
+    var re = /"[^"]*"|\\.|\[[^\]]*\]|yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|q/g;
     return function (v) {
       var d = toDate(v);
       if (!d) return String(v);
@@ -237,6 +239,8 @@
           case 'mmm': return config.months[d.getMonth()];
           case 'mm': return ('0' + (d.getMonth() + 1)).slice(-2);
           case 'm': return String(d.getMonth() + 1);
+          case 'dddd': return config.daysLong[d.getDay()];
+          case 'ddd': return config.days[d.getDay()];
           case 'dd': return ('0' + d.getDate()).slice(-2);
           case 'd': return String(d.getDate());
           case 'q': return String(Math.floor(d.getMonth() / 3) + 1);
```

### Q1 — `sort by`

*kit/core/rk.data.js · tests: `Q1 …` in engine-audit.test.js*

`CLAUSES` contains `order by` and `group by` but not `sort by`. `company, ev from peers sort by ev desc` therefore finds
`sort` with an empty key **and** `by ev desc` as a group-by clause. The error is `Unexpected "desc"`; without `desc`,
the rows are silently grouped. **Fix:** add `sort by`.

```diff
diff --git a/kit/core/rk.data.js b/kit/core/rk.data.js
index 5ce3099..dd0326b 100644
--- a/kit/core/rk.data.js
+++ b/kit/core/rk.data.js
@@ -377,7 +377,7 @@
    *   company, ev / ebitda_25e as "EV/EBITDA" format "0.0x" where region == "Asia" sort 2 desc top 5
    *   sum(revenue) as "Revenue" by region, year where year >= 2024
    */
-  var CLAUSES = ['group by', 'order by', 'from', 'by', 'where', 'sort', 'top', 'limit'];
+  var CLAUSES = ['group by', 'order by', 'sort by', 'from', 'by', 'where', 'sort', 'top', 'limit'];
 
   function splitTopLevel(text, sepFn) {
     var parts = [], depth = 0, q = null, start = 0;
@@ -424,7 +424,7 @@
           spec.by = splitTopLevel(body, function (t, i) { return t[i] === ',' ? 1 : 0; }).map(function (p) { return p.text.trim().replace(/^`|`$/g, ''); }).filter(Boolean);
           break;
         case 'where': spec.where = body; break;
-        case 'sort': case 'order by':
+        case 'sort': case 'sort by': case 'order by':
           spec.sort = splitTopLevel(body, function (t, i) { return t[i] === ',' ? 1 : 0; }).map(function (p) {
             var m = p.text.trim().match(/^(.*?)(?:\s+(asc|desc))?$/i);
             return { key: m[1].trim().replace(/^["'`]|["'`]$/g, ''), dir: (m[2] || 'desc').toLowerCase() };
```

### Q2 — Escaped quotes in the clause splitter

*kit/core/rk.data.js · tests: `Q2 …` in engine-audit.test.js*

`splitTopLevel()` ended a string at any matching quote, but the tokenizer honours `\"`. With
`where company == "a \" sort x"`, the splitter sees ` sort x"…` as a sort clause, and the rest of the query, including
`from`, is swallowed: "Choose a dataset". **Fix:** skip the character after a backslash inside '…' and "…".

```diff
diff --git a/kit/core/rk.data.js b/kit/core/rk.data.js
index dd0326b..5a90129 100644
--- a/kit/core/rk.data.js
+++ b/kit/core/rk.data.js
@@ -383,7 +383,7 @@
     var parts = [], depth = 0, q = null, start = 0;
     for (var i = 0; i < text.length; i++) {
       var c = text[i];
-      if (q) { if (c === q) q = null; continue; }
+      if (q) { if (c === '\\' && q !== '`') i++; else if (c === q) q = null; continue; }   // "a \" b": same escapes as RK.expr
       if (c === '"' || c === "'" || c === '`') { q = c; continue; }
       if (c === '(' || c === '[') depth++;
       else if (c === ')' || c === ']') depth--;
```

### Q3 — `` by `name with blanks` ``

*kit/core/rk.data.js · tests: `Q3 …` in engine-audit.test.js*

`parseQuery` stripped the backticks from `by` items, then compiled `HQ city` → `Unexpected "city"`. Spec objects
(`{by: ['Deal type']}`) also had to be valid formulas. **Fix:** keep the quotes, and accept exact field names directly.

```diff
diff --git a/kit/core/rk.data.js b/kit/core/rk.data.js
index 5a90129..c4db896 100644
--- a/kit/core/rk.data.js
+++ b/kit/core/rk.data.js
@@ -421,7 +421,7 @@
       switch (f.kw) {
         case 'from': spec.from = body.replace(/^[`"']|[`"']$/g, ''); break;
         case 'by': case 'group by':
-          spec.by = splitTopLevel(body, function (t, i) { return t[i] === ',' ? 1 : 0; }).map(function (p) { return p.text.trim().replace(/^`|`$/g, ''); }).filter(Boolean);
+          spec.by = splitTopLevel(body, function (t, i) { return t[i] === ',' ? 1 : 0; }).map(function (p) { return p.text.trim(); }).filter(Boolean);   // keep `quotes`: "HQ city" is two tokens
           break;
         case 'where': spec.where = body; break;
         case 'sort': case 'sort by': case 'order by':
@@ -479,6 +479,7 @@
       rows = rows.filter(function (r) { return !!w.eval(r, env); });
     }
     var by = (spec.by || []).map(function (b) {
+      if (ds.has(b)) return b;                                   // spec objects may pass raw names with spaces
       var c = RK.expr.compile(b, { fields: fields });
       if (c.ast.type !== 'field') throw new RK.expr.ExprError('"by" expects field names, got "' + b + '"');
       return c.fields[0];
```

### Q4 — Column format guessing

*kit/core/rk.data.js · tests: `Q4 …` in engine-audit.test.js*

`guessFormat()` inherited the first argument's format for **every** function call:

| Expression | Inherited format | Result |
|---|---|---|
| `pct_change(revenue_26e, revenue_25e)` | `$#,##0` | 7% renders as "$0" |
| `cagr(revenue_26e, revenue_24a, 2)` | `$#,##0` | "$0" |
| `div(ev, ebitda_25e)` | `$#,##0` | "$9" instead of 9.1x |
| `year(date)` | `dd mmm yyyy` | 2019 renders as "01 Jan 1970" |

**Fix:** only same-unit functions inherit (sum/avg/median/min/max/first/last/pctl/wavg/stdev/abs/round/floor/ceil/
clamp/coalesce). `count`/`countd` → `#,##0`, `pct_change`/`cagr` → `0.0%`, `year`/`month`/`quarter` → `0`, and
anything else gets General.

```diff
diff --git a/kit/core/rk.data.js b/kit/core/rk.data.js
index c4db896..e10b548 100644
--- a/kit/core/rk.data.js
+++ b/kit/core/rk.data.js
@@ -446,15 +446,20 @@
     return spec;
   }
 
+  // functions whose result has the unit of their first argument, so it keeps that field's format ...
+  var SAME_UNIT = { sum: 1, avg: 1, mean: 1, average: 1, median: 1, min: 1, max: 1, first: 1, last: 1, pctl: 1, percentile: 1,
+    wavg: 1, stdev: 1, stddev: 1, abs: 1, round: 1, floor: 1, ceil: 1, clamp: 1, coalesce: 1 };
+  // ... and functions with a unit of their own (pct_change(revenue, ...) is a %, not "$0")
+  var RESULT_FORMAT = { count: '#,##0', countd: '#,##0', pct_change: '0.0%', cagr: '0.0%', year: '0', month: '0', quarter: '0' };
   function guessFormat(c, ds) {
-    // single field or aggregate over a single field -> inherit that field's format
-    var ast = c.ast;
+    var ast = c.ast, own = Object.prototype.hasOwnProperty;
     if (ast.type === 'field' && ds.field(c.fields[0])) return ds.field(c.fields[0]).format;
-    if (ast.type === 'call' && ast.args.length && ast.args[0].type === 'field' && ast.name !== 'count' && ast.name !== 'countd') {
+    if (ast.type !== 'call') return null;
+    if (own.call(RESULT_FORMAT, ast.name)) return RESULT_FORMAT[ast.name];
+    if (own.call(SAME_UNIT, ast.name) && ast.args.length && ast.args[0].type === 'field') {
       var f = ds.field(c.fields[0]);
       return f && f.format;
     }
-    if (ast.type === 'call' && (ast.name === 'count' || ast.name === 'countd')) return '#,##0';
     return null;
   }
 
```

### Q5 — `top` / `limit` validation

*kit/core/rk.data.js · tests: `Q5 …` in engine-audit.test.js*

`parseInt(body) || null`:
- `top -3` → `slice(0, -3)` **drops the last three rows**.
- `top 0` and `top ten` → no limit.
- `top 2.9` → 2.

**Fix:** require a positive whole number, otherwise ExprError.

```diff
diff --git a/kit/core/rk.data.js b/kit/core/rk.data.js
index e10b548..ab432bf 100644
--- a/kit/core/rk.data.js
+++ b/kit/core/rk.data.js
@@ -430,7 +430,11 @@
             return { key: m[1].trim().replace(/^["'`]|["'`]$/g, ''), dir: (m[2] || 'desc').toLowerCase() };
           });
           break;
-        case 'top': case 'limit': spec.limit = parseInt(body, 10) || null; break;
+        case 'top': case 'limit':
+          // "top -3" used to drop the last 3 rows, "top 0" / "top ten" silently returned everything
+          if (!/^\d+$/.test(body) || +body < 1) throw new RK.expr.ExprError('"' + f.kw + '" expects a whole number of rows, e.g. top 10 (got "' + body + '")');
+          spec.limit = +body;
+          break;
       }
     });
     if (head) {
```

### Q6 — Repeated clauses

*kit/core/rk.data.js · tests: `Q6 …` in engine-audit.test.js*

`where ev > 100000 where ev > 0` keeps only the second condition and returns all 18 rows. The same happens with two
`sort`s, or `sort` plus `order by`. **Fix:** a clause given twice is an ExprError that suggests `and` or a comma
list.

```diff
diff --git a/kit/core/rk.data.js b/kit/core/rk.data.js
index ab432bf..e41eda9 100644
--- a/kit/core/rk.data.js
+++ b/kit/core/rk.data.js
@@ -415,9 +415,13 @@
     var spec = { select: [], by: [], where: null, sort: [], limit: null, from: null };
     var headEnd = found.length ? found[0].at : src.length;
     var head = src.slice(0, headEnd).trim();
+    var seen = {};
     found.forEach(function (f, idx) {
       var end = idx + 1 < found.length ? found[idx + 1].at : src.length;
       var body = src.slice(f.at + f.len, end).trim();
+      var kind = { 'group by': 'by', 'order by': 'sort', 'sort by': 'sort', limit: 'top' }[f.kw] || f.kw;
+      if (seen[kind]) throw new RK.expr.ExprError('"' + f.kw + '" appears more than once — combine conditions with "and", or list several columns separated by commas');
+      seen[kind] = true;
       switch (f.kw) {
         case 'from': spec.from = body.replace(/^[`"']|[`"']$/g, ''); break;
         case 'by': case 'group by':
```

### Q7 — `format` before `as`

*kit/core/rk.data.js · tests: `Q7 …` in engine-audit.test.js*

The item parser stripped `format …` only at the very end and then `as …`. `sum(ev) format "$#,##0" as "Total"` therefore
failed with `Unexpected "format"`. **Fix:** two passes, so either order works.

```diff
diff --git a/kit/core/rk.data.js b/kit/core/rk.data.js
index e41eda9..1ee440c 100644
--- a/kit/core/rk.data.js
+++ b/kit/core/rk.data.js
@@ -444,10 +444,12 @@
     if (head) {
       spec.select = splitTopLevel(head, function (t, i) { return t[i] === ',' ? 1 : 0; }).map(function (p) {
         var item = p.text.trim(), fmt = null, label = null;
-        var fm = item.match(/\s+format\s+("([^"]*)"|'([^']*)'|(\S+))\s*$/i);
-        if (fm) { fmt = fm[2] || fm[3] || fm[4]; item = item.slice(0, fm.index).trim(); }
-        var am = item.match(/\s+as\s+("([^"]*)"|'([^']*)'|`([^`]*)`|([\wÀ-￿]+))\s*$/i);
-        if (am) { label = am[2] || am[3] || am[4] || am[5]; item = item.slice(0, am.index).trim(); }
+        for (var pass = 0; pass < 2; pass++) {   // "as" and "format" may come in either order
+          var fm = fmt === null && item.match(/\s+format\s+("([^"]*)"|'([^']*)'|(\S+))\s*$/i);
+          if (fm) { fmt = fm[2] || fm[3] || fm[4]; item = item.slice(0, fm.index).trim(); }
+          var am = label === null && item.match(/\s+as\s+("([^"]*)"|'([^']*)'|`([^`]*)`|([\wÀ-￿]+))\s*$/i);
+          if (am) { label = am[2] || am[3] || am[4] || am[5]; item = item.slice(0, am.index).trim(); }
+        }
         return { expr: item, as: label, format: fmt };
       }).filter(function (s) { return s.expr; });
     }
```

### Q8 — Quadratic regexes

*kit/core/rk.data.js · tests: `Q8 …` in engine-audit.test.js*

`/\s+format\s+(…)\s*$/`, `/\s+as\s+(…)\s*$/` and `/^(.*?)(?:\s+(asc|desc))?$/` backtrack over every split of a run
of blanks. 50,000 blanks take 3.6 s (sort), 7 s (as) and 20 s (format); a pasted column of text can do this. **Fix:** a
single `\s` before the keyword on a trimmed item, and an anchored suffix match for `asc|desc`. All are linear: the same
inputs now take 19–41 ms.

```diff
diff --git a/kit/core/rk.data.js b/kit/core/rk.data.js
index 1ee440c..7936cd4 100644
--- a/kit/core/rk.data.js
+++ b/kit/core/rk.data.js
@@ -430,8 +430,8 @@
         case 'where': spec.where = body; break;
         case 'sort': case 'sort by': case 'order by':
           spec.sort = splitTopLevel(body, function (t, i) { return t[i] === ',' ? 1 : 0; }).map(function (p) {
-            var m = p.text.trim().match(/^(.*?)(?:\s+(asc|desc))?$/i);
-            return { key: m[1].trim().replace(/^["'`]|["'`]$/g, ''), dir: (m[2] || 'desc').toLowerCase() };
+            var txt = p.text.trim(), m = txt.match(/\s(asc|desc)$/i);
+            return { key: (m ? txt.slice(0, m.index) : txt).trim().replace(/^["'`]|["'`]$/g, ''), dir: (m ? m[1] : 'desc').toLowerCase() };
           });
           break;
         case 'top': case 'limit':
@@ -445,9 +445,10 @@
       spec.select = splitTopLevel(head, function (t, i) { return t[i] === ',' ? 1 : 0; }).map(function (p) {
         var item = p.text.trim(), fmt = null, label = null;
         for (var pass = 0; pass < 2; pass++) {   // "as" and "format" may come in either order
-          var fm = fmt === null && item.match(/\s+format\s+("([^"]*)"|'([^']*)'|(\S+))\s*$/i);
+          // single \s before the keyword + trimmed item: linear time (\s+...\s*$ backtracked O(n^2) on long blanks)
+          var fm = fmt === null && item.match(/\sformat\s+("([^"]*)"|'([^']*)'|(\S+))$/i);
           if (fm) { fmt = fm[2] || fm[3] || fm[4]; item = item.slice(0, fm.index).trim(); }
-          var am = label === null && item.match(/\s+as\s+("([^"]*)"|'([^']*)'|`([^`]*)`|([\wÀ-￿]+))\s*$/i);
+          var am = label === null && item.match(/\sas\s+("([^"]*)"|'([^']*)'|`([^`]*)`|([\wÀ-￿]+))$/i);
           if (am) { label = am[2] || am[3] || am[4] || am[5]; item = item.slice(0, am.index).trim(); }
         }
         return { expr: item, as: label, format: fmt };
```

### Q9 — Computed fields: redefinition and self-reference

*kit/core/rk.data.js · tests: `Q9 …` in engine-audit.test.js*

`88a4097` already propagates `@param` changes to dependent computed fields. Two gaps remain:
1. `addComputed()` on an existing name moved the field to the **end** of the evaluation order, so dependants defined
   earlier read the old values (`b = a + 1` stays 201 after `a` is redefined).
2. `x = x * (1 + @g)` reads its own previous output, so every slider move compounds: 10 → 10.2 → 11.22 → 13.46 → 14.81 for g = 2%, 10%, 20%, 10%. The Python
   validator accepts it.

**Fix:** redefine in place, and reject self-reference ("Computed field "x" cannot reference itself — give the result a
new name"). The `dirty` set uses `Object.create(null)`, so a field named `constructor` is not always dirty. Also add the
self-reference check to `py/reportkit/validate.py`.

```diff
diff --git a/kit/core/rk.data.js b/kit/core/rk.data.js
index 7936cd4..d1e9bb7 100644
--- a/kit/core/rk.data.js
+++ b/kit/core/rk.data.js
@@ -87,11 +87,15 @@
   Dataset.prototype.addComputed = function (spec, silent) {
     var c = RK.expr.compile(spec.formula, { fields: this.fields });
     if (c.aggregate) throw new RK.expr.ExprError('Computed fields must be row formulas (no sum/avg/...)');
+    // x = x * (1 + @g) would compound on every slider move: each recompute reads its own previous output
+    if (c.fields.indexOf(spec.name) >= 0) throw new RK.expr.ExprError('Computed field "' + spec.name + '" cannot reference itself — give the result a new name');
     var def = { name: spec.name, title: spec.title || spec.name, type: spec.type || 'number', format: spec.format, formula: spec.formula, computed: true };
     var existing = this._index[def.name];
     if (existing) util.merge(existing, def); else { this.fields.push(def); this._index[def.name] = def; }
-    this.computed = this.computed.filter(function (x) { return x.def.name !== def.name; });
-    this.computed.push({ def: def, compiled: c });
+    // redefinition keeps its place, so fields defined after it (that may depend on it) still run after it
+    var entry = { def: def, compiled: c }, at = -1;
+    this.computed.forEach(function (x, i) { if (x.def.name === def.name) at = i; });
+    if (at >= 0) this.computed[at] = entry; else this.computed.push(entry);
     this._materialize(def.name);
     if (!silent) RK.bus.emit('data:changed', { dataset: this.id, field: def.name });
     return def;
@@ -108,7 +112,7 @@
   Dataset.prototype._materialize = function (onlyName, paramName) {
     var env = { params: RK.store.params() };
     var rows = this.rows;
-    var dirty = {};   // computed fields recomputed in this pass: dependants are recomputed too (definition order)
+    var dirty = Object.create(null);   // computed fields recomputed in this pass: dependants are recomputed too (definition order)
     this.computed.forEach(function (c) {
       if (onlyName && c.def.name !== onlyName && !c.compiled.fields.some(function (f) { return dirty[f]; })) return;
       if (paramName && c.compiled.params.indexOf(paramName) < 0 && !c.compiled.fields.some(function (f) { return dirty[f]; })) return;
```

### Q10 — `not_in` case sensitivity

*kit/core/rk.data.js · tests: `Q10 …` in engine-audit.test.js*

`in` lower-cases both sides; `not_in` used a raw `Set`. `{op: 'not_in', values: ['europe']}` therefore excludes nothing.
**Fix:** mirror `in`.

```diff
diff --git a/kit/core/rk.data.js b/kit/core/rk.data.js
index d1e9bb7..c7f2925 100644
--- a/kit/core/rk.data.js
+++ b/kit/core/rk.data.js
@@ -270,9 +270,9 @@
         var set = new Set(spec.values.map(function (v) { return typeof v === 'string' ? v.toLowerCase() : v; }));
         return function (r) { var v = r[f]; return set.has(typeof v === 'string' ? v.toLowerCase() : v); };
       }
-      case 'not_in': {
-        var nset = new Set(spec.values);
-        return function (r) { return !nset.has(r[f]); };
+      case 'not_in': {   // case-insensitive, like 'in' and RK.expr ==
+        var nset = new Set((spec.values || []).map(function (v) { return typeof v === 'string' ? v.toLowerCase() : v; }));
+        return function (r) { var v = r[f]; return !nset.has(typeof v === 'string' ? v.toLowerCase() : v); };
       }
       case 'eq': return function (r) { return r[f] === spec.value; };
       case 'between': return function (r) {
```

### Q11 — `expr` filters ignore the schema

*kit/core/rk.data.js · tests: `Q11 …` in engine-audit.test.js*

`setFilter({op: 'expr'})` compiled once without fields, and `filterApplies` required the literal names to exist. A
filter written with a title (`[Enterprise value] > 10000`) or a case variant (`EV_EBITDA_25E > 12`) was **silently not
applied** to any dataset; the console shows all rows. **Fix:** compile per dataset with its fields. Plain name lookups
are unchanged, and the cost is one compile per dataset per view.

```diff
diff --git a/kit/core/rk.data.js b/kit/core/rk.data.js
index c7f2925..2ac5d4b 100644
--- a/kit/core/rk.data.js
+++ b/kit/core/rk.data.js
@@ -254,11 +254,15 @@
     return a - b;
   }
 
+  /** expr filters compile against each dataset's schema, so titles ([Enterprise value]), `names with spaces`
+   *  and case-insensitive names resolve; null when the formula does not fit this dataset. */
+  function exprFor(spec, ds) {
+    try { return RK.expr.compile(spec.expr, { fields: ds.fields }); } catch (e) { return null; }
+  }
+
   function filterApplies(spec, ds) {
     if (spec.datasets && spec.datasets.indexOf(ds.id) < 0) return false;
-    if (spec.op === 'expr') {
-      return spec._compiled && spec._compiled.fields.every(function (f) { return ds.has(f); });
-    }
+    if (spec.op === 'expr') return !!(spec._compiled && exprFor(spec, ds));
     if (spec.op === 'search') return !spec.field || ds.has(spec.field);
     return ds.has(spec.field);
   }
@@ -291,7 +295,7 @@
         };
       }
       case 'expr': {
-        var c = spec._compiled, env = { params: store.params() };
+        var c = exprFor(spec, ds), env = { params: store.params() };
         return function (r) { try { return !!c.eval(r, env); } catch (e) { return false; } };
       }
     }
```

### Q12 — `RK.data.aggregate` with field names containing blanks

*kit/core/rk.data.js · tests: `Q12 …` in engine-audit.test.js*

`{op: 'sum', field: 'Market cap'}` built the formula `sum(Market cap)`, which gives `Expected ")"`. `{op: 'count'}`
without a field built `count(undefined)`. **Fix:** wrap the field in backticks; omit it when absent. The default
measure names are unchanged (`sum(Market cap)`).

```diff
diff --git a/kit/core/rk.data.js b/kit/core/rk.data.js
index 2ac5d4b..d636af9 100644
--- a/kit/core/rk.data.js
+++ b/kit/core/rk.data.js
@@ -359,8 +359,9 @@
   function aggregate(rows, spec) {
     var by = spec.by || [];
     var measures = (spec.measures || []).map(function (m) {
-      var src = m.expr || (m.op ? m.op + '(' + m.field + ')' : m.field);
-      return { name: m.name || src, c: RK.expr.compile(src, { fields: spec.fields }) };
+      var ref = m.field == null ? '' : '`' + m.field + '`';            // field names may contain spaces
+      var src = m.expr || (m.op ? m.op + '(' + ref + ')' : ref);
+      return { name: m.name || m.expr || (m.op ? m.op + '(' + (m.field == null ? '' : m.field) + ')' : m.field), c: RK.expr.compile(src, { fields: spec.fields }) };
     });
     var env = { params: store.params() };
     var groups = by.length ? util.groupBy(rows, function (r) { return by.map(function (b) { return r[b]; }).join('\u0001'); }) : new Map([['', rows]]);
```

### Q13 — Field named `__proto__` (hardening)

*kit/core/rk.data.js · tests: `Q13 …` in engine-audit.test.js*

`rec[name] = v` with `name === "__proto__"` sets the record's **prototype** instead of a property, so the value
disappears from query output and from computed rows (`rows[i]['__proto__'] = 2` does nothing). Nothing leaks globally;
this is tested. **Fix:** a `put()` helper that uses `defineProperty` for that one key, used for every record write in
`rk.data.js`.

```diff
diff --git a/kit/core/rk.data.js b/kit/core/rk.data.js
index d636af9..758fe3e 100644
--- a/kit/core/rk.data.js
+++ b/kit/core/rk.data.js
@@ -25,6 +25,12 @@
   var RK = global.RK || (global.RK = {});
   var util = RK.util;
 
+  /** obj[key] = v that also works for a field literally named "__proto__" (assignment would swap the prototype and drop the value). */
+  function put(obj, key, v) {
+    if (key === '__proto__') Object.defineProperty(obj, key, { value: v, writable: true, enumerable: true, configurable: true });
+    else obj[key] = v;
+  }
+
   /* ------------------------------------------------------------------ *
    * Dataset
    * ------------------------------------------------------------------ */
@@ -51,7 +57,7 @@
     if (data.length && Array.isArray(data[0]) && fields) {
       data = data.map(function (arr) {
         var o = {};
-        for (var i = 0; i < fields.length; i++) o[fields[i].name] = arr[i];
+        for (var i = 0; i < fields.length; i++) put(o, fields[i].name, arr[i]);
         return o;
       });
     }
@@ -120,7 +126,7 @@
       for (var i = 0; i < rows.length; i++) {
         var v;
         try { v = c.compiled.eval(rows[i], env); } catch (e) { v = null; }
-        rows[i][c.def.name] = v;
+        put(rows[i], c.def.name, v);
       }
     });
   };
@@ -368,8 +374,8 @@
     var out = [];
     groups.forEach(function (g) {
       var rec = {};
-      by.forEach(function (b) { rec[b] = g[0][b]; });
-      measures.forEach(function (m) { rec[m.name] = m.c.aggregate ? m.c.eval(g, env) : m.c.eval(g[0], env); });
+      by.forEach(function (b) { put(rec, b, g[0][b]); });
+      measures.forEach(function (m) { put(rec, m.name, m.c.aggregate ? m.c.eval(g, env) : m.c.eval(g[0], env)); });
       out.push(rec);
     });
     return out;
@@ -535,15 +541,15 @@
       outRows = [];
       groups.forEach(function (g) {
         var rec = {};
-        keyCols.forEach(function (b) { rec[b] = g[0][b]; });
-        cols.forEach(function (c) { rec[c.name] = c.compiled.aggregate ? c.compiled.eval(g, env) : c.compiled.eval(g[0], env); });
+        keyCols.forEach(function (b) { put(rec, b, g[0][b]); });
+        cols.forEach(function (c) { put(rec, c.name, c.compiled.aggregate ? c.compiled.eval(g, env) : c.compiled.eval(g[0], env)); });
         outRows.push(rec);
       });
       cols = keyCols.map(function (b) { var f = ds.field(b); return { name: b, title: f.title, format: f.format, type: f.type }; }).concat(cols);
     } else {
       outRows = rows.map(function (r) {
         var rec = {};
-        cols.forEach(function (c) { rec[c.name] = c.compiled.eval(r, env); });
+        cols.forEach(function (c) { put(rec, c.name, c.compiled.eval(r, env)); });
         return rec;
       });
     }
```

### Q14 — Expression column types

*kit/core/rk.data.js · tests: `Q14 …` in engine-audit.test.js*

Every non-field column was typed `number`, including `if(…, "Net cash", "Net debt")`, `text(…)`, `first(company)` and
`min(date)`. Table components that align or sort by `type` treat text as numbers. **Fix:** type expression columns
from their first non-null value, using the existing `inferType`.

```diff
diff --git a/kit/core/rk.data.js b/kit/core/rk.data.js
index 758fe3e..91e7a1a 100644
--- a/kit/core/rk.data.js
+++ b/kit/core/rk.data.js
@@ -530,7 +530,7 @@
         title: it.as || (single ? single.title : it.expr),
         format: it.format || guessFormat(c, ds),
         compiled: c,
-        type: single ? single.type : 'number'
+        type: single ? single.type : null      // expressions: typed from their values below
       };
     });
     var isAgg = by.length > 0 || cols.some(function (c) { return c.compiled.aggregate; });
@@ -553,6 +553,15 @@
         return rec;
       });
     }
+    // if(..., "Net cash", "Net debt") is text, min(date) a date: type expression columns by their first value
+    cols.forEach(function (c) {
+      if (c.type) return;
+      c.type = 'number';
+      for (var i = 0; i < outRows.length; i++) {
+        var v = outRows[i][c.name];
+        if (v != null && v !== '') { c.type = inferType([outRows[i]], c.name); break; }
+      }
+    });
     (spec.sort || []).slice().reverse().forEach(function (s) {
       var col = null;
       if (/^\d+$/.test(s.key)) col = cols[parseInt(s.key, 10) - 1];
```


---

## Resolution

*2026-10-14 · merged into `kit/core/rk.expr.js`, `rk.format.js` and `rk.data.js`. All 36 findings are **fixed**; none
is "won't fix". Every patch above was applied on top of `88a4097`, including its allowEmpty filters,
setValues/toggleValue `extra`, removal carrying `prev`, the chained-computed `dirty` set, query `exclude`/`ignore` and
`RK.data.applies`. Where the merged code differs from the proposed diff, the difference is noted below. The diffs above
are kept as the audit record. They no longer apply to the current tree.*

| Suite | Before | After |
|---|---|---|
| `node tests/js/core.test.js` | 57/57 | **67/67** (+10 headline checks for F1, F2, E4, E1, E10, E7, Q1, Q4, Q5, Q9) |
| `node tests/js/engine.test.js` | 378/378 | **542/542** (378 + the 128 audit tests moved in + 36 new ID-tagged tests) |
| `node tests/js/engine-audit.test.js` | 0/128 | **164/164**, and all 36 finding IDs are covered. It is now a regression runner: it runs the ID-tagged tests of `engine.test.js` and fails if a finding has none |
| `node tests/js/formula-doc.test.js` | 138/138 | **165/165** (8 formulas, 13 format codes and 6 error messages added to the doc) |
| `node tools/smoke.cjs --all` | 52/52 | **53/53**: the original 52 plus china-tilemap, which was added while this was merged |

| ID | Status | Notes on the merged fix |
|---|---|---|
| F1 | fixed | Rewritten rather than taken from the patch. The patch multiplied first (`(v * 10^d).toPrecision(15)`). The merged code takes the value's 15-significant-digit decimal string (`toPrecision(15)`, an exact conversion of the binary value) and rounds half away from zero on that digit string. `%` and trailing-comma scaling move the decimal point in the string and never multiply. Any number of decimals works, so there is no 0–20 clamp. `RK.format.round(x, d)` (Excel ROUND) and `RK.format.fixed(v, d)` (an Excel-rounded `toFixed`) are exported, so components can stop using `toFixed`; 31 `toFixed` calls remain in components and `rk.geo.js`, which this change does not own. A differential fuzz against a BigInt reference found 0 mismatches in 400,000 cases. 40 of 9,642 sample-dataset cells, each rendered with its field's format, change (all .x5 ties). |
| Q4 | fixed | Generalised from the patch into recursive inference. Same-unit functions inherit the format of their first argument at any depth (`round(avg(x), 1)`). `-x`, `x - y` / `x + y` with equal formats, `if()` / `?:` with agreeing branches and `sum(if(c, x, 0))` keep `x`'s format; number literals and `null` count as neutral. `RESULT_FORMAT` is as in the patch. Ratios, products and other functions get General. The compiler now records each field node's schema name (`node.resolved`), so titles and case variants resolve. |
| E1 | fixed | As proposed, but text ordering uses one shared `Intl.Collator({sensitivity: 'accent'})`. `localeCompare(b, undefined, opts)` builds a collator per call and was 80x slower on a 250k-row filter. |
| E2 | fixed | As proposed. |
| E3 | fixed | As proposed. |
| E4 | fixed | `round()` calls `RK.format.round`, the decimal-string rounding of F1, so a rounded value and its display always agree. The patch's `toPrecision` version remains as a fallback when `rk.format.js` is not loaded. `d` is clamped to ±400. |
| E5 | fixed | As proposed. |
| E6 | fixed | As proposed. The scalar `min(a, b, …)` / `max(a, b, …)` also loop instead of using `Math.min.apply`, which hit the argument limit at 200k arguments. |
| E7 | fixed | All lookup tables were fixed together. `KEYWORDS`, `CMP`, `SCALAR`, `LAZY`, `AGG`, `AGG_EXTRA` and `AGG_ARITY` in `rk.expr.js` are `Object.create(null)` tables read with `has()`. So are `presets` in `rk.format.js` and the store's `filters` / `params` / `state` plus every internal table in `rk.data.js`. Field reads (`has(row, name)`) and param reads are own-property only. `RK.expr.agg` and `RK.format.presets` therefore no longer expose `constructor`, which also hardens components that do `RK.expr.agg[o.agg] \|\| …` and `RK.format.presets[fmt] \|\| fmt`. |
| E8 | fixed | As proposed. |
| E9 | fixed | As proposed. |
| E10 | fixed | Explicit bounds were added in front of the patch's RangeError conversion, which stays as a backstop. Parser recursion (parentheses, calls, lists, unary `-`, `not`, `^`, `?:`) is capped at 256 levels and AST depth at 1,024 (long `1+1+…` chains), giving a deterministic `ExprError` on every engine. 250 nested parentheses, 200 nested `if()` and a 1,000-term sum still compile. Three other super-linear paths were fixed: the `[` look-ahead in the tokenizer (one scan instead of one per `[`, so 1M `[` fail in under 1 s), field/param de-duplication in the compiler (`indexOf` per reference became an O(1) set) and scalar `max()` with many arguments. |
| E11 | fixed | As proposed. |
| E12 | fixed | As proposed. The formula echoed in the message is truncated to 80 characters. |
| F2 | fixed | As proposed, on the decimal path. Values below 1e-8 use an exponent (`1.23e-9`) instead of a 300-digit string. |
| F3 | fixed | Subsumed by F1: the digit-string path prints 15 significant digits followed by zeros at any magnitude. |
| F4 | fixed | As proposed. Promotion uses the ratio between units (`+s * unit >= nextUnit`), so custom units such as 万 / 亿 work, and power-of-ten units shift the decimal point exactly. |
| F5 | fixed | As proposed. |
| F6 | fixed | As proposed, plus a null-prototype `presets` table (E7). Compiled number formats called directly (`RK.format.compile(code)(NaN)`) and `RK.format.compact(NaN)` return `n.m.` instead of garbage. |
| F7 | fixed | As proposed. |
| F8 | fixed | As proposed, with one deliberate difference. A value that rounds to zero under an empty zero section (`#,##0;(#,##0);`, `-0.4`) is blank like an exact zero; the patch printed "0". Documented in docs §12. |
| F9 | fixed | As proposed. `[...]` tags are also ignored when deciding whether a bare code is a date. |
| F10 | fixed | As proposed. |
| Q1 | fixed | The clause finder is a sticky regex (`/(group\s+by\|order\s+by\|sort\s+by\|from\|by\|where\|sort\|top\|limit)(?=\s\|$)/iy`), so `sort  by`, `sort⏎by` and `group   by` with any blanks also work. Before, they hit the same trap. |
| Q2 | fixed | As proposed. |
| Q3 | fixed | As proposed. |
| Q5 | fixed | As proposed. In the spec-object API a non-positive `limit` means no limit; it used to drop rows from the end. |
| Q6 | fixed | As proposed. |
| Q7 | fixed | As proposed. |
| Q8 | fixed | As proposed. |
| Q9 | fixed | Merged with `88a4097`'s `dirty` propagation. Dependants recompute in definition order: a redefinition keeps its slot, and the `dirty` set is null-prototype and read with `has()`. Self-reference is rejected with an `ExprError` in `addComputed`, including through a title (`[My metric]`). Beyond the patch, a redefinition may read a computed field defined *after* it, in which case it is evaluated after that field (stable dependency order), and a loop (`a -> b -> a`) is rejected before any state changes. **Follow-up, not done here:** porting the check to `py/reportkit/validate.py`, which is outside the files this change owns. The Python validator already rejects `x = x * …` for a *new* name, because a field's own name is not yet available when its formula is checked. Only re-using an existing field name (`ev = ev * 1.1`) passes the build and then fails at load. |
| Q10 | fixed | As proposed. |
| Q11 | fixed | As proposed, with compilation memoised per (filter spec, dataset, schema revision) in a `WeakMap`. `Dataset._rev` is bumped by `addComputed` / `removeComputed`, so an `expr` filter starts to apply once the dataset gains the field it needs. |
| Q12 | fixed | As proposed. |
| Q13 | fixed | As proposed. `put()` is used for every record write, `get()` for every record read by field name (filters, group keys, `values()`, `toCSV()`, `inferType()`). Params named `__proto__` are stored as data. |
| Q14 | fixed | As proposed. |

Observations without a patch:
- The unbounded `RK.expr.compile` cache is now **fixed**: it is an LRU of 500 entries.
- The Excel differences (`-2^2`, `2^3^2`), two-valued null logic, first-row values in grouped queries, group-key collisions,
  `sort` defaulting to desc, escapes, the `[2025 Sales]` heuristic, minor numeric coercions and the `between` / `eq`
  filter ops are **unchanged**. They are design decisions documented in `docs/formula-language.md`.

Performance (V8, 250k rows or values, before → after): numeric filters are unchanged (13–21 ms). Text comparison is
unchanged with the shared collator (63 → 65 ms). The data layer is unchanged (computed recompute 30 → 29 ms; `in` +
`expr` filters 21 → 22 ms; group-by 167 → 229 ms; sorted query 228 → 188 ms, all within run-to-run noise). One
`RK.format` call costs about 0.6–1.1 µs instead of 0.3–0.5 µs, because the digit-string rounding is the price of
Excel-exact output.

Visible changes: a back-to-back render of baseline and new core shows 9 components whose output changes. Each change
is a one-digit .x5 tie, e.g. comps-table Corvane growth 7.0% → 7.1%, pivot-table 433 → 434 and calendar-heatmap
-3.1% → -3.2%. The 9 are bullet, calendar-heatmap, comps-table, data-grid, diverging-bar, heatmap, league-table,
pivot-table and sensitivity-table. Re-shoot the gallery screenshots (step 5 of "How to apply"). `docs/formula-language.md`
§15 "Known issues" is now empty, and the changed behaviour is documented in §2, §6–§10 and §12–§14.
