/*!
 * RK component: china-tilemap — compliance-safe tile-grid cartogram of China's 34 provincial-level
 * divisions. Every division is one equal-size square (or hexagon) placed on a grid that keeps the
 * relative geography; no boundary lines are drawn, so the chart is not a "map" in the sense of the
 * PRC map-review rules (no 审图号 needed in client decks) and never mis-draws a border.
 *
 * Rows join by adcode (6-digit string; city / county codes roll up to their province), by province
 * name (English or 中文, with or without 省 / 市 / 自治区 suffixes) or by ISO 3166-2:CN letters.
 * Tile fill = value on a sequential or diverging scale (continuous, or nice-rounded quantile / equal
 * classes with a counted legend), label = short Chinese / English name or code, optional second line
 * with the formatted value, highlighted tiles, tooltip with every field, click to cross-filter.
 *
 * Tile layout (rows / cols below) — own layout, built from province centroids (longitude -> column,
 * latitude -> row), cross-checked against the geofacet "china_prov_grid1" grid (hafen/grid-designer, MIT)
 * and newsroom China tile maps, then compacted to 7 x 8 so it fills a pitchbook block without holes:
 *   - 黑龙江 top-right with 吉林 / 辽宁 below, 新疆 / 西藏 on the left edge, 海南 at the bottom under
 *     广西 / 广东, 澳门 / 香港 under 广东, 台湾 east of 福建 across an empty "strait" cell;
 *   - row 4 is the Yangtze corridor (西藏-四川-重庆-湖北-安徽-江苏-上海), row 6 the south coast;
 *   - 63 of the 70 provincial land borders survive as touching tiles (side or corner) and every province
 *     with a land border touches at least one true neighbour; the empty top-left corner (where Mongolia
 *     would be) holds the legend.
 *         col:  0    1    2    3    4    5    6
 *         r0                                 黑
 *         r1                  蒙   京   辽   吉
 *         r2    新   甘   宁   晋   冀   津
 *         r3         青   陕   豫   鲁
 *         r4    藏   川   渝   鄂   皖   苏   沪
 *         r5         滇   黔   湘   赣   浙
 *         r6              桂   粤   闽        台
 *         r7              琼   澳   港
 *   Hexagons (shape: 'hex') use the same rows with per-row offsets of [0, 1, 2, 3, 2, 1, 2, 1] half tiles
 *   (found by exhaustive search; keeps 55 of 70 borders as shared hexagon sides).
 *   options.layout overrides positions ({"GD": [6, 3], "440000": [6, 3], ...}).
 */
