/*!
 * ReportKit format — Excel-style number/date format codes, so analysts can reuse
 * the formats they already use in their models:
 *
 *   RK.format(8.534, '0.0x')                 -> "8.5x"
 *   RK.format(-1234.5, '#,##0.0;(#,##0.0)')  -> "(1,234.5)"
 *   RK.format(0.1234, '0.0%')                -> "12.3%"
 *   RK.format(1234567, '$#,##0.0,,"m"')      -> "$1.2m"   (trailing commas scale by 1,000)
 *   RK.format(0.052, '+0.0%;-0.0%;0.0%')     -> "+5.2%"
 *   RK.format('2026-10-14', 'dd mmm yyyy')   -> "14 Oct 2026"
 *   RK.format(1.5e9, 'auto')                 -> "1.5bn"
 *   RK.format(null, '0.0x')                  -> "n.a."
 *
 * Named presets (RK.format.presets) can be used instead of codes: 'mult', 'pct1', 'usd_m', ...
 */
(function (global) {
  'use strict';
  var RK = global.RK || (global.RK = {});

  var config = {
    na: 'n.a.',        // null / undefined / ''
    nm: 'n.m.',        // NaN / Infinity (not meaningful)
    decimal: '.',
    group: ',',
    minus: '-',
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    monthsLong: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    compactUnits: [[1e12, 'tn'], [1e9, 'bn'], [1e6, 'm'], [1e3, 'k']]
  };

  var presets = {
    int: '#,##0',
    num: '#,##0.0',
    num1: '#,##0.0',
    num2: '#,##0.00',
    pct: '0%',
    pct0: '0%',
    pct1: '0.0%',
    pct2: '0.00%',
    delta_pct: '+0.0%;-0.0%;0.0%',
    delta: '+#,##0.0;-#,##0.0;0.0',
    mult: '0.0x',
    multiple: '0.0x',
    mult2: '0.00x',
    usd: '$#,##0',
    usd2: '$#,##0.00',
    usd_m: '$#,##0"m"',
    usd_bn: '$#,##0.0"bn"',
    eur_m: '€#,##0"m"',
    bps: '#,##0" bps"',
    acct: '#,##0_);(#,##0)',
    acct1: '#,##0.0_);(#,##0.0)',
    date: 'dd mmm yyyy',
    month: 'mmm yy',
    year: 'yyyy',
    auto: 'auto',
    text: '@'
  };

  var cache = Object.create(null);

  /* ---------------- section parsing ---------------- */

  function splitSections(code) {
    var out = [], cur = '', inQ = false;
    for (var i = 0; i < code.length; i++) {
      var c = code[i];
      if (c === '"') inQ = !inQ;
      if (c === '\\' && !inQ) { cur += c + (code[i + 1] || ''); i++; continue; }
      if (c === ';' && !inQ) { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    return out;
  }

  function isNumericCode(code) { return /[0#?]/.test(code.replace(/"[^"]*"/g, '').replace(/\\./g, '')); }

  /**
   * Parse one numeric section into a template:
   * { prefix, suffix, minInt, minDec, maxDec, group, scale, percent }
   */
  function parseNumSection(sec) {
    var tokens = []; // {t:'lit', v} | {t:'num', v}
    var numBuf = '';
    var seenNumber = false, numberDone = false;
    function flushNum() { if (numBuf) { tokens.push({ t: 'num', v: numBuf }); numBuf = ''; seenNumber = true; } }
    for (var i = 0; i < sec.length; i++) {
      var c = sec[i];
      if (c === '"') {
        var j = sec.indexOf('"', i + 1);
        if (j < 0) j = sec.length;
        if (numBuf) { flushNum(); numberDone = true; }
        tokens.push({ t: 'lit', v: sec.slice(i + 1, j) });
        i = j;
        continue;
      }
      if (c === '\\') { if (numBuf) { flushNum(); numberDone = true; } tokens.push({ t: 'lit', v: sec[i + 1] || '' }); i++; continue; }
      if (c === '[') { var k = sec.indexOf(']', i); i = k < 0 ? sec.length : k; continue; } // [Red], [$-409] ...
      if (c === '_') { if (numBuf) { flushNum(); numberDone = true; } tokens.push({ t: 'lit', v: ' ' }); i++; continue; } // width of next char
      if (c === '*') { i++; continue; } // repeat-fill: ignore
      if (!numberDone && (c === '0' || c === '#' || c === '?' || (c === '.' && !/\./.test(numBuf)) || (c === ',' && (numBuf || seenNumber)))) {
        numBuf += c;
        continue;
      }
      if (numBuf) { flushNum(); numberDone = true; }
      tokens.push({ t: 'lit', v: c });
    }
    flushNum();

    var prefix = '', suffix = '', num = '', percent = 0;
    var before = true;
    tokens.forEach(function (tk) {
      if (tk.t === 'num') { num = tk.v; before = false; return; }
      if (tk.v === '%') percent++;
      if (before) prefix += tk.v; else suffix += tk.v;
    });

    // trailing commas => scale by 1000 each
    var scale = 0;
    while (/,$/.test(num)) { scale++; num = num.slice(0, -1); }
    var dot = num.indexOf('.');
    var intPart = dot >= 0 ? num.slice(0, dot) : num;
    var decPart = dot >= 0 ? num.slice(dot + 1).replace(/,/g, '') : '';
    return {
      prefix: prefix,
      suffix: suffix,
      minInt: (intPart.match(/0/g) || []).length,
      minDec: (decPart.match(/0/g) || []).length,
      maxDec: decPart.replace(/,/g, '').length,
      group: intPart.indexOf(',') >= 0,
      scale: scale,
      percent: percent
    };
  }

  function groupDigits(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      if (i > 0 && (s.length - i) % 3 === 0) out += config.group;
      out += s[i];
    }
    return out;
  }

  function renderNum(abs, t) {
    var v = abs * Math.pow(100, t.percent) / Math.pow(1000, t.scale);
    var s = v.toFixed(t.maxDec);
    var parts = s.split('.');
    var ip = parts[0], dp = parts[1] || '';
    // trim optional decimals (#)
    while (dp.length > t.minDec && dp[dp.length - 1] === '0') dp = dp.slice(0, -1);
    if (ip === '0' && t.minInt === 0) ip = '';
    while (ip.length < t.minInt) ip = '0' + ip;
    if (t.group) ip = groupDigits(ip);
    return t.prefix + ip + (dp ? config.decimal + dp : '') + t.suffix;
  }

  function compileNumeric(code) {
    var secs = splitSections(code);
    var pos = parseNumSection(secs[0]);
    var neg = secs[1] != null && secs[1] !== '' ? parseNumSection(secs[1]) : null;
    var zero = secs[2] != null && secs[2] !== '' ? parseNumSection(secs[2]) : null;
    return function (v) {
      if (v === 0 && zero) return renderNum(0, zero);
      if (v < 0) {
        if (neg) return renderNum(-v, neg);
        var out = renderNum(-v, pos);
        // do not print "-0.0"
        return /[1-9]/.test(out) ? config.minus + out : out;
      }
      return renderNum(v, pos);
    };
  }

  /* ---------------- dates ---------------- */

  function toDate(v) {
    if (v instanceof Date) return v;
    if (typeof v === 'number') return new Date(v);
    if (typeof v === 'string') {
      var m = v.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
      if (m) return new Date(+m[1], +m[2] - 1, +(m[3] || 1));
      var d = new Date(v);
      return isNaN(d) ? null : d;
    }
    return null;
  }

  function compileDate(code) {
    var re = /"[^"]*"|\\.|yyyy|yy|mmmm|mmm|mm|m|dd|d|q/g;
    return function (v) {
      var d = toDate(v);
      if (!d) return String(v);
      return code.replace(re, function (tk) {
        switch (tk) {
          case 'yyyy': return String(d.getFullYear());
          case 'yy': return String(d.getFullYear()).slice(-2);
          case 'mmmm': return config.monthsLong[d.getMonth()];
          case 'mmm': return config.months[d.getMonth()];
          case 'mm': return ('0' + (d.getMonth() + 1)).slice(-2);
          case 'm': return String(d.getMonth() + 1);
          case 'dd': return ('0' + d.getDate()).slice(-2);
          case 'd': return String(d.getDate());
          case 'q': return String(Math.floor(d.getMonth() / 3) + 1);
          default: return tk[0] === '"' ? tk.slice(1, -1) : tk.slice(1);
        }
      });
    };
  }

  /* ---------------- compact auto ---------------- */

  function compact(v, decimals) {
    var abs = Math.abs(v), d = decimals == null ? 1 : decimals;
    for (var i = 0; i < config.compactUnits.length; i++) {
      var u = config.compactUnits[i];
      if (abs >= u[0]) return (v < 0 ? config.minus : '') + trimZeros((abs / u[0]).toFixed(d)) + u[1];
    }
    if (abs !== 0 && abs < 1) return (v < 0 ? config.minus : '') + trimZeros(abs.toFixed(Math.max(d, 2)));
    return (v < 0 ? config.minus : '') + trimZeros(abs.toFixed(abs < 10 ? d : 0));
  }
  function trimZeros(s) { return s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s; }

  /* ---------------- public API ---------------- */

  function compile(spec) {
    if (typeof spec === 'function') return spec;
    var code = spec == null || spec === '' ? 'General' : String(spec);
    if (presets[code]) code = presets[code];
    if (cache[code]) return cache[code];
    var fn;
    if (code === 'auto') fn = function (v) { return compact(v, 1); };
    else if (code === 'General') fn = function (v) { return Math.abs(v) >= 1e4 ? groupDigits(String(Math.round(v))) : trimZeros(v.toFixed(2)); };
    else if (code === '@') fn = function (v) { return String(v); };
    else if (isNumericCode(code)) fn = compileNumeric(code);
    else if (/[ymdq]/.test(code.replace(/"[^"]*"/g, ''))) fn = compileDate(code);
    else fn = function (v) { return String(v); };
    cache[code] = fn;
    return fn;
  }

  function isDateCode(spec) {
    var code = presets[spec] || spec;
    return typeof code === 'string' && !isNumericCode(code) && /[ymdq]/.test(code.replace(/"[^"]*"/g, ''));
  }

  function format(v, spec, opts) {
    if (v == null || v === '') return (opts && opts.na != null) ? opts.na : config.na;
    if (typeof v === 'string') {
      if (isDateCode(spec)) return compile(spec)(v);
      return v;
    }
    if (v instanceof Date) return compile(spec || 'date')(v);
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (!isFinite(v)) return (opts && opts.nm != null) ? opts.nm : config.nm;
    return compile(spec)(v);
  }

  format.compile = compile;
  format.compact = compact;
  format.presets = presets;
  format.config = config;
  format.toDate = toDate;
  format.isDateCode = isDateCode;
  /** Number of decimals a format code shows — useful for axis label precision. */
  format.decimals = function (spec) {
    var code = presets[spec] || spec;
    if (!code || !isNumericCode(code)) return null;
    return parseNumSection(splitSections(code)[0]).maxDec;
  };

  RK.format = format;
})(typeof window !== 'undefined' ? window : this);
