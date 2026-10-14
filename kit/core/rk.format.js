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
  /** Compact ('auto') units per language; RK.i18n picks one (zh-CN: 亿 = 1e8, 万 = 1e4). */
  var COMPACT_UNITS = {
    en: config.compactUnits,
    zh: [[1e8, '亿'], [1e4, '万']]
  };
  /**
   * Locale-dependent defaults per language (RK.format.applyLocale). zh: "n.a." / "n.m." become 不适用 / 无意义
   * ("—" would read as an accounting zero), month and weekday names are Chinese (mmm -> 10月, mmmm -> 十月,
   * ddd -> 周三, dddd -> 星期三) and the date presets use 年 / 月 / 日. dateCode rewrites English text-month codes
   * ("dd mmm yyyy", "mmm yy", "d mmm" ...) into Chinese order, so a field formatted for an English report reads
   * "2026年10月14日" rather than "14 10月 2026" in a Chinese one.
   */
  var LOCALES = {
    en: {
      config: { na: config.na, nm: config.nm, months: config.months, monthsLong: config.monthsLong, days: config.days, daysLong: config.daysLong, compactUnits: COMPACT_UNITS.en },
      presets: { date: 'dd mmm yyyy', month: 'mmm yy' },
      dateCode: null
    },
    zh: {
      config: {
        na: '不适用', nm: '无意义',
        months: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
        monthsLong: ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'],
        days: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
        daysLong: ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'],
        compactUnits: COMPACT_UNITS.zh
      },
      presets: { date: 'yyyy"年"m"月"d"日"', month: 'yy"年"m"月"' },
      dateCode: zhDateCode
    }
  };
  var DATE_TOKENS = /"[^"]*"|\\.|\[[^\]]*\]|yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|q/g;
  /**
   * 'dd mmm yyyy' -> 'yyyy"年"m"月"d"日"', 'mmm yy' -> 'yy"年"m"月"', 'd mmm' -> 'm"月"d"日"', 'ddd, d mmm yyyy' ->
   * 'yyyy"年"m"月"d"日" ddd'. Only codes with a month NAME (mmm / mmmm) plus a year or day, made of date parts and
   * separators, are rewritten; a lone 'mmm' / 'mmmm' (10月 / 十月), numeric dates ('yyyy-mm-dd', 'dd/mm/yy'), quarters
   * and codes with literal text stay as written.
   */
  function zhDateCode(code) {
    var y = null, d = false, w = null, month = false, other = false;
    var rest = code.replace(DATE_TOKENS, function (tk) {
      if (tk === 'yyyy' || tk === 'yy') { if (!y) y = tk; }
      else if (tk === 'mmmm' || tk === 'mmm') month = true;
      else if (tk === 'dd' || tk === 'd') d = true;
      else if (tk === 'dddd' || tk === 'ddd') { if (!w) w = tk; }
      else if (tk[0] === '\\') { if (/[^\s,.\-\/']/.test(tk.slice(1))) other = true; }   // \- \/ are separators
      else if (tk[0] !== '[') other = true;          // m / mm, q, "literal" ([$-409] locale tags are ignored)
      return '';
    });
    if (!month || (!y && !d) || other || /[^\s,.\-\/']/.test(rest)) return code;   // 'mmm' alone: just the name
    return (y ? y + '"年"' : '') + 'm"月"' + (d ? 'd"日"' : '') + (w ? ' ' + w : '');
  }
  var activeLocale = LOCALES.en, appliedLocale = LOCALES.en;

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
    var dot = s.indexOf('.'), p = dot < 0 ? s.length : dot;
    if (dot >= 0) s = s.slice(0, dot) + s.slice(dot + 1);
    var a = 0, b = s.length;
    while (a < b && s.charCodeAt(a) === 48) a++;       // leading zeros of 0.0705
    while (b > a && s.charCodeAt(b - 1) === 48) b--;   // trailing zeros carry no information
    return { ds: s.slice(a, b), p: p + x - a };
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

  /** Rounded digits of |v| for a numeric section: round(|v| x 10^(maxDec + 2 per % - 3 per trailing comma)). */
  function digitsOf(abs, t) { return scaledDigits(abs, t.maxDec, 2 * t.percent - 3 * t.scale); }

  /** Lay out rounded digits (from digitsOf) with a section template: decimal point, optional #, grouping, literals. */
  function renderDigits(s, t) {
    var d = t.maxDec;
    if (s.length <= d) s = zeros(d + 1 - s.length) + s;
    var ip = s.slice(0, s.length - d), dp = s.slice(s.length - d);
    // trim optional decimals (#)
    while (dp.length > t.minDec && dp.charCodeAt(dp.length - 1) === 48) dp = dp.slice(0, -1);
    if (ip === '0' && t.minInt === 0) ip = '';
    while (ip.length < t.minInt) ip = '0' + ip;
    if (t.group) ip = groupDigits(ip);
    return t.prefix + ip + (dp ? config.decimal + dp : '') + t.suffix;
  }
  function renderNum(abs, t) { return renderDigits(digitsOf(abs, t), t); }

  function compileNumeric(code) {
    var secs = splitSections(code);
    var pos = parseNumSection(secs[0]);
    var neg = secs[1] != null && secs[1] !== '' ? parseNumSection(secs[1]) : null;
    var zero = secs[2] != null && secs[2] !== '' ? parseNumSection(secs[2]) : null;
    var hideZero = secs.length > 2 && secs[2] === '';      // Excel "#,##0;(#,##0);" idiom: blank for zero
    return function (v) {
      if (v === 0) return hideZero ? '' : renderNum(0, zero || pos);
      var t = v < 0 && neg ? neg : pos, s = digitsOf(Math.abs(v), t);
      // never "-0.0", "(0.0)" or "+0.0%": a value that rounds to zero at the section's precision (-0.0004 with "0.0%")
      // is shown as zero: zero section, else the unsigned positive section; blank with an empty zero section
      if (s === '0') return hideZero ? '' : renderNum(0, zero || pos);
      return v < 0 && !neg ? config.minus + renderDigits(s, pos) : renderDigits(s, t);
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
    var re = DATE_TOKENS;
    if (activeLocale.dateCode) code = activeLocale.dateCode(code);
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
    if (typeof v === 'boolean') return RK.i18n ? RK.i18n.t(v ? 'yes' : 'no', v ? 'Yes' : 'No') : (v ? 'Yes' : 'No');
    if (!isFinite(v)) return (opts && opts.nm != null) ? opts.nm : config.nm;
    return compile(spec)(v);
  }

  /** '#,##0.0' -> '#,##0.0;(#,##0.0)': accounting negatives in parentheses (pitchbook tables). */
  format.parens = function (spec) {
    var code = presets[spec] || spec || '#,##0';
    return String(code).indexOf(';') >= 0 ? code : code + ';(' + code + ')';
  };
  /** '0.0%' -> '+0.0%;(0.0%);0.0%': signed changes, negatives in parentheses. */
  format.signed = function (spec) {
    var code = presets[spec] || spec || '#,##0.0';
    return String(code).indexOf(';') >= 0 ? code : '+' + code + ';(' + code + ');' + code;
  };
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
  format.compactUnits = COMPACT_UNITS;
  format.locales = LOCALES;
  /**
   * Locale-dependent settings for an RK.i18n locale: compact units, n.a. / n.m., month and weekday names, the
   * 'date' / 'month' presets and the text-month date-code order (LOCALES above). Runs on load and on 'i18n:changed'.
   * Only values still at the kit's default for the previous locale are swapped: a page that set config.na,
   * config.compactUnits, presets.date ... itself keeps them on every switch.
   */
  format.applyLocale = function (locale) {
    var lang = String(locale || (RK.i18n && RK.i18n.locale) || 'en').split('-')[0].toLowerCase();
    var next = has(LOCALES, lang) ? LOCALES[lang] : LOCALES.en, prev = appliedLocale;
    Object.keys(next.config).forEach(function (k) {
      if (config[k] === prev.config[k]) config[k] = next.config[k];
    });
    Object.keys(next.presets).forEach(function (k) {
      if (presets[k] === prev.presets[k]) presets[k] = next.presets[k];
    });
    config._defaultUnits = config.compactUnits;    // (kept for pages that read it)
    appliedLocale = next;
    if (activeLocale !== next) { activeLocale = next; cache = Object.create(null); }   // compiled date codes depend on it
  };
  /** The date code RK.format uses for `code` in the current locale ('dd mmm yyyy' -> 'yyyy"年"m"月"d"日"' in zh). */
  format.dateCode = function (code) {
    code = isPreset(code) ? presets[code] : code;
    return activeLocale.dateCode && isDateCode(code) ? activeLocale.dateCode(String(code)) : code;
  };
  format.toDate = toDate;
  format.isDateCode = isDateCode;
  /** Number of decimals a format code shows — useful for axis label precision. */
  format.decimals = function (spec) {
    var code = isPreset(spec) ? presets[spec] : spec;
    if (typeof code !== 'string' || !isNumericCode(code)) return null;
    return parseNumSection(splitSections(code)[0]).maxDec;
  };

  RK.format = format;
  config._defaultUnits = config.compactUnits;
  format.applyLocale();
  if (RK.bus) RK.bus.on('i18n:changed', function (l) { format.applyLocale(l); });
})(typeof window !== 'undefined' ? window : this);
