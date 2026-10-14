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
 *
 * Rounding matches Excel: half away from zero on the value's 15-significant-digit decimal digits
 * (RK.format(10.35, '0.0x') -> "10.4x", RK.format(2.675, '$0.00') -> "$2.68"). Digits are computed on decimal
 * strings, never with toFixed() or a scaling multiplication, so no binary artefacts reach the output.
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
    days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    daysLong: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    compactUnits: [[1e12, 'tn'], [1e9, 'bn'], [1e6, 'm'], [1e3, 'k']]
  };

  // Lookup tables have no prototype and are read with has(): "constructor", "toString", "__proto__" ... are never presets.
  function has(obj, key) { return obj != null && Object.prototype.hasOwnProperty.call(obj, key); }
  function dict(o) { var d = Object.create(null); for (var k in o) if (has(o, k)) d[k] = o[k]; return d; }

  var presets = dict({
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
  });

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

  /** Text an Excel [...] tag contributes: "$€-407" -> "€", "$USD" -> "USD", "Red" / "$-409" -> "". */
  function bracketText(tag) { return tag[0] === '$' ? tag.slice(1).split('-')[0] : ''; }

  function isNumericCode(code) { return /[0#?]/.test(code.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '')); }

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
      if (c === '[') { // [Red], [$-409] are dropped; [$€-407] / [$USD] keep their currency text
        var k = sec.indexOf(']', i), cur = bracketText(sec.slice(i + 1, k < 0 ? sec.length : k));
        if (cur) { if (numBuf) { flushNum(); numberDone = true; } tokens.push({ t: 'lit', v: cur }); }
        i = k < 0 ? sec.length : k; continue;
      }
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

  /* ---------------- decimal rounding (Excel-compatible) ---------------- */

  function zeros(n) { return n > 0 ? '0'.repeat(n) : ''; }

  /**
   * |v| as decimal digits at 15 significant digits, the precision Excel keeps: |v| = 0.<ds> x 10^p.
   *   2.675 -> {ds: '2675', p: 1}   0.0705 -> {ds: '705', p: -1}   1.5e300 -> {ds: '15', p: 301}   0 -> {ds: '', p: ...}
   * toPrecision(15) is exact decimal conversion of the binary value (2.67499999999999982236431605997495353221893310546875
   * -> "2.67500000000000"); everything after this works on the digit string.
   */
  function decimal(v) {
    var s = Math.abs(v).toPrecision(15), k = s.indexOf('e'), x = 0;
    if (k >= 0) { x = +s.slice(k + 1); s = s.slice(0, k); }
    var dot = s.indexOf('.'), p = (dot < 0 ? s.length : dot) + x;
    var ds = s.replace('.', ''), z = 0;
    while (z < ds.length && ds[z] === '0') z++;
    return { ds: ds.slice(z).replace(/0+$/, ''), p: p - z };
  }

  /** "129" -> "130", "999" -> "1000", "" -> "1" */
  function increment(s) {
    var i = s.length - 1;
    while (i >= 0 && s[i] === '9') i--;
    return (i < 0 ? '1' : s.slice(0, i) + String.fromCharCode(s.charCodeAt(i) + 1)) + zeros(s.length - 1 - i);
  }

  /**
   * Integer digits of round(|v| x 10^(shift + d)), half away from zero on the decimal digits. shift moves the decimal
   * point exactly (+2 per %, -3 per trailing comma) instead of multiplying, so 0.01005 at "0.00%" is 1.01%, not 1.00%.
   */
  function scaledDigits(v, d, shift) {
    var dec = decimal(v), ds = dec.ds, n = dec.p + (shift || 0) + d;
    if (!ds || n < 0) return '0';
    if (n >= ds.length) return ds + zeros(n - ds.length);   // nothing to round: 1.5e300 keeps all its digits
    var kept = ds.slice(0, n);
    if (ds.charCodeAt(n) >= 53) kept = increment(kept);      // next digit is 5..9
    return kept || '0';
  }

  /**
   * Excel-rounded replacement for |v|.toFixed(d): 10.35 -> "10.4" (toFixed: "10.3"), 2.675 -> "2.68", 1.005 -> "1.01",
   * 1e21 -> "1000000000000000000000" (toFixed: "1e+21"); any number of decimals (toFixed throws above 100).
   */
  function fixed(v, d, shift) {
    d = d > 0 ? Math.floor(d) : 0;
    var s = scaledDigits(v, d, shift);
    if (!d) return s;
    if (s.length <= d) s = zeros(d + 1 - s.length) + s;
    return s.slice(0, s.length - d) + '.' + s.slice(s.length - d);
  }

  /** Excel ROUND(x, d): half away from zero, d may be negative (round(1234.5, -2) = 1200). Used by RK.expr round(). */
  function round(x, d) {
    if (typeof x !== 'number' || !isFinite(x)) return x;
    d = Math.max(-400, Math.min(400, Math.trunc(d) || 0));   // Excel truncates num_digits; beyond ±400 nothing changes
    var y = +(d >= 0 ? fixed(x, d) : scaledDigits(x, d) + zeros(-d));
    return y === 0 ? 0 : (x < 0 ? -y : y);                     // never -0
  }

  /** Decimal-point shift of a numeric section: +2 per %, -3 per trailing comma. */
  function shiftOf(t) { return 2 * t.percent - 3 * t.scale; }

  function renderNum(abs, t) {
    var s = fixed(abs, t.maxDec, shiftOf(t));
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
    var hideZero = secs.length > 2 && secs[2] === '';      // Excel "#,##0;(#,##0);" idiom: blank for zero
    // value that shows as zero at the section's precision (-0.0004 with "0.0%")
    function roundsToZero(abs, t) { return scaledDigits(abs, t.maxDec, shiftOf(t)) === '0'; }
    return function (v) {
      if (v === 0 && hideZero) return '';
      if (v === 0 && zero) return renderNum(0, zero);
      // never "-0.0", "(0.0)" or "+0.0%": a value that rounds to zero is shown as zero (zero section, else the unsigned
      // positive section; blank with an empty zero section)
      if (v !== 0 && roundsToZero(Math.abs(v), v < 0 && neg ? neg : pos)) return hideZero ? '' : renderNum(0, zero || pos);
      if (v < 0) return neg ? renderNum(-v, neg) : config.minus + renderNum(-v, pos);
      return renderNum(v, pos);
    };
  }

  /* ---------------- dates ---------------- */

  function toDate(v) {
    if (v instanceof Date) return isNaN(v) ? null : v;
    if (typeof v === 'number') {
      if (!isFinite(v)) return null;
      // a bare 4-digit integer is a (fiscal) year, not 2026 ms after 1 Jan 1970
      return v % 1 === 0 && v >= 1000 && v <= 9999 ? new Date(v, 0, 1) : new Date(v);
    }
    if (typeof v === 'string') {
      var m = v.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
      if (m) {
        var mo = +m[2], day = +(m[3] || 1);
        if (mo < 1 || mo > 12 || day < 1 || day > new Date(+m[1], mo, 0).getDate()) return null;   // "2026-13-45": no silent roll-over
        return new Date(+m[1], mo - 1, day);
      }
      var d = new Date(v);
      return isNaN(d) ? null : d;
    }
    return null;
  }

  function compileDate(code) {
    var re = /"[^"]*"|\\.|\[[^\]]*\]|yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|q/g;
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
          case 'dddd': return config.daysLong[d.getDay()];
          case 'ddd': return config.days[d.getDay()];
          case 'dd': return ('0' + d.getDate()).slice(-2);
          case 'd': return String(d.getDate());
          case 'q': return String(Math.floor(d.getMonth() / 3) + 1);
          default: return tk[0] === '"' ? tk.slice(1, -1) : tk[0] === '[' ? bracketText(tk.slice(1, -1)) : tk.slice(1);
        }
      });
    };
  }

  /* ---------------- compact auto ---------------- */

  /** |v| / unit with d decimals: a power-of-ten unit (k, m, bn, 万, 亿 ...) only moves the decimal point. */
  function inUnit(abs, unit, d) {
    var e = Math.round(Math.log10(unit));
    return Math.pow(10, e) === unit ? fixed(abs, d, -e) : fixed(abs / unit, d);
  }

  function compact(v, decimals) {
    if (!isFinite(v)) return config.nm;
    var abs = Math.abs(v), d = decimals == null ? 1 : decimals, units = config.compactUnits, s = null;
    for (var i = 0; i < units.length && s === null; i++) {
      var u = units[i];
      if (abs < u[0]) continue;
      s = inUnit(abs, u[0], d);
      // the rounded value reached the next unit: 999,950 -> "1m", not "1000k"
      if (i > 0 && +s * u[0] >= units[i - 1][0]) { u = units[i - 1]; s = inUnit(abs, u[0], d); }
      s = trimZeros(s) + u[1];
    }
    if (s === null) {
      s = trimZeros(fixed(abs, abs !== 0 && abs < 1 ? Math.max(d, 2) : abs < 10 ? d : 0));
      var k = units[units.length - 1];
      if (k && +s >= k[0]) s = trimZeros(inUnit(abs, k[0], d)) + k[1];   // 999.95 -> "1k", not "1000"
    }
    return v < 0 && /[1-9]/.test(s) ? config.minus + s : s;              // no "-0"
  }

  /**
   * General, the format of every column without one: grouped integers from 10,000, up to 2 decimals below, and
   * 3 significant digits for small values (0.000123, not "0"; exponent form below 1e-8).
   */
  function general(v) {
    var abs = Math.abs(v), s;
    if (abs >= 1e4) s = groupDigits(fixed(abs, 0));          // group |v|, then add the sign: not "-,123,456"
    else if (abs >= 0.01 || abs === 0) s = trimZeros(fixed(abs, 2));
    else {
      var p = decimal(abs).p;                                  // |v| = 0.<digits> x 10^p
      if (p > -8) s = trimZeros(fixed(abs, 3 - p));
      else {
        var m = scaledDigits(abs, 3 - p);
        if (m.length > 3) { m = m.slice(0, 3); p++; }          // 9.995e-9 -> 1e-8
        s = trimZeros(m[0] + '.' + m.slice(1)) + 'e' + (p - 1);
      }
    }
    return v < 0 && /[1-9]/.test(s) ? config.minus + s : s;    // never "-0"
  }
  function trimZeros(s) { return s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s; }

  /* ---------------- public API ---------------- */

  function compile(spec) {
    if (typeof spec === 'function') return spec;
    var code = spec == null || spec === '' ? 'General' : String(spec);
    if (isPreset(code)) code = presets[code];
    if (cache[code]) return cache[code];
    var fn;
    if (code === 'auto') fn = function (v) { return compact(v, 1); };
    else if (code === 'General') fn = finite(general);
    else if (code === '@') fn = function (v) { return String(v); };
    else if (isNumericCode(code)) fn = finite(compileNumeric(code));
    else if (looksLikeDate(code)) fn = compileDate(code);
    else fn = finite(general);   // unknown preset name (typo) or plain text: readable number, not a garbled date
    cache[code] = fn;
    return fn;
  }

  /** Compiled number formats called directly (RK.format.compile(code)(v)) show NaN / Infinity as n.m., like RK.format. */
  function finite(fn) { return function (v) { return typeof v === 'number' && !isFinite(v) ? config.nm : fn(v); }; }
  function isPreset(name) { return typeof name === 'string' && has(presets, name); }   // not "constructor", "toString" ...
  function looksLikeDate(code) {
    var bare = code.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '');
    if (!/[ymdq]/.test(bare)) return false;
    // a bare identifier that is not made only of date tokens ("usd_mn", "pct_1") is a mistyped preset name
    return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(bare) || /^(?:yyyy|yy|mmmm|mmm|mm|m|dd|d|q)+$/.test(bare);
  }

  function isDateCode(spec) {
    var code = isPreset(spec) ? presets[spec] : spec;
    return typeof code === 'string' && !isNumericCode(code) && looksLikeDate(code);
  }

  function format(v, spec, opts) {
    if (v == null || v === '') return (opts && opts.na != null) ? opts.na : config.na;
    if (typeof v === 'string') {
      if (isDateCode(spec)) return compile(spec)(v);
      return v;
    }
    if (v instanceof Date) return isNaN(v) ? ((opts && opts.na != null) ? opts.na : config.na) : compile(spec || 'date')(v);
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (!isFinite(v)) return (opts && opts.nm != null) ? opts.nm : config.nm;
    return compile(spec)(v);
  }

  format.compile = compile;
  format.compact = compact;
  format.round = round;
  /** Excel-rounded toFixed() for components: RK.format.fixed(10.35, 1) -> "10.4" (toFixed: "10.3"); never "-0.0". */
  format.fixed = function (v, d) {
    if (!isFinite(v)) return String(v);
    var s = fixed(v, d);
    return v < 0 && /[1-9]/.test(s) ? config.minus + s : s;
  };
  format.presets = presets;
  format.config = config;
  format.toDate = toDate;
  format.isDateCode = isDateCode;
  /** Number of decimals a format code shows — useful for axis label precision. */
  format.decimals = function (spec) {
    var code = isPreset(spec) ? presets[spec] : spec;
    if (typeof code !== 'string' || !isNumericCode(code)) return null;
    return parseNumSection(splitSections(code)[0]).maxDec;
  };

  RK.format = format;
})(typeof window !== 'undefined' ? window : this);