(function () {
  'use strict';
  var C = RK.chart, U = RK.util, G = RK.geo;
  var SQRT3 = Math.sqrt(3);

  /** UI string via RK.i18n when present ({name} placeholders filled from vars). */
  function tr(key, fb, vars) {
    var s = null;
    try { if (RK.i18n && typeof RK.i18n.t === 'function') s = RK.i18n.t(key, fb); } catch (e) { s = null; }
    s = s == null ? fb : String(s);
    return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; }) : s;
  }

  //  ISO   adcode  short   official name        简称  English           row col  aliases (| separated)
  var RAW = [
    ['BJ', '11', '北京', '北京市', '京', 'Beijing', 1, 4, 'Peking'],
    ['TJ', '12', '天津', '天津市', '津', 'Tianjin', 2, 5],
    ['HE', '13', '河北', '河北省', '冀', 'Hebei', 2, 4],
    ['SX', '14', '山西', '山西省', '晋', 'Shanxi', 2, 3],
    ['NM', '15', '内蒙古', '内蒙古自治区', '蒙', 'Inner Mongolia', 1, 3, 'Nei Mongol|Neimenggu|Nei Menggu|Inner Mongolia Autonomous Region'],
    ['LN', '21', '辽宁', '辽宁省', '辽', 'Liaoning', 1, 5],
    ['JL', '22', '吉林', '吉林省', '吉', 'Jilin', 1, 6],
    ['HL', '23', '黑龙江', '黑龙江省', '黑', 'Heilongjiang', 0, 6],
    ['SH', '31', '上海', '上海市', '沪', 'Shanghai', 4, 6],
    ['JS', '32', '江苏', '江苏省', '苏', 'Jiangsu', 4, 5],
    ['ZJ', '33', '浙江', '浙江省', '浙', 'Zhejiang', 5, 5],
    ['AH', '34', '安徽', '安徽省', '皖', 'Anhui', 4, 4],
    ['FJ', '35', '福建', '福建省', '闽', 'Fujian', 6, 4],
    ['JX', '36', '江西', '江西省', '赣', 'Jiangxi', 5, 4],
    ['SD', '37', '山东', '山东省', '鲁', 'Shandong', 3, 4],
    ['HA', '41', '河南', '河南省', '豫', 'Henan', 3, 3],
    ['HB', '42', '湖北', '湖北省', '鄂', 'Hubei', 4, 3],
    ['HN', '43', '湖南', '湖南省', '湘', 'Hunan', 5, 3],
    ['GD', '44', '广东', '广东省', '粤', 'Guangdong', 6, 3],
    ['GX', '45', '广西', '广西壮族自治区', '桂', 'Guangxi', 6, 2],
    ['HI', '46', '海南', '海南省', '琼', 'Hainan', 7, 2],
    ['CQ', '50', '重庆', '重庆市', '渝', 'Chongqing', 4, 2],
    ['SC', '51', '四川', '四川省', '川', 'Sichuan', 4, 1, '蜀'],
    ['GZ', '52', '贵州', '贵州省', '黔', 'Guizhou', 5, 2, '贵'],
    ['YN', '53', '云南', '云南省', '滇', 'Yunnan', 5, 1, '云'],
    ['XZ', '54', '西藏', '西藏自治区', '藏', 'Tibet', 4, 0, 'Xizang'],
    ['SN', '61', '陕西', '陕西省', '陕', 'Shaanxi', 3, 2, '秦'],
    ['GS', '62', '甘肃', '甘肃省', '甘', 'Gansu', 2, 1, '陇'],
    ['QH', '63', '青海', '青海省', '青', 'Qinghai', 3, 1],
    ['NX', '64', '宁夏', '宁夏回族自治区', '宁', 'Ningxia', 2, 2],
    ['XJ', '65', '新疆', '新疆维吾尔自治区', '新', 'Xinjiang', 2, 0, 'Sinkiang'],
    ['TW', '71', '台湾', '台湾省', '台', 'Taiwan', 6, 6, '臺灣|台灣'],
    ['HK', '81', '香港', '香港特别行政区', '港', 'Hong Kong', 7, 4, 'Hongkong|香港特區'],
    ['MO', '82', '澳门', '澳门特别行政区', '澳', 'Macao', 7, 3, 'Macau|澳門']
  ];
  var PROV = RAW.map(function (a, i) {
    return { i: i, code: a[0], ad: a[1], adcode: a[1] + '0000', zh: a[2], zhFull: a[3], abbr: a[4], en: a[5], row: a[6], col: a[7],
      aliases: a[8] ? a[8].split('|') : [] };
  });

  /* ---------------- join keys ---------------- */
  var HAN = /[㐀-鿿]/;
  var ZH_SUFFIX = /(壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区|特區|省|市)$/;
  var EN_NOISE = /\b(special administrative region|autonomous region|province|municipality|sar|zhuang|hui|uygur|uyghur|uighur|of|the|prc|china)\b/g;
  function zhKey(s) { return String(s).replace(/\s+/g, '').replace(ZH_SUFFIX, ''); }
  function enKey(s) { return 'en:' + String(s).toLowerCase().replace(EN_NOISE, ' ').replace(/[^a-z]/g, ''); }
  var BY_AD = {}, BY_NAME = {};
  PROV.forEach(function (p) {
    BY_AD[p.ad] = p;
    [p.zh, p.zhFull, p.abbr, p.en, p.code, 'CN-' + p.code].concat(p.aliases).forEach(function (n) {
      BY_NAME[HAN.test(n) ? zhKey(n) : enKey(n)] = p;
    });
  });

  /**
   * Province record for a key. join: 'auto' (anything) | 'adcode' (digits only) | 'name' (names / ISO letters).
   * Adcodes: 6-digit province codes ("440000"), city / county codes ("440300") roll up by their first two digits.
   */
  function resolve(v, join) {
    if (v == null || v === '') return null;
    var s = String(v).trim();
    if (/^\d{2,12}$/.test(s)) return join === 'name' ? null : BY_AD[s.slice(0, 2)] || null;
    if (join === 'adcode') return null;
    return BY_NAME[HAN.test(s) ? zhKey(s) : enKey(s)] || null;
  }

  /** Hexagon rows: offset of each default row in half tiles (a valid hex lattice: neighbouring rows differ by one). */
  var HEX_SHIFT = [0, 1, 2, 3, 2, 1, 2, 1];

  /** UI strings (legend, tooltip) follow the report language, not the tile-label language. */
  var TXT = {
    zh: { noData: '无数据', filtered: '不在当前筛选范围内', rank: '排名', rows: '行', values: '个值', sum: '合计', avg: '平均',
      note: '示意图，不代表实际边界' },
    en: { noData: 'No data', filtered: 'Not in the current filter', rank: 'Rank', rows: 'rows', values: 'values', sum: 'sum', avg: 'avg.',
      note: 'Schematic; no boundaries implied' }
  };
  if (RK.i18n && typeof RK.i18n.add === 'function') {
    var zhPack = {};
    Object.keys(TXT.zh).forEach(function (k) { zhPack['chinaTilemap.' + k] = TXT.zh[k]; });
    RK.i18n.add('zh-CN', zhPack);
  }
  /** UI strings: options.uiLang ('zh' | 'en') forces a language; otherwise RK.i18n (report locale), else <html lang>. */
  function uiText(o) {
    if (o.uiLang === 'zh' || o.uiLang === 'en') return TXT[o.uiLang];
    if (!(RK.i18n && typeof RK.i18n.t === 'function')) {
      var loc = (RK.data && RK.data.manifest && RK.data.manifest.report && RK.data.manifest.report.locale) || document.documentElement.lang || 'en';
      return TXT[/^zh/i.test(loc) ? 'zh' : 'en'];
    }
    var out = {};
    Object.keys(TXT.en).forEach(function (k) { out[k] = tr('chinaTilemap.' + k, TXT.en[k]); });
    return out;
  }

  /* ---------------- colour scale ---------------- */

  /** Per-value tidy format: "$3" / "$7.5" / "$10", not "$3.0" / "$7.5" / "$10.0". */
  function tidy(fmt) {
    var code = String(RK.format.presets[fmt] || fmt || 'auto');
    var trimmed = code.replace(/([0#])\.[0#]+/g, '$1');
    function num(v, c) { return parseFloat(RK.format(v, c).replace(/[^\d.\-]/g, '')); }
    return function (v) { return RK.format(v, trimmed !== code && num(v, code) === num(v, trimmed) ? trimmed : code); };
  }

  /** CIELAB (D65) of a colour, and the CIE76 colour difference. */
  function lab(c) {
    var p = RK.theme.parseColor(c).slice(0, 3).map(function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    var x = (p[0] * 0.4124 + p[1] * 0.3576 + p[2] * 0.1805) / 0.95047, y = p[0] * 0.2126 + p[1] * 0.7152 + p[2] * 0.0722,
      z = (p[0] * 0.0193 + p[1] * 0.1192 + p[2] * 0.9505) / 1.08883;
    function f(v) { return v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116; }
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  }
  function dE(a, b) { var p = lab(a), q = lab(b); return Math.sqrt(Math.pow(p[0] - q[0], 2) + Math.pow(p[1] - q[1], 2) + Math.pow(p[2] - q[2], 2)); }
  /** Mix a fill toward `to` until it is at least ΔE `min` from every background it can sit next to. */
  function separate(c, bgs, min, to) {
    for (var k = 0; k <= 10; k++) {
      var x = k ? RK.theme.mix(c, to, k * 0.08) : c;
      if (bgs.every(function (b) { return !b || dE(x, b) >= min; })) return x;
    }
    return RK.theme.mix(c, to, 0.8);
  }

  /** Roundest number x with lo < x <= hi (coarsest step first): a class break inside the gap between two values. */
  function roundIn(lo, hi) {
    if (!(hi > lo)) return hi;
    var p = Math.pow(10, Math.ceil(Math.log10(Math.max(Math.abs(lo), Math.abs(hi)) || 1)) + 1);
    for (; p > (hi - lo) / 1e6; p /= 10) {
      for (var k = 0, M = [10, 5, 2.5, 2, 1]; k < M.length; k++) {
        var st = p * M[k] / 10, x = Math.floor(lo / st) * st + st;
        if (x <= hi + 1e-12) return +x.toPrecision(12);
      }
    }
    return hi;
  }

  /** Fisher-Jenks natural breaks on sorted values: start index of classes 2..k (minimum within-class variance). */
  function jenks(s, k) {
    var n = s.length, p1 = [0], p2 = [0], D = [], B = [], i, j, m;
    for (i = 0; i < n; i++) { p1.push(p1[i] + s[i]); p2.push(p2[i] + s[i] * s[i]); }
    function ssd(a, b) { var c = b - a + 1, sm = p1[b + 1] - p1[a]; return p2[b + 1] - p2[a] - sm * sm / c; }
    for (j = 0; j < k; j++) { D.push([]); B.push([]); for (i = 0; i < n; i++) { D[j].push(Infinity); B[j].push(0); } }
    for (i = 0; i < n; i++) D[0][i] = ssd(0, i);
    for (j = 1; j < k; j++) {
      for (i = j; i < n; i++) {
        for (m = j; m <= i; m++) { var c = D[j - 1][m - 1] + ssd(m, i); if (c < D[j][i]) { D[j][i] = c; B[j][i] = m; } }
      }
    }
    var out = [];
    for (j = k - 1, i = n - 1; j > 0; j--) { m = B[j][i]; out.unshift(m); i = m - 1; }
    return out;
  }

  /** Sequential class breaks: explicit, natural breaks (Jenks), nice-rounded quantiles, or nice equal intervals. */
  function classBreaks(o, vals, ext) {
    if (Array.isArray(o.breaks) && o.breaks.length) return o.breaks.slice().sort(function (a, b) { return a - b; });
    var n = Math.max(2, o.bins | 0), out = [];
    if (o.classify === 'jenks') {
      // natural breaks keep outliers (the headline provinces) in their own classes; each break is the roundest number
      // between the last value of one class and the first of the next, so rounding never moves a value across classes
      var sv = vals.slice().sort(function (a, b) { return a - b; }), uniq = U.unique(sv);
      if (uniq.length <= n) { for (var u = 1; u < uniq.length; u++) out.push(roundIn(uniq[u - 1], uniq[u])); }
      else jenks(sv, n).forEach(function (m) { if (sv[m] > sv[m - 1]) out.push(roundIn(sv[m - 1], sv[m])); });
    } else if (o.classify === 'equal') {
      var step = U.niceStep(ext[1] - ext[0], n);
      for (var x = Math.ceil(ext[0] / step) * step; x < ext[1]; x += step) if (x > ext[0]) out.push(+x.toPrecision(10));
    } else {
      var s = vals.slice().sort(function (a, b) { return a - b; });
      for (var i = 1; i < n; i++) {
        var q = (s.length - 1) * i / n, lo = Math.floor(q);
        out.push(G.nice(s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (q - lo)));
      }
    }
    var top = o.classify === 'jenks' ? ext[1] + 1e-9 : ext[1];
    return U.unique(out).filter(function (b) { return b > ext[0] && b < top; });
  }

  /**
   * Scale over the domain values (all rows, so colours stay put while filters change).
   * Returns {type, color(v), classOf(v), classes: [{j, color, label}] (highest first) | null, ramp: {stops, labels} | null}.
   */
  function buildScale(o, t, vals, fmt) {
    var ext = vals.length ? U.extent(vals) : [0, 1];
    var mid = +o.mid || 0;
    var div = o.scale === 'diverging' || (o.scale !== 'sequential' && ext[0] < mid && ext[1] > mid);
    var seq = G.seqStops(t);
    var explicit = Array.isArray(o.breaks) && o.breaks.length;
    var bf = tidy(fmt);
    // every fill keeps a visible distance from the paper and from the no-data fill (dark-theme midpoints, palest classes)
    var bgs = [t.paper, noDataFill(t)], dHi = t.div[t.div.length - 1], sHi = seq[seq.length - 1];
    function lift(c, hi) { return separate(c, bgs, 12, hi ? (div ? dHi : sHi) : t.div[0]); }
    if (!((o.bins > 0 || explicit) && vals.length > 1)) {
      if (div) {
        var dev = Math.max(Math.abs(ext[0] - mid), Math.abs(ext[1] - mid)) || 1, dc = RK.theme.diverging([mid - dev, mid + dev], mid, t.div);
        return { type: 'diverging', color: function (v) { return lift(dc(v), v >= mid); }, classOf: function () { return 0; },
          classes: null, ramp: { stops: t.div, labels: [bf(mid - dev), bf(mid), bf(mid + dev)] } };
      }
      var sc = RK.theme.sequential(ext[0] === ext[1] ? [ext[0] - 1, ext[1]] : ext, seq);
      return { type: 'sequential', color: function (v) { return lift(sc(v), true); }, classOf: function () { return 0; },
        classes: null, ramp: { stops: seq, labels: [bf(ext[0]), bf(ext[1])] } };
    }
    var breaks;
    if (div && !explicit) {
      // symmetric equal steps around the midpoint, k classes per side; the outer classes are open-ended
      var k = Math.max(1, Math.round(o.bins / 2));
      var dv = Math.max(Math.abs(ext[0] - mid), Math.abs(ext[1] - mid)) || 1;
      var st = Math.abs(G.nice(dv / k)) || 1;
      breaks = [];
      for (var i = -k + 1; i < k; i++) breaks.push(+(mid + i * st).toPrecision(10));
    } else breaks = classBreaks(o, vals, ext);
    var n = breaks.length + 1, colors;
    if (div) {
      var dr = RK.theme.ramp(t.div);
      var nNeg = breaks.filter(function (b) { return b <= mid; }).length, m = Math.max(nNeg, n - nNeg) || 1;
      colors = breaks.concat([null]).map(function (_, j) { return lift(dr(j < nNeg ? 0.5 - 0.5 * (nNeg - j) / m : 0.5 + 0.5 * (j - nNeg + 1) / m), j >= nNeg); });
    } else {
      var sr = RK.theme.ramp(seq);
      colors = breaks.concat([null]).map(function (_, j) { return lift(sr(n > 1 ? j / (n - 1) : 1), true); });
    }
    function classOf(v) { var j = 0; while (j < breaks.length && v >= breaks[j]) j++; return j; }
    var classes = colors.map(function (c, j) {
      var label = n === 1 ? bf(ext[0]) : j === 0 ? '< ' + bf(breaks[0]) : j === n - 1 ? '≥ ' + bf(breaks[j - 1]) : bf(breaks[j - 1]) + ' – ' + bf(breaks[j]);
      return { j: j, color: c, label: label };
    }).reverse();
    return { type: div ? 'diverging' : 'sequential', color: function (v) { return colors[classOf(v)]; }, classOf: classOf, classes: classes, ramp: null };
  }

  /* ---------------- legend ---------------- */
  var LEG = { title: 15, gap: 5, row: 16, sw: 10, bar: 120, barH: 8 };

  /**
   * Legend model: rows + measured sizes. Vertical arrangement: m.w x m.h (counts right-aligned);
   * horizontal arrangement: m.flow(maxW) wraps the rows into lines no wider than maxW.
   */
  function legendModel(ctx, scale, tiles, txt) {
    var o = ctx.options, t = ctx.theme;
    var title = o.legendTitle || G.fieldTitle(ctx, ctx.enc.value);
    var F = legendFonts(t);
    var items = [];
    if (scale.classes) {
      scale.classes.forEach(function (c) {
        var n = tiles.filter(function (x) { return x.has && x.cls === c.j; }).length;
        items.push({ cls: c.j, color: c.color, label: c.label, note: String(n) });
      });
    }
    // rows depend only on the unfiltered domain, so the legend (and the grid layout) never jumps when filters change;
    // provinces the filters exclude are drawn as pale "ghost" tiles and explained in their tooltip
    var missing = tiles.filter(function (x) { return !x.inDomain; }).length;
    if (missing) items.push({ cls: -1, color: noDataFill(t), hatch: true, label: txt.noData, note: String(missing), muted: true });
    if (o.highlightLabel && tiles.some(function (x) { return x.hl; })) items.push({ cls: -2, ring: ringColor(t, tiles), label: o.highlightLabel });
    var rows = items.filter(function (it) { return !scale.ramp || it.cls < 0; });
    rows.forEach(function (it) { it.lw = C.measure(it.label, F.item); });
    var labW = Math.max.apply(null, rows.map(function (it) { return it.lw; }).concat([0]));
    var noteW = Math.max.apply(null, rows.map(function (it) { return it.note ? C.measure(it.note, F.note) : 0; }).concat([0]));
    var titleW = C.measure(title, F.title);
    var rampH = scale.ramp ? LEG.barH + 4 + 12 + 4 : 0;
    var m = {
      title: title, rows: rows, ramp: scale.ramp,
      w: Math.ceil(Math.max(titleW, scale.ramp ? LEG.bar : 0, rows.length ? LEG.sw + 6 + labW + 12 + noteW : 0)) + 2,
      h: LEG.title + LEG.gap + rampH + rows.length * LEG.row
    };
    /** Horizontal flow: ramp (if any) then swatch rows, wrapped at maxW. Returns {w, h, at: [[x, y]...] per row}. */
    m.flow = function (maxW) {
      var x = 0, y = LEG.title + LEG.gap, w = titleW, at = [], lineH = LEG.row;
      if (scale.ramp) { x = LEG.bar + 16; w = Math.max(w, LEG.bar); lineH = LEG.barH + 4 + 12 + 2; }
      rows.forEach(function (it) {
        var iw = LEG.sw + 6 + it.lw;
        if (x > 0 && x + iw > maxW) { x = 0; y += lineH; lineH = LEG.row; }
        at.push([x, y]);
        w = Math.max(w, x + iw);
        x += iw + 14;
      });
      return { w: Math.ceil(w), h: Math.ceil(y + (rows.length || scale.ramp ? lineH - 4 : 0)), at: at };
    };
    return m;
  }

  function legendFonts(t) { return { title: '600 11px ' + t.fontSans, item: '11px ' + t.fontNum, note: '10px ' + t.fontNum }; }

  /** ECharts graphic group for the legend (exported with the chart). flow: null (vertical) | m.flow(...) result. */
  function legendGraphic(ctx, m, x, y, flow, on) {
    var t = ctx.theme, kids = [], F = legendFonts(t);
    kids.push({ type: 'text', x: 0, y: 0, silent: true, style: { text: m.title, fill: t.ink, font: F.title, verticalAlign: 'top' } });
    var yy = LEG.title + LEG.gap;
    if (m.ramp) {
      var st = m.ramp.stops;
      kids.push({ type: 'rect', silent: true, shape: { x: 0, y: yy, width: LEG.bar, height: LEG.barH, r: 1 },
        style: { fill: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: st.map(function (c, i) { return { offset: i / (st.length - 1), color: c }; }) } } });
      m.ramp.labels.forEach(function (l, i, a) {
        var pos = a.length === 1 ? 0 : i / (a.length - 1);
        kids.push({ type: 'text', silent: true, x: pos * LEG.bar, y: yy + LEG.barH + 4,
          style: { text: l, fill: t.ink2, font: F.note, verticalAlign: 'top', align: i === 0 ? 'left' : i === a.length - 1 ? 'right' : 'center' } });
      });
      if (!flow) yy += LEG.barH + 4 + 12 + 4;
    }
    m.rows.forEach(function (it, k) {
      var rx = flow ? flow.at[k][0] : 0, ry = flow ? flow.at[k][1] : yy;
      var rowW = flow ? LEG.sw + 6 + it.lw : m.w;
      var sw = it.ring
        ? { type: 'rect', silent: true, shape: { x: 1, y: ry + 1, width: LEG.sw - 2, height: LEG.sw - 2, r: 1.5 }, style: { fill: 'none', stroke: it.ring, lineWidth: 2 } }
        : { type: 'rect', silent: true, shape: { x: 0, y: ry, width: LEG.sw, height: LEG.sw, r: 2 },
          style: it.hatch ? { fill: hatchFill(t), stroke: RK.theme.mix(it.color, t.ink, 0.18), lineWidth: 0.6 } : { fill: it.color } };
      var row = [
        { type: 'rect', shape: { x: -3, y: ry - 3, width: rowW + 6, height: LEG.sw + 6, r: 3 }, style: { fill: 'rgba(0,0,0,0)' } },
        sw,
        { type: 'text', silent: true, x: LEG.sw + 6, y: ry + LEG.sw / 2, style: { text: it.label, fill: it.muted ? t.ink3 : t.ink2, font: F.item, verticalAlign: 'middle' } }
      ];
      if (!flow && it.note) row.push({ type: 'text', silent: true, x: m.w, y: ry + LEG.sw / 2, style: { text: it.note, fill: t.ink3, font: F.note, align: 'right', verticalAlign: 'middle' } });
      var interactive = it.cls !== -2 && on;
      kids.push({
        type: 'group', x: rx, y: 0, children: row, cursor: interactive && it.cls >= 0 && ctx.options.crossFilter !== false ? 'pointer' : 'default',
        onmouseover: interactive ? function () { on.focus(it.cls); } : null,
        onmouseout: interactive ? function () { on.focus(null); } : null,
        onclick: interactive && it.cls >= 0 ? function () { on.pick(it.cls); } : null
      });
      if (!flow) yy += LEG.row;
    });
    return { type: 'group', id: 'rk-tile-legend', x: Math.round(x), y: Math.round(y), children: kids };
  }

  /** Ratios, percentages and multiples average across rows instead of adding up. */
  function ratioLike(f) { return /%|x$|bps|ratio|margin|growth|rate|pct|share|multiple/i.test(String(f.format || '') + ' ' + (f.name || '')); }

  function noDataFill(t) { return t.mapLand || t.surface2 || t.grid; }
  /** No-data tiles are hatched, so they never read as the palest data class. */
  function hatchFill(t) {
    var bg = noDataFill(t), ln = RK.theme.mix(bg, t.ink, t.dark ? 0.22 : 0.18);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="6" height="6"><rect width="6" height="6" fill="' + bg + '"/>' +
      '<path d="M-1 1L1 -1M0 6L6 0M5 7L7 5" stroke="' + ln + '" stroke-width="1"/></svg>';
    return { image: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), repeat: 'repeat', imageWidth: 6, imageHeight: 6 };
  }
  /**
   * Outline colour of the highlighted (target / top-N) tiles: accent-2 when it stands clear of every highlighted fill and of
   * the paper (the ring is drawn outside the tile on a paper halo), else the ink token.
   */
  function ringColor(t, tiles) {
    var a = t.accent2;
    var ok = dE(a, t.paper) >= 15 && tiles.every(function (x) { return !x.hl || dE(a, x.base) >= 15; });
    return ok ? a : t.ink;
  }
  /** Provinces with data that the current filters exclude: a lighter tint of the no-data fill. */
  function filteredFill(t) { return RK.theme.mix(noDataFill(t), t.paper, 0.5); }

  /**
   * Schematic note in a free corner of the grid: bottom-right, then bottom-left (one line, or two lines split at
   * the first punctuation mark), else under the grid when there is room; null when nothing fits.
   */
  function noteGraphic(t, F, note) {
    var font = '9.5px ' + t.fontSans, lh = 12;
    var cut = note.search(/[，,;；:：]\s*/);
    var variants = [[note]];
    if (cut > 0) variants.push([note.slice(0, cut).trim(), note.slice(cut + 1).trim()]);
    function el(lines, x, y, align) {
      return { type: 'text', id: 'rk-tile-note', silent: true, x: Math.round(x), y: Math.round(y),
        style: { text: lines.join('\n'), fill: t.ink3, font: font, align: align, verticalAlign: 'bottom', lineHeight: lh } };
    }
    for (var c = 0; c < 2; c++) {
      for (var v = 0; v < variants.length; v++) {
        var lines = variants[v], w = Math.ceil(Math.max.apply(null, lines.map(function (l) { return C.measure(l, font); }))), h = lines.length * lh;
        if (c === 0 && F.clear(F.gw - w, F.gh - h, w, h)) return el(lines, F.ox + F.gw, F.oy + F.gh, 'right');
        if (c === 1 && F.clear(0, F.gh - h, w, h)) return el(lines, F.ox, F.oy + F.gh, 'left');
      }
    }
    if (F.oy + F.gh + lh + 2 <= F.H && F.legend !== 'bottom') return el([note], F.ox + F.gw, F.oy + F.gh + lh + 1, 'right');
    return null;
  }

  /* ---------------- geometry ---------------- */

  /** Tile positions [row, col] with options.layout overrides (keys: ISO letters, adcode or name). */
  function positions(o) {
    var pos = PROV.map(function (p) { return [p.row, p.col]; });
    if (U.isObj(o.layout)) {
      Object.keys(o.layout).forEach(function (k) {
        var p = resolve(k, 'auto'), rc = o.layout[k];
        if (p && Array.isArray(rc) && U.isNum(+rc[0]) && U.isNum(+rc[1])) pos[p.i] = [+rc[0], +rc[1]];
      });
    }
    return pos;
  }

  /**
   * Layout for a W x H canvas: cell size s, tile size, centres, grid origin, legend placement.
   * Legend 'auto': the empty top-left corner of the grid (Mongolia) when it fits, else beside or below the grid.
   */
  function makeFrame(W, H, o, pos, lm) {
    var hex = o.shape === 'hex', pad = 2;
    var r0 = Math.min.apply(null, pos.map(function (p) { return p[0]; }));
    // column units per tile (hex rows are offset by half tiles), normalised so the leftmost tile sits at 0
    var xu = pos.map(function (p) {
      var r = p[0], sh = !hex ? 0 : r >= 0 && r < HEX_SHIFT.length ? HEX_SHIFT[r] : HEX_SHIFT[HEX_SHIFT.length - 2 + (r % 2)];
      return p[1] + sh / 2;
    });
    var x0 = Math.min.apply(null, xu);
    xu = xu.map(function (x) { return x - x0; });
    var rows = 1 + Math.max.apply(null, pos.map(function (p) { return p[0] - r0; }));
    var cols = 1 + Math.max.apply(null, xu);
    function fit(aw, ah) {
      var s = hex ? Math.min(aw / cols, ah / ((rows - 1) * SQRT3 / 2 + 2 / SQRT3)) : Math.min(aw / cols, ah / rows);
      return Math.max(10, Math.floor(s * 2) / 2);
    }
    function size(s) { return hex ? { w: cols * s, h: (rows - 1) * s * SQRT3 / 2 + 2 * s / SQRT3 } : { w: cols * s, h: rows * s }; }
    function gapOf(s) { return o.gap != null ? +o.gap : U.clamp(Math.round(s * 0.06), 2, 5); }
    function centres(s) {
      return pos.map(function (rc, i) {
        var r = rc[0] - r0;
        return hex ? [(xu[i] + 0.5) * s, r * s * SQRT3 / 2 + s / SQRT3] : [(xu[i] + 0.5) * s, (r + 0.5) * s];
      });
    }
    /** Is the rectangle (grid coordinates) clear of every tile at cell size s? */
    function clearAt(s, x, y, w, h) {
      var cs = centres(s), tw = s - gapOf(s), hw = tw / 2 + 3, hh = (hex ? tw / SQRT3 : tw / 2) + 3;
      return cs.every(function (c) { return c[0] + hw <= x || c[0] - hw >= x + w || c[1] + hh <= y || c[1] - hh >= y + h; });
    }
    var want = !lm ? 'none' : o.legendPosition || 'auto';
    var aw = W - 2 * pad, ah = H - 2 * pad, s = fit(aw, ah), place = 'none', flow = null;
    if (want === 'auto' || want === 'corner') {
      // the empty top-left corner of the grid: the vertical legend, else the same rows wrapped into lines
      var gsz = size(s);
      if (lm.w <= gsz.w * 0.6 && clearAt(s, 0, 0, lm.w, lm.h)) place = 'corner';
      else {
        [0.85, 0.7, 0.55, 0.4].some(function (k) {
          var f = lm.flow(gsz.w * k);
          if (f.w <= gsz.w * k + 1 && clearAt(s, 0, 0, f.w, f.h)) { place = 'corner'; flow = f; return true; }
          return false;
        });
      }
      if (place === 'none') place = 'auto';
    } else place = want;
    if (place === 'auto') {
      var sSide = fit(aw - lm.w - 20, ah), sBottom = fit(aw, ah - lm.flow(aw).h - 14);
      place = sSide >= sBottom ? 'left' : 'bottom';
    }
    if (place === 'bottom') flow = lm.flow(aw);
    if (place === 'left' || place === 'right') s = fit(aw - lm.w - 20, ah);
    else if (place === 'bottom') s = fit(aw, ah - flow.h - 14);
    var g = size(s), ox, oy, lx = 0, ly = 0;
    if (place === 'left' || place === 'right') {
      var gw = lm.w + 20 + g.w, gx = Math.max(pad, (W - gw) / 2);
      oy = Math.max(pad, (H - g.h) / 2);
      if (place === 'left') { lx = gx; ox = gx + lm.w + 20; } else { ox = gx; lx = gx + g.w + 20; }
      ly = oy;
    } else if (place === 'bottom') {
      ox = Math.max(pad, (W - g.w) / 2);
      oy = Math.max(pad, (H - g.h - 14 - flow.h) / 2);
      lx = Math.max(pad, (W - flow.w) / 2); ly = oy + g.h + 14;
    } else {
      ox = Math.max(pad, (W - g.w) / 2); oy = Math.max(pad, (H - g.h) / 2);
      lx = ox + 2; ly = oy + 2;
    }
    var tile = s - gapOf(s), cs = centres(s);
    var fr = { W: W, H: H, hex: hex, s: s, tile: tile, ox: ox, oy: oy, gw: g.w, gh: g.h, centres: cs, legend: place, flow: flow, lx: lx, ly: ly };
    fr.clear = function (x, y, w, h) { return clearAt(s, x, y, w, h); };
    return fr;
  }

  function hexPoints(R) {
    var w = R * SQRT3 / 2;
    return [[0, -R], [w, -R / 2], [w, R / 2], [0, R], [-w, R / 2], [-w, -R / 2]];
  }

  /**
   * Label plan for a tile size: which name (full short name or code / 简称), font sizes, value line on/off.
   * One plan for all tiles so the grid reads evenly.
   */
  function labelPlan(o, t, frame, valueTexts) {
    var lang = o.lang === 'en' ? 'en' : 'zh';
    var inner = frame.tile * (frame.hex ? 0.84 : 0.9) - 4, tall = frame.tile * (frame.hex ? 0.78 : 0.82);
    var f = U.clamp(Math.round(frame.tile * (o.values === false ? 0.235 : 0.2) * 2) / 2, 8, o.values === false ? 14 : 13);
    var mode = o.labels === false ? 'none' : o.labels === 'abbr' || o.labels === 'code' ? 'abbr' : o.labels === 'name' ? 'name' : 'auto';
    var withValues = o.values !== false;
    function names(m) { return PROV.map(function (p) { return lang === 'zh' ? (m === 'abbr' ? p.abbr : p.zh) : (m === 'abbr' ? p.code : p.en); }); }
    function width(s, size) { return C.measure(s, '600 ' + size + 'px ' + t.fontSans); }
    /** Names at a font size: multi-word names that are too wide wrap at the space nearest the middle. */
    function setOf(list, size) {
      var lines = 1, w = 0;
      var texts = list.map(function (n) {
        var nw = width(n, size);
        if (nw > inner && n.indexOf(' ') > 0) {
          var mid = n.length / 2, best = -1;
          n.replace(/ /g, function (_, i) { if (best < 0 || Math.abs(i - mid) < Math.abs(best - mid)) best = i; return _; });
          var a = n.slice(0, best), b = n.slice(best + 1);
          nw = Math.max(width(a, size), width(b, size));
          if (nw <= inner) { lines = 2; n = a + '\n' + b; }
        }
        w = Math.max(w, nw);
        return n;
      });
      return { texts: texts, w: w, lines: lines };
    }
    // names first; an 'auto' value line is only added when there is room left (values: true reserves it)
    function fits(set, size) { return set.w <= inner && set.lines * size * 1.18 + (o.values === true ? Math.max(7.5, size - 1.5) * 1.18 : 0) <= tall; }
    var fName = f, use = mode, set = null;
    if (mode === 'auto' || mode === 'name') {
      var full = names('name'), size = f, minF = mode === 'name' ? 6.5 : lang === 'zh' ? 9 : 9.5;
      set = setOf(full, size);
      while (size > minF && !fits(set, size)) { size -= 0.5; set = setOf(full, size); }
      if (set.w <= inner || mode === 'name') { use = 'name'; fName = size; } else { use = 'abbr'; set = null; }
    }
    if (use === 'abbr') set = setOf(names('abbr'), fName);
    var plan = { mode: use, names: use === 'none' ? null : set.texts, lines: set ? set.lines : 1, fName: fName, values: false, fValue: 0 };
    if (withValues && use !== 'none') {
      var fv = Math.max(7.5, fName - 1.5);
      var vw = Math.max.apply(null, valueTexts.map(function (s) { return s ? C.measure(s, '500 ' + fv + 'px ' + t.fontNum) : 0; }).concat([0]));
      var room = (fName * plan.lines + fv) * 1.18 + 2 <= tall;
      if (o.values === true) { while (fv > 6.5 && vw > inner) { fv -= 0.5; vw = vw * (fv / (fv + 0.5)); } plan.values = true; }
      else plan.values = room && vw <= inner && frame.tile >= 40;
      plan.fValue = fv;
    }
    if (!plan.values && plan.names) {
      // no value line: let the names grow into the free space (one tile-wide rule for every tile)
      var list = names(use), big = U.clamp(Math.round(frame.tile * (use === 'abbr' ? 0.3 : 0.24) * 2) / 2, 8, 15);
      for (var z = big; z > plan.fName; z -= 0.5) {
        var cand = setOf(list, z);
        if (cand.w <= inner && cand.lines * z * 1.18 <= tall) { plan.fName = z; plan.names = cand.texts; plan.lines = cand.lines; break; }
      }
    }
    return plan;
  }


  /* ---------------- component ---------------- */
  RK.component({
    id: 'china-tilemap',
    deps: ['echarts'],
    allowEmpty: true,             // a filter that removes every province still draws the (muted) grid
    defaults: {
      encode: { id: 'adcode', value: 'value' },
      join: 'auto',               // auto | adcode | name — how encode.id values are matched to provinces
      lang: 'zh',                 // tile labels: zh (北京) | en (Beijing / BJ)
      labels: 'auto',             // auto (full short name when it fits, else 简称 / ISO code) | name | abbr | false
      values: 'auto',             // second line with the formatted value: auto (when tiles are big enough) | true | false
      shape: 'square',            // square | hex
      scale: 'auto',              // auto (diverging when values straddle mid) | sequential | diverging
      mid: 0,                     // diverging midpoint (0 for growth, or a group average)
      bins: 5,                    // colour classes; 0 = continuous ramp (diverging: classes per side = bins / 2)
      classify: 'jenks',          // jenks (natural breaks: outliers get their own class) | quantile | equal; breaks are rounded
      breaks: null,               // explicit class breaks, e.g. [5, 10, 20, 40]
      format: null,               // value format (defaults to the value field format)
      agg: 'sum',                 // several rows per province (e.g. city-level adcodes): sum | avg | max | min | first
      highlight: null,            // province key(s) outlined in the accent colour (adcode, name or ISO letters)
      highlightLabel: null,       // legend entry for the highlighted tiles (e.g. "Target footprint")
      tooltip: 'all',             // all (every field) | [fields] | false
      legend: true,
      legendTitle: null,          // defaults to the value field title + unit
      legendPosition: 'auto',     // auto (empty top-left corner, else beside / below) | corner | left | right | bottom
      filterField: null,          // click-to-filter field; defaults to encode.id
      gap: null,                  // px between tiles (default ~6% of the cell)
      radius: 2,                  // square corner radius (px)
      layout: null,               // {key: [row, col]} position overrides
      note: false,                // true (localised "schematic, no boundaries implied" note) | string | false
      uiLang: null                // legend / tooltip strings: zh | en (default: report locale / <html lang>)
    },
    render: C(build, {
      rebuildOnResize: true,      // label plan and legend placement follow the block size
      on: {
        click: function (p, ctx, inst) {
          var S = inst.__rkTiles;
          if (!S || p.seriesId !== 'tiles' || p.componentType !== 'series') return;
          S.pick([p.dataIndex]);
        }
      }
    })
  });

  var warned = {};

  function build(ctx, inst) {
    var o = ctx.options, t = ctx.theme, enc = ctx.enc;
    var vf = enc.value, idf = enc.id;
    var lang = o.lang === 'en' ? 'en' : 'zh', txt = uiText(o);
    var fmt = o.format || ctx.fmtOf(vf) || 'auto';
    var join = o.join === 'adcode' || o.join === 'name' ? o.join : 'auto';
    var aggFn = RK.expr.agg[o.agg] || RK.expr.agg.sum;
    var ff = o.filterField || idf;

    /* join rows -> provinces */
    function group(rows) {
      var by = {}, miss = [];
      rows.forEach(function (r) {
        var p = resolve(r[idf], join);
        if (!p) { if (r[idf] != null && r[idf] !== '') miss.push(r[idf]); return; }
        (by[p.code] || (by[p.code] = [])).push(r);
      });
      return { by: by, miss: miss };
    }
    var dom = group(G.domainRows(ctx)), cur = group(ctx.rows);
    if (dom.miss.length && !warned[ctx.id]) {
      warned[ctx.id] = true;
      console.warn('[RK] china-tilemap: ' + dom.miss.length + ' row(s) did not match a province (join "' + join + '" on "' + idf + '"):', U.unique(dom.miss).slice(0, 8));
    }
    function valOf(rows) { var v = rows ? aggFn(rows.map(function (r) { return r[vf]; })) : null; return U.isNum(v) ? v : null; }
    var domVals = PROV.map(function (p) { return valOf(dom.by[p.code]); }).filter(U.isNum);
    var scale = buildScale(o, t, domVals, fmt);

    /* per-tile state */
    var sel = ff ? ctx.selected(ff) : [];
    var hl = {};
    [].concat(o.highlight == null ? [] : o.highlight).forEach(function (k) { var p = resolve(k, 'auto'); if (p) hl[p.code] = true; });
    var tiles = PROV.map(function (p) {
      var rows = cur.by[p.code] || null, v = valOf(rows);
      var keys = U.unique((rows || dom.by[p.code] || []).map(function (r) { return r[ff]; }).filter(function (x) { return x != null && x !== ''; }));
      return {
        p: p, rows: rows, v: v, has: v != null, inDomain: !!dom.by[p.code], keys: keys,
        cls: v != null ? scale.classOf(v) : dom.by[p.code] ? -3 : -1,
        base: v != null ? scale.color(v) : dom.by[p.code] ? filteredFill(t) : noDataFill(t),
        sel: sel.length > 0 && keys.some(function (k) { return sel.indexOf(k) >= 0; }), hl: !!hl[p.code]
      };
    });
    var ranked = tiles.filter(function (x) { return x.has; }).sort(function (a, b) { return b.v - a.v; });
    ranked.forEach(function (x, k) { x.rank = k + 1; });
    var valueTexts = tiles.map(function (x) { return x.has ? RK.format(x.v, fmt) : ''; });

    /* layout (memoised per canvas size; renderItem re-derives it after a resize) */
    var lm = o.legend !== false ? legendModel(ctx, scale, tiles, txt) : null;
    var pos = positions(o), frames = {};
    function frameFor(W, H) {
      var k = W + 'x' + H;
      if (!frames[k]) {
        var fr = makeFrame(W, H, o, pos, lm);
        fr.plan = labelPlan(o, t, fr, valueTexts);
        frames[k] = fr;
      }
      return frames[k];
    }
    var F = frameFor(inst.getWidth(), inst.getHeight());

    /* interaction state shared by the tiles, the legend and the click hook */
    var state = { focus: null };
    var data = PROV.map(function (p) { return { name: p.code, value: p.i }; });
    function refocus(cls) {
      if (state.focus === cls) return;
      state.focus = cls;
      inst.dispatchAction({ type: 'downplay', seriesId: 'tiles' });   // drop any hover state before restyling
      inst.setOption({ series: [{ id: 'tiles', data: data }] });
    }
    function pick(indices) {
      if (o.crossFilter === false || !ff) return;
      var keys = U.unique([].concat.apply([], indices.map(function (i) { return tiles[i].keys; })));
      if (!keys.length) return;
      var scope = { scope: G.scopeOf(ctx, ff) };
      if (indices.length === 1 && keys.length === 1) { ctx.select(ff, keys[0], scope); return; }
      var curSel = ctx.selected(ff);
      var same = curSel.length === keys.length && keys.every(function (k) { return curSel.indexOf(k) >= 0; });
      if (indices.length > 1) { ctx.setSelection(ff, same ? [] : keys, scope); return; }
      var all = keys.every(function (k) { return curSel.indexOf(k) >= 0; });
      ctx.setSelection(ff, all ? curSel.filter(function (k) { return keys.indexOf(k) < 0; }) : U.unique(curSel.concat(keys)), scope);
    }
    inst.__rkTiles = { pick: pick };
    var legendOn = {
      focus: refocus,
      pick: function (cls) { pick(tiles.filter(function (x) { return x.has && x.cls === cls; }).map(function (x) { return x.p.i; })); }
    };

    var motion = ctx.motion;
    var radius = U.isNum(+o.radius) ? +o.radius : 2;
    var paper = t.paper, pointer = o.crossFilter !== false && !!ff;
    var hlRing = ringColor(t, tiles), hatch = hatchFill(t);

    function renderItem(params, api) {
      var fr = frameFor(api.getWidth(), api.getHeight());
      var i = params.dataIndex, x = tiles[i], c = fr.centres[i], plan = fr.plan;
      var w = fr.tile;
      var dim = (sel.length > 0 && !x.sel) || (state.focus != null && x.cls !== state.focus);
      var fill = dim ? RK.theme.mix(x.base, paper, x.has ? 0.72 : 0.45) : x.base;
      // near-paper fills (diverging midpoint, lightest class) get a hairline so the tile keeps its edge
      var faint = RK.theme.contrast(fill, paper) < 1.12;
      // selection ring in ink, or in the label colour where ink would vanish (dark tiles in light themes and vice versa)
      var ring = x.sel ? (RK.theme.contrast(fill, t.ink) < 2.5 ? RK.theme.textOn(fill) : t.ink) : null;
      var lw = 2;
      var on = RK.theme.textOn(fill);
      var ink = !x.has ? t.ink3 : dim ? RK.theme.mix(on, fill, 0.4) : on;
      var delay = motion ? Math.round((c[0] / fr.gw) * 420 + (c[1] / fr.gh) * 180) : 0;
      var enter = { enterFrom: { style: { opacity: 0 } }, enterAnimation: { delay: delay, duration: 520 } };
      var shape, ringShape, haloShape, markShape;
      // grow / shrink the tile outline by e px (hexagon: apothem offset)
      function outline(e) {
        if (fr.hex) return { type: 'polygon', shape: { points: hexPoints(w / SQRT3 + e * 2 / SQRT3) } };
        return { type: 'rect', shape: { x: -w / 2 - e, y: -w / 2 - e, width: w + 2 * e, height: w + 2 * e, r: Math.max(0, radius + e) } };
      }
      shape = outline(0);
      ringShape = outline(-lw * (fr.hex ? 0.6 : 0.5));
      haloShape = outline(1.25);
      markShape = outline(3.5);
      var kids = [
        U.merge(shape, {
          style: { fill: !x.inDomain && !dim ? hatch : fill, stroke: faint || !x.inDomain ? RK.theme.mix(fill, t.ink, 0.16) : fill, lineWidth: faint || !x.inDomain ? 0.8 : 0 },
          cursor: pointer ? 'pointer' : 'default', transition: ['shape', 'style'],
          // hover: crisp ink outline, same fill (no ECharts colour lift)
          emphasis: { style: { fill: !x.inDomain && !dim ? hatch : fill, stroke: t.ink, lineWidth: 1.5 } }
        }, enter),
        U.merge(ringShape, {
          silent: true, transition: ['shape', 'style'],
          style: { fill: 'none', stroke: ring || fill, lineWidth: lw, opacity: ring ? 1 : 0 }
        }, enter),
        // highlighted (target / top-N) tiles: a 2px ring outside the tile on a paper halo, above the neighbouring tiles,
        // so it reads on any fill (gold on a pale tile, navy on a dark one)
        U.merge(haloShape, { silent: true, z2: 5, style: { fill: 'none', stroke: paper, lineWidth: 2.5, opacity: x.hl ? 1 : 0 } }, enter),
        U.merge(markShape, { silent: true, z2: 6, style: { fill: 'none', stroke: hlRing, lineWidth: 2, opacity: x.hl ? (dim ? 0.45 : 1) : 0 } }, enter)
      ];
      if (plan.names) {
        var nl = plan.names[i].indexOf('\n') > 0 ? 2 : 1;
        var both = plan.values, hN = plan.fName * 1.18 * nl, hV = plan.fValue * 1.18, tot = both ? hN + hV : hN;
        kids.push(U.merge({
          type: 'text', silent: true, x: 0, y: -tot / 2 + hN / 2, transition: ['style', 'y'],
          style: { text: plan.names[i], fill: ink, font: (x.hl || x.sel ? '700 ' : '600 ') + plan.fName + 'px ' + t.fontSans,
            lineHeight: Math.round(plan.fName * 1.18), align: 'center', verticalAlign: 'middle' }
        }, enter));
        kids.push(U.merge({
          type: 'text', silent: true, x: 0, y: tot / 2 - hV / 2, transition: ['style', 'y'],
          style: { text: both ? valueTexts[i] : '', fill: ink, font: '500 ' + plan.fValue + 'px ' + t.fontNum, align: 'center', verticalAlign: 'middle', opacity: both ? 0.92 : 0 }
        }, enter));
      }
      return {
        type: 'group', x: fr.ox + c[0], y: fr.oy + c[1], transition: ['x', 'y'],
        enterFrom: { scaleX: 0.6, scaleY: 0.6 }, enterAnimation: { delay: delay, duration: 520 },
        children: kids
      };
    }

    /* tooltip: names, value, rank, every other field */
    function tipFields() {
      var fields = ctx.dataset ? ctx.dataset.fields : [];
      if (Array.isArray(o.tooltip)) return o.tooltip.map(function (n) { return ctx.field(n) || { name: n, title: n }; });
      return fields.filter(function (f) { return f.name !== vf; });
    }
    var extra = tipFields();
    function cell(x, f) {
      var rows = x.rows || [];
      var vs = rows.map(function (r) { return r[f.name]; }).filter(function (v) { return v != null && v !== ''; });
      if (!vs.length) return null;
      if (f.type === 'number' && vs.length > 1) return RK.format(ratioLike(f) ? RK.expr.agg.avg(vs) : RK.expr.agg.sum(vs), f.format);
      var u = U.unique(vs);
      return u.length > 3 ? u.length + ' ' + txt.values : u.map(function (v) { return RK.format(v, f.format); }).join(', ');
    }
    function tooltip(p) {
      if (p.seriesId !== 'tiles' || p.dataIndex == null) return '';
      var x = tiles[p.dataIndex], pr = x.p;
      var title = lang === 'zh' ? pr.zh + '  ' + pr.en : pr.en + '  ' + pr.zh;
      var aggLab = x.rows && x.rows.length > 1 ? ' (' + (!o.agg || o.agg === 'sum' ? txt.sum : /^(avg|mean|average)$/.test(o.agg) ? txt.avg : o.agg) + ')' : '';
      var rows = [{ color: x.has ? x.base : null, label: ctx.title(vf) + aggLab, value: x.has ? RK.format(x.v, fmt) : RK.format(null, fmt) }];
      if (x.has) rows.push({ label: txt.rank, value: x.rank + ' / ' + ranked.length });
      if (x.rows && x.rows.length) {
        extra.forEach(function (f) {
          // skip identity columns (province name / code fields) already in the title
          if ((f.type === 'string' || !f.type) && x.rows.every(function (r) { return resolve(r[f.name], 'auto') === pr; })) return;
          var v = cell(x, f), multi = f.type === 'number' && x.rows.length > 1;
          if (v != null) rows.push({ label: (f.title || f.name) + (multi ? ' (' + (ratioLike(f) ? txt.avg : txt.sum) + ')' : ''), value: v });
        });
      }
      var foot = 'CN-' + pr.code + ' · ' + pr.adcode + (x.rows && x.rows.length > 1 ? ' · ' + x.rows.length + ' ' + txt.rows : '');
      if (!x.has) foot = (x.inDomain ? txt.filtered : txt.noData) + ' · ' + foot;
      return C.tip(title, rows, foot);
    }

    var opt = {
      tooltip: { show: o.tooltip !== false, trigger: 'item', confine: true, formatter: tooltip },
      series: [{
        id: 'tiles', type: 'custom', coordinateSystem: 'none', data: data, renderItem: renderItem,
        animationDurationUpdate: 650, animationEasingUpdate: 'cubicInOut', selectedMode: false,
        // instant hover states: an animated state-leave would land after a legend-focus restyle and restore a stale fill
        stateAnimation: { duration: 0 }
      }],
      graphic: { elements: [] }
    };
    if (lm && F.legend !== 'none') {
      opt.graphic.elements.push(legendGraphic(ctx, lm, F.lx, F.ly, F.flow, legendOn));
    }
    var note = o.note === true ? txt.note : typeof o.note === 'string' && o.note ? o.note : null;
    var noteEl = note ? noteGraphic(t, F, note) : null;
    if (noteEl) opt.graphic.elements.push(noteEl);
    return opt;
  }

  /* exposed for tests / other components (e.g. a province bar chart sharing the same keys) */
  RK.chinaTiles = {
    provinces: PROV.map(function (p) { return { code: p.code, adcode: p.adcode, zh: p.zh, zhFull: p.zhFull, abbr: p.abbr, en: p.en, row: p.row, col: p.col }; }),
    resolve: function (v, join) { var p = resolve(v, join || 'auto'); return p ? { code: p.code, adcode: p.adcode, zh: p.zh, en: p.en } : null; }
  };
})();
