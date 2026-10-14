/*!
 * ReportKit expr — a small, safe formula language for derived metrics and client queries.
 * No eval / new Function: source is tokenised, parsed (Pratt) and compiled into closures.
 *
 *   ev / ebitda_25e                     row formula
 *   (revenue_26e / revenue_25e) - 1     growth
 *   if(net_debt < 0, "Net cash", "Net debt")
 *   region in ["Asia", "Europe"] and mkt_cap > 1000
 *   ebitda_margin > 20%                 percent literal = 0.20
 *   `EV / EBITDA 2025E` * 1.1           backticks (or [brackets]) quote names / titles with spaces
 *   fcf / (@wacc - @g)                  @name = report parameter (what-if sliders)
 *   sum(ev) / sum(ebitda_25e)           aggregate formula (used per group)
 *   median(ev_ebitda_25e)
 *
 * String equality is case-insensitive. Division by zero -> NaN (formatted "n.m."),
 * null propagates (formatted "n.a.").
 */
(function (global) {
  'use strict';
  var RK = global.RK || (global.RK = {});

  function ExprError(message, pos) {
    this.name = 'ExprError';
    this.message = message;
    this.pos = pos == null ? -1 : pos;
  }
  ExprError.prototype = Object.create(Error.prototype);

  /* ------------------------------------------------------------------ *
   * Tokeniser
   * ------------------------------------------------------------------ */
  var IDENT_START = /[A-Za-z_À-￿]/;
  var IDENT_PART = /[A-Za-z0-9_À-￿]/;
  var OPS = ['==', '!=', '<>', '<=', '>=', '&&', '||', '+', '-', '*', '/', '^', '<', '>', '=', '!', '(', ')', ',', '?', ':', '[', ']'];
  var KEYWORDS = { and: 1, or: 1, not: 1, in: 1, true: 1, false: 1, null: 1 };

  function tokenize(src) {
    var toks = [], i = 0, n = src.length;
    while (i < n) {
      var c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      var start = i;
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        var m = src.slice(i).match(/^(\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
        var num = parseFloat(m[0]);
        i += m[0].length;
        if (src[i] === '%') { num /= 100; i++; }
        toks.push({ t: 'num', v: num, pos: start });
        continue;
      }
      if (c === '"' || c === "'") {
        var q = c, s = '';
        i++;
        while (i < n && src[i] !== q) {
          if (src[i] === '\\' && i + 1 < n) { s += src[i + 1]; i += 2; continue; }
          s += src[i++];
        }
        if (i >= n) throw new ExprError('Unterminated string', start);
        i++;
        toks.push({ t: 'str', v: s, pos: start });
        continue;
      }
      if (c === '`') {
        var j = src.indexOf('`', i + 1);
        if (j < 0) throw new ExprError('Unterminated `name`', start);
        toks.push({ t: 'id', v: src.slice(i + 1, j), quoted: true, pos: start });
        i = j + 1;
        continue;
      }
      if (c === '@') {
        var pm = src.slice(i + 1).match(/^[A-Za-z_][\w]*/);
        if (!pm) throw new ExprError('Expected parameter name after @', start);
        toks.push({ t: 'param', v: pm[0], pos: start });
        i += 1 + pm[0].length;
        continue;
      }
      if (IDENT_START.test(c)) {
        var id = '';
        while (i < n && IDENT_PART.test(src[i])) id += src[i++];
        var low = id.toLowerCase();
        if (KEYWORDS[low]) toks.push({ t: 'kw', v: low, pos: start });
        else toks.push({ t: 'id', v: id, pos: start });
        continue;
      }
      // [bracketed name] is only a name when the previous token cannot end an operand (else it is a list)
      if (c === '[') {
        var prev = toks[toks.length - 1];
        var prevIsOperand = prev && (prev.t === 'num' || prev.t === 'str' || prev.t === 'id' || prev.t === 'param' || (prev.t === 'op' && (prev.v === ')' || prev.v === ']')));
        var close = src.indexOf(']', i + 1);
        var inner = close > 0 ? src.slice(i + 1, close) : '';
        if (!prevIsOperand && close > 0 && !(prev && prev.t === 'kw' && prev.v === 'in') && /^[^\[\],"']+$/.test(inner) && /[A-Za-zÀ-￿]/.test(inner) && !/^\s*-?\d/.test(inner)) {
          toks.push({ t: 'id', v: inner.trim(), quoted: true, pos: start });
          i = close + 1;
          continue;
        }
      }
      var op = null;
      for (var k = 0; k < OPS.length; k++) {
        if (src.substr(i, OPS[k].length) === OPS[k]) { op = OPS[k]; break; }
      }
      if (!op) throw new ExprError('Unexpected character "' + c + '"', start);
      toks.push({ t: 'op', v: op, pos: start });
      i += op.length;
    }
    toks.push({ t: 'eof', pos: n });
    return toks;
  }

  /* ------------------------------------------------------------------ *
   * Parser (precedence climbing)
   * ------------------------------------------------------------------ */
  function Parser(toks) { this.toks = toks; this.i = 0; }
  Parser.prototype.peek = function () { return this.toks[this.i]; };
  Parser.prototype.next = function () { return this.toks[this.i++]; };
  Parser.prototype.isOp = function (v) { var t = this.peek(); return t.t === 'op' && t.v === v; };
  Parser.prototype.isKw = function (v) { var t = this.peek(); return t.t === 'kw' && t.v === v; };
  Parser.prototype.expectOp = function (v) {
    var t = this.next();
    if (t.t !== 'op' || t.v !== v) throw new ExprError('Expected "' + v + '"', t.pos);
    return t;
  };

  Parser.prototype.parse = function () {
    var e = this.ternary();
    var t = this.peek();
    if (t.t !== 'eof') throw new ExprError('Unexpected "' + (t.v != null ? t.v : t.t) + '"', t.pos);
    return e;
  };
  Parser.prototype.ternary = function () {
    var c = this.or();
    if (this.isOp('?')) {
      this.next();
      var a = this.ternary();
      this.expectOp(':');
      var b = this.ternary();
      return { type: 'cond', c: c, a: a, b: b };
    }
    return c;
  };
  Parser.prototype.or = function () {
    var a = this.and();
    while (this.isKw('or') || this.isOp('||')) { this.next(); a = { type: 'bin', op: 'or', a: a, b: this.and() }; }
    return a;
  };
  Parser.prototype.and = function () {
    var a = this.not();
    while (this.isKw('and') || this.isOp('&&')) { this.next(); a = { type: 'bin', op: 'and', a: a, b: this.not() }; }
    return a;
  };
  Parser.prototype.not = function () {
    if (this.isKw('not') || this.isOp('!')) { this.next(); return { type: 'un', op: 'not', a: this.not() }; }
    return this.cmp();
  };
  var CMP = { '==': '==', '=': '==', '!=': '!=', '<>': '!=', '<': '<', '<=': '<=', '>': '>', '>=': '>=' };
  Parser.prototype.cmp = function () {
    var a = this.add();
    var t = this.peek();
    if (t.t === 'op' && CMP[t.v]) { this.next(); return { type: 'bin', op: CMP[t.v], a: a, b: this.add() }; }
    if (t.t === 'kw' && t.v === 'in') {
      this.next();
      var list;
      if (this.isOp('(')) { this.next(); list = this.list(')'); }
      else if (this.isOp('[')) { this.next(); list = this.list(']'); }
      else list = this.add();
      return { type: 'bin', op: 'in', a: a, b: list };
    }
    if (t.t === 'kw' && t.v === 'not' && this.toks[this.i + 1] && this.toks[this.i + 1].v === 'in') {
      this.next(); this.next();
      var l2;
      if (this.isOp('(')) { this.next(); l2 = this.list(')'); }
      else if (this.isOp('[')) { this.next(); l2 = this.list(']'); }
      else l2 = this.add();
      return { type: 'un', op: 'not', a: { type: 'bin', op: 'in', a: a, b: l2 } };
    }
    return a;
  };
  Parser.prototype.list = function (close) {
    var items = [];
    if (!this.isOp(close)) {
      do { items.push(this.ternary()); } while (this.isOp(',') && this.next());
    }
    this.expectOp(close);
    return { type: 'list', items: items };
  };
  Parser.prototype.add = function () {
    var a = this.mul();
    while (this.isOp('+') || this.isOp('-')) { var op = this.next().v; a = { type: 'bin', op: op, a: a, b: this.mul() }; }
    return a;
  };
  Parser.prototype.mul = function () {
    var a = this.unary();
    while (this.isOp('*') || this.isOp('/')) { var op = this.next().v; a = { type: 'bin', op: op, a: a, b: this.unary() }; }
    return a;
  };
  Parser.prototype.unary = function () {
    if (this.isOp('-')) { this.next(); return { type: 'un', op: 'neg', a: this.unary() }; }
    if (this.isOp('+')) { this.next(); return this.unary(); }
    return this.pow();
  };
  Parser.prototype.pow = function () {
    var a = this.primary();
    if (this.isOp('^')) { this.next(); return { type: 'bin', op: '^', a: a, b: this.unary() }; }
    return a;
  };
  Parser.prototype.primary = function () {
    var t = this.next();
    switch (t.t) {
      case 'num': return { type: 'lit', v: t.v };
      case 'str': return { type: 'lit', v: t.v };
      case 'param': return { type: 'param', name: t.v, pos: t.pos };
      case 'kw':
        if (t.v === 'true') return { type: 'lit', v: true };
        if (t.v === 'false') return { type: 'lit', v: false };
        if (t.v === 'null') return { type: 'lit', v: null };
        throw new ExprError('Unexpected keyword "' + t.v + '"', t.pos);
      case 'id':
        if (!t.quoted && this.isOp('(')) {
          this.next();
          var args = [];
          if (!this.isOp(')')) {
            do { args.push(this.ternary()); } while (this.isOp(',') && this.next());
          }
          this.expectOp(')');
          return { type: 'call', name: t.v.toLowerCase(), args: args, pos: t.pos };
        }
        return { type: 'field', name: t.v, pos: t.pos, quoted: !!t.quoted };
      case 'op':
        if (t.v === '(') { var e = this.ternary(); this.expectOp(')'); return e; }
        if (t.v === '[') return this.list(']');
        throw new ExprError('Unexpected "' + t.v + '"', t.pos);
      default:
        throw new ExprError('Unexpected end of formula', t.pos);
    }
  };

  /* ------------------------------------------------------------------ *
   * Runtime helpers
   * ------------------------------------------------------------------ */
  function isNull(v) { return v === null || v === undefined || v === ''; }
  function num(v) {
    if (isNull(v)) return null;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }
  function eq(a, b) {
    if (isNull(a) || isNull(b)) return isNull(a) && isNull(b);
    if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
    return a == b; // eslint-disable-line eqeqeq
  }
  function cmp(a, b) {
    if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
    return num(a) - num(b);
  }
  function arith(op, a, b) {
    if (op === '+' && (typeof a === 'string' || typeof b === 'string')) return String(isNull(a) ? '' : a) + String(isNull(b) ? '' : b);
    a = num(a); b = num(b);
    if (a === null || b === null) return null;
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return b === 0 ? NaN : a / b;
      case '^': return Math.pow(a, b);
    }
  }
  function numbers(vals) {
    var out = [];
    for (var i = 0; i < vals.length; i++) { var v = num(vals[i]); if (v !== null && !isNaN(v)) out.push(v); }
    return out;
  }
  function quantile(sorted, p) {
    if (!sorted.length) return null;
    var idx = (sorted.length - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }
  function toDate(v) { return RK.format && RK.format.toDate ? RK.format.toDate(v) : new Date(v); }

  var SCALAR = {
    abs: function (x) { x = num(x); return x === null ? null : Math.abs(x); },
    round: function (x, d) { x = num(x); if (x === null) return null; var f = Math.pow(10, num(d) || 0); return Math.round(x * f) / f; },
    floor: function (x) { x = num(x); return x === null ? null : Math.floor(x); },
    ceil: function (x) { x = num(x); return x === null ? null : Math.ceil(x); },
    sqrt: function (x) { x = num(x); return x === null ? null : (x < 0 ? NaN : Math.sqrt(x)); },
    pow: function (x, y) { return arith('^', x, y); },
    exp: function (x) { x = num(x); return x === null ? null : Math.exp(x); },
    ln: function (x) { x = num(x); return x === null ? null : (x <= 0 ? NaN : Math.log(x)); },
    log: function (x, b) { x = num(x); if (x === null) return null; if (x <= 0) return NaN; return b == null ? Math.log10(x) : Math.log(x) / Math.log(num(b)); },
    log10: function (x) { x = num(x); return x === null ? null : (x <= 0 ? NaN : Math.log10(x)); },
    sign: function (x) { x = num(x); return x === null ? null : Math.sign(x); },
    clamp: function (x, lo, hi) { x = num(x); return x === null ? null : Math.max(num(lo), Math.min(num(hi), x)); },
    div: function (a, b) { a = num(a); b = num(b); return a === null || b === null || b === 0 ? null : a / b; },
    pct_change: function (a, b) { a = num(a); b = num(b); return a === null || b === null ? null : (b === 0 ? NaN : a / b - 1); },
    cagr: function (end, start, years) {
      end = num(end); start = num(start); years = num(years);
      if (end === null || start === null || !years) return null;
      if (start <= 0 || end < 0) return NaN;
      return Math.pow(end / start, 1 / years) - 1;
    },
    coalesce: function () { for (var i = 0; i < arguments.length; i++) if (!isNull(arguments[i]) && !(typeof arguments[i] === 'number' && isNaN(arguments[i]))) return arguments[i]; return null; },
    isnull: function (x) { return isNull(x) || (typeof x === 'number' && isNaN(x)); },
    between: function (x, lo, hi) { x = num(x); return x !== null && x >= num(lo) && x <= num(hi); },
    number: function (x) { return num(x); },
    text: function (x, f) { return f != null && RK.format ? RK.format(x, f) : (isNull(x) ? '' : String(x)); },
    len: function (s) { return isNull(s) ? 0 : String(s).length; },
    lower: function (s) { return isNull(s) ? s : String(s).toLowerCase(); },
    upper: function (s) { return isNull(s) ? s : String(s).toUpperCase(); },
    concat: function () { return [].slice.call(arguments).map(function (v) { return isNull(v) ? '' : String(v); }).join(''); },
    contains: function (s, sub) { return !isNull(s) && String(s).toLowerCase().indexOf(String(sub).toLowerCase()) >= 0; },
    startswith: function (s, p) { return !isNull(s) && String(s).toLowerCase().indexOf(String(p).toLowerCase()) === 0; },
    endswith: function (s, p) { if (isNull(s)) return false; s = String(s).toLowerCase(); p = String(p).toLowerCase(); return s.slice(-p.length) === p; },
    year: function (d) { d = toDate(d); return d ? d.getFullYear() : null; },
    month: function (d) { d = toDate(d); return d ? d.getMonth() + 1 : null; },
    quarter: function (d) { d = toDate(d); return d ? Math.floor(d.getMonth() / 3) + 1 : null; }
  };
  var LAZY = { if: true, iif: true };

  var AGG = {
    sum: function (v) { var a = numbers(v); return a.length ? a.reduce(function (s, x) { return s + x; }, 0) : null; },
    avg: function (v) { var a = numbers(v); return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : null; },
    median: function (v) { var a = numbers(v).sort(function (x, y) { return x - y; }); return quantile(a, 0.5); },
    min: function (v) { var a = numbers(v); return a.length ? Math.min.apply(null, a) : null; },
    max: function (v) { var a = numbers(v); return a.length ? Math.max.apply(null, a) : null; },
    count: function (v) { var c = 0; for (var i = 0; i < v.length; i++) if (!isNull(v[i])) c++; return c; },
    countd: function (v) { var s = new Set(); for (var i = 0; i < v.length; i++) if (!isNull(v[i])) s.add(v[i]); return s.size; },
    stdev: function (v) {
      var a = numbers(v); if (a.length < 2) return null;
      var m = a.reduce(function (s, x) { return s + x; }, 0) / a.length;
      return Math.sqrt(a.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / (a.length - 1));
    },
    first: function (v) { for (var i = 0; i < v.length; i++) if (!isNull(v[i])) return v[i]; return null; },
    last: function (v) { for (var i = v.length - 1; i >= 0; i--) if (!isNull(v[i])) return v[i]; return null; }
  };
  AGG.mean = AGG.avg;
  AGG.average = AGG.avg;
  AGG.stddev = AGG.stdev;
  // aggregates with extra arguments
  var AGG_EXTRA = {
    pctl: function (vals, p) { var a = numbers(vals).sort(function (x, y) { return x - y; }); return quantile(a, num(p)); },
    wavg: function (vals, weights) {
      var s = 0, w = 0;
      for (var i = 0; i < vals.length; i++) {
        var x = num(vals[i]), y = num(weights[i]);
        if (x === null || y === null || isNaN(x)) continue;
        s += x * y; w += y;
      }
      return w ? s / w : null;
    }
  };
  AGG_EXTRA.percentile = AGG_EXTRA.pctl;

  function isAggCall(node) {
    if (node.type !== 'call') return false;
    if (AGG_EXTRA[node.name]) return true;
    if (!AGG[node.name]) return false;
    // min/max with 2+ args are scalar
    if ((node.name === 'min' || node.name === 'max') && node.args.length > 1) return false;
    return true;
  }
  function containsAgg(node) {
    if (!node || typeof node !== 'object') return false;
    if (isAggCall(node)) return true;
    var kids = [node.a, node.b, node.c].concat(node.args || [], node.items || []);
    for (var i = 0; i < kids.length; i++) if (kids[i] && containsAgg(kids[i])) return true;
    return false;
  }

  /* ------------------------------------------------------------------ *
   * Field resolution
   * ------------------------------------------------------------------ */
  function levenshtein(a, b) {
    var m = a.length, n = b.length, d = [];
    for (var i = 0; i <= m; i++) { d[i] = [i]; }
    for (var j = 0; j <= n; j++) d[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return d[m][n];
  }

  function makeResolver(fields) {
    if (!fields) return function (name) { return name; };
    var byKey = Object.create(null), names = [];
    function norm(s) { return String(s).toLowerCase().replace(/[\s_]+/g, ' ').trim(); }
    fields.forEach(function (f) {
      var name = typeof f === 'string' ? f : f.name;
      names.push(name);
      byKey[norm(name)] = name;
      if (f.title) byKey[norm(f.title)] = byKey[norm(f.title)] || name;
    });
    return function (name, pos) {
      if (Object.prototype.hasOwnProperty.call(byKey, norm(name))) return byKey[norm(name)];
      var sugg = names.map(function (n) { return [n, levenshtein(norm(name), norm(n))]; })
        .sort(function (x, y) { return x[1] - y[1]; }).slice(0, 3).map(function (x) { return x[0]; });
      throw new ExprError('Unknown field "' + name + '"' + (sugg.length ? ' — did you mean ' + sugg.join(', ') + '?' : ''), pos);
    };
  }

  /* ------------------------------------------------------------------ *
   * Compiler
   * ------------------------------------------------------------------ */
  function Compiler(opts) {
    this.resolve = makeResolver(opts.fields);
    this.fieldsUsed = [];
    this.paramsUsed = [];
  }

  Compiler.prototype.row = function (node) {
    var self = this;
    switch (node.type) {
      case 'lit': return function () { return node.v; };
      case 'field': {
        var name = this.resolve(node.name, node.pos);
        if (this.fieldsUsed.indexOf(name) < 0) this.fieldsUsed.push(name);
        return function (row) { return row ? row[name] : null; };
      }
      case 'param': {
        if (this.paramsUsed.indexOf(node.name) < 0) this.paramsUsed.push(node.name);
        return function (row, env) {
          var p = env && env.params ? env.params : (RK.store ? RK.store.params() : {});
          if (!(node.name in p)) throw new ExprError('Unknown parameter @' + node.name, node.pos);
          return p[node.name];
        };
      }
      case 'list': {
        var items = node.items.map(function (n) { return self.row(n); });
        return function (row, env) { return items.map(function (f) { return f(row, env); }); };
      }
      case 'cond': {
        var c = this.row(node.c), a = this.row(node.a), b = this.row(node.b);
        return function (row, env) { return c(row, env) ? a(row, env) : b(row, env); };
      }
      case 'un': {
        var x = this.row(node.a);
        if (node.op === 'not') return function (row, env) { return !x(row, env); };
        return function (row, env) { var v = num(x(row, env)); return v === null ? null : -v; };
      }
      case 'bin': return this.bin(node, this.row(node.a), this.row(node.b));
      case 'call': {
        if (isAggCall(node)) throw new ExprError(node.name + '() is an aggregate — use it in a grouped query or summary metric', node.pos);
        return this.scalarCall(node, node.args.map(function (n) { return self.row(n); }));
      }
    }
    throw new ExprError('Unsupported expression');
  };

  Compiler.prototype.bin = function (node, a, b) {
    switch (node.op) {
      case 'and': return function (r, e) { return !!a(r, e) && !!b(r, e); };
      case 'or': return function (r, e) { return !!a(r, e) || !!b(r, e); };
      case '==': return function (r, e) { return eq(a(r, e), b(r, e)); };
      case '!=': return function (r, e) { return !eq(a(r, e), b(r, e)); };
      case '<': return function (r, e) { var x = a(r, e), y = b(r, e); return !isNull(x) && !isNull(y) && cmp(x, y) < 0; };
      case '<=': return function (r, e) { var x = a(r, e), y = b(r, e); return !isNull(x) && !isNull(y) && cmp(x, y) <= 0; };
      case '>': return function (r, e) { var x = a(r, e), y = b(r, e); return !isNull(x) && !isNull(y) && cmp(x, y) > 0; };
      case '>=': return function (r, e) { var x = a(r, e), y = b(r, e); return !isNull(x) && !isNull(y) && cmp(x, y) >= 0; };
      case 'in': return function (r, e) {
        var x = a(r, e), list = b(r, e);
        if (!Array.isArray(list)) list = [list];
        for (var i = 0; i < list.length; i++) if (eq(x, list[i])) return true;
        return false;
      };
      default: return function (r, e) { return arith(node.op, a(r, e), b(r, e)); };
    }
  };

  Compiler.prototype.scalarCall = function (node, args) {
    var name = node.name;
    if (LAZY[name]) {
      if (args.length < 2) throw new ExprError('if(condition, then, else) needs at least 2 arguments', node.pos);
      return function (r, e) { return args[0](r, e) ? args[1](r, e) : (args[2] ? args[2](r, e) : null); };
    }
    if (name === 'min' || name === 'max') {
      var mm = Math[name];
      return function (r, e) {
        var vals = numbers(args.map(function (f) { return f(r, e); }));
        return vals.length ? mm.apply(null, vals) : null;
      };
    }
    var fn = SCALAR[name];
    if (!fn) throw new ExprError('Unknown function ' + name + '()', node.pos);
    return function (r, e) { return fn.apply(null, args.map(function (f) { return f(r, e); })); };
  };

  /** Aggregate context: compiled fn(rows, env). Bare fields read the first row (group keys). */
  Compiler.prototype.agg = function (node) {
    var self = this;
    if (isAggCall(node)) {
      var name = node.name;
      if (name === 'count' && node.args.length === 0) return function (rows) { return rows.length; };
      var inner = node.args.map(function (n) { return self.row(n); });
      if (AGG_EXTRA[name]) {
        var fx = AGG_EXTRA[name];
        if (name === 'wavg') {
          return function (rows, env) {
            return fx(rows.map(function (r) { return inner[0](r, env); }), rows.map(function (r) { return inner[1](r, env); }));
          };
        }
        return function (rows, env) { return fx(rows.map(function (r) { return inner[0](r, env); }), inner[1] ? inner[1](null, env) : 0.5); };
      }
      var f = AGG[name];
      return function (rows, env) { return f(rows.map(function (r) { return inner[0](r, env); })); };
    }
    if (!containsAgg(node)) {
      var rf = this.row(node);
      return function (rows, env) { return rf(rows[0], env); };
    }
    switch (node.type) {
      case 'cond': {
        var c = this.agg(node.c), a = this.agg(node.a), b = this.agg(node.b);
        return function (rows, env) { return c(rows, env) ? a(rows, env) : b(rows, env); };
      }
      case 'un': {
        var x = this.agg(node.a);
        if (node.op === 'not') return function (rows, env) { return !x(rows, env); };
        return function (rows, env) { var v = num(x(rows, env)); return v === null ? null : -v; };
      }
      case 'bin': return this.bin(node, this.agg(node.a), this.agg(node.b));
      case 'list': {
        var items = node.items.map(function (n) { return self.agg(n); });
        return function (rows, env) { return items.map(function (f) { return f(rows, env); }); };
      }
      case 'call': return this.scalarCall(node, node.args.map(function (n) { return self.agg(n); }));
    }
    throw new ExprError('Unsupported aggregate expression');
  };

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */
  var cache = new Map();

  /**
   * compile(src, {fields}) -> { src, aggregate, fields, params, eval(row|rows, env) }
   * fields: dataset schema fields (array of {name,title}) for validation & title matching.
   */
  function compile(src, opts) {
    opts = opts || {};
    var key = opts.fields ? null : src;
    if (key && cache.has(key)) return cache.get(key);
    var ast = new Parser(tokenize(String(src))).parse();
    var c = new Compiler(opts);
    var aggregate = containsAgg(ast);
    var fn = aggregate ? c.agg(ast) : c.row(ast);
    var out = { src: src, ast: ast, aggregate: aggregate, fields: c.fieldsUsed, params: c.paramsUsed, eval: fn };
    if (key) cache.set(key, out);
    return out;
  }

  function evaluate(src, rowOrRows, opts) {
    var c = compile(src, opts);
    return c.eval(rowOrRows, opts && opts.env);
  }

  /** Validate without throwing: {ok, error, pos, aggregate, fields}. */
  function check(src, opts) {
    try {
      var c = compile(src, opts);
      return { ok: true, aggregate: c.aggregate, fields: c.fields, params: c.params };
    } catch (e) {
      return { ok: false, error: e.message, pos: e.pos };
    }
  }

  RK.expr = {
    compile: compile,
    evaluate: evaluate,
    check: check,
    tokenize: tokenize,
    ExprError: ExprError,
    functions: {
      scalar: Object.keys(SCALAR).concat(['if', 'min', 'max']).sort(),
      aggregate: Object.keys(AGG).concat(Object.keys(AGG_EXTRA)).sort()
    },
    agg: AGG,
    quantile: quantile,
    num: num
  };
})(typeof window !== 'undefined' ? window : this);
