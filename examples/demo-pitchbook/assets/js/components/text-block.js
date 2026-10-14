/*!
 * RK component: text-block — narrative blocks for pitchbook pages: prose (safe markdown subset),
 * numbered key takeaways, callout box, pull quote and big-number stats with count-up.
 * Pure DOM, no chart engine. Works without data; when a dataset is bound, "{{field|format}}"
 * placeholders in any text are filled from the selected row (see fill() below).
 *
 *   Placeholders:  {{ev}}                    field of the selected row, formatted with the field format
 *                  {{ev_ebitda_25e|0.0x}}    explicit RK.format code / preset after "|"
 *                  {{median(ev_ebitda_25e)}} RK.expr aggregate over all (filtered) rows
 *                  {{@wacc|0.0%}}            report parameter (what-if sliders)
 *   Row:           options.row = 0 (index) or an RK.expr predicate, e.g. "is_target" -> first match
 */
(function () {
  'use strict';
  var h = RK.util.h, esc = RK.util.escapeHTML;

  var PH = /\{\{\s*([^{}]+?)\s*\}\}/g;
  var TONES = { accent: '--rk-accent', accent2: '--rk-accent-2', accent3: '--rk-accent-3', pos: '--rk-pos', neg: '--rk-neg', neutral: '--rk-ink-3' };
  var TONE_INK = { accent2: '--rk-accent-2-ink' };   // text in a tone uses its text-safe variant

  /* ------------------------------------------------------------------ *
   * Data binding
   * ------------------------------------------------------------------ */

  /** "expr|format" -> [expr, format]. A "||" (logical or) stays part of the expression. */
  function splitSpec(s) {
    for (var i = s.length - 1; i >= 0; i--) {
      if (s[i] === '|' && s[i - 1] !== '|' && s[i + 1] !== '|') return [s.slice(0, i).trim(), s.slice(i + 1).trim() || null];
    }
    return [s.trim(), null];
  }

  /** Row used for plain field placeholders: options.row index, or the first row matching an expression. */
  function pickRow(ctx) {
    var rows = ctx.rows, sel = ctx.options.row;
    if (!rows.length) return null;
    if (typeof sel === 'string' && sel.trim()) {
      try {
        var c = RK.expr.compile(sel, { fields: ctx.dataset.fields }), env = { params: RK.store.params() };
        for (var i = 0; i < rows.length; i++) if (c.eval(rows[i], env)) return rows[i];
      } catch (e) { console.warn('[RK] text-block: bad "row" expression', e.message); }
      return null;
    }
    return rows[Math.max(0, Math.min(rows.length - 1, +sel || 0))] || null;
  }

  /** Resolver for one render: resolve(src) -> {value, format}; text(src) -> formatted string. */
  function binder(ctx) {
    var ds = ctx.dataset, row = ds ? pickRow(ctx) : null;
    var env = { params: RK.store.params() };
    var paramDefs = (RK.data.manifest && RK.data.manifest.params) || {};
    var warned = {};
    function resolve(src) {
      var name = src.replace(/^`|`$/g, '');
      if (ds && ds.has(name)) return { value: row ? row[name] : null, format: ds.format(name) };
      var pm = src.match(/^@([A-Za-z_]\w*)$/);
      if (pm) return { value: env.params[pm[1]], format: paramDefs[pm[1]] && paramDefs[pm[1]].format };
      try {
        var c = RK.expr.compile(src, ds ? { fields: ds.fields } : {});
        var v = c.aggregate ? c.eval(ctx.rows, env) : (row ? c.eval(row, env) : null);
        // a single-field expression (median(x), x * 1.1) inherits that field's format
        return { value: v, format: ds && c.fields.length === 1 ? ds.format(c.fields[0]) : null };
      } catch (e) {
        if (!warned[src]) { warned[src] = 1; console.warn('[RK] text-block: cannot resolve {{' + src + '}}:', e.message); }
        return { value: null, format: null };
      }
    }
    return {
      row: row,
      resolve: resolve,
      text: function (inner) {
        var p = splitSpec(inner), r = resolve(p[0]);
        return RK.format(r.value, p[1] || r.format || null);
      },
      /** Placeholder as a text node in a span; numbers get .is-num (lining figures, no line break). */
      node: function (inner) {
        var p = splitSpec(inner), r = resolve(p[0]);
        return h('span.rk-text__v' + (typeof r.value === 'number' ? '.is-num' : ''), RK.format(r.value, p[1] || r.format || null));
      }
    };
  }

  /* ------------------------------------------------------------------ *
   * Safe markdown subset: **bold**, *italic*, `code`, "- " bullets, "1. " numbered lists, line breaks,
   * blank line = new paragraph. Everything else is escaped. The result is parsed into DOM nodes and
   * placeholders become <span> nodes filled with textContent (no data ever reaches innerHTML).
   * ------------------------------------------------------------------ */
  var SL = '\uE000', SR = '\uE001';                 // private-use slot markers (stripped from input first)
  var SLOT_RE = /\uE000(\d+)\uE001/g;

  function inline(s) {
    // `code` spans are cut out first so * inside them stays literal
    return String(s).split(/(`[^`\n]+`)/).map(function (part, k) {
      if (k % 2) return '<code>' + esc(part.slice(1, -1)) + '</code>';
      return esc(part)
        .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*\w])\*(?=\S)([^*]*?\S)\*(?!\*)/g, '$1<em>$2</em>');
    }).join('');
  }

  /** Markdown -> DocumentFragment. Placeholders are cut into slots before parsing so markdown never touches them. */
  function markdown(src, bind, opts) {
    var slots = [];
    src = String(src == null ? '' : src).replace(/[\uE000\uE001]/g, '')
      .replace(PH, function (_, inner) { slots.push(inner); return SL + (slots.length - 1) + SR; });
    var out = [], para = [], list = null;
    function flushPara() {
      if (!para.length) return;
      out.push(opts && opts.inlineOnly ? para.map(inline).join('<br>') : '<p>' + para.map(inline).join('<br>') + '</p>');
      para = [];
    }
    function flushList() {
      if (!list) return;
      out.push('<' + list.tag + (list.start > 1 ? ' start="' + list.start + '"' : '') + '>' +
        list.items.map(function (li) { return '<li>' + inline(li).replace(/\n/g, '<br>') + '</li>'; }).join('') + '</' + list.tag + '>');
      list = null;
    }
    src.replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
      var m;
      if (/^\s*$/.test(line)) { flushPara(); flushList(); return; }
      if ((m = line.match(/^\s*[-•]\s+(.*)$/))) {
        flushPara();
        if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; }
        list.items.push(m[1]);
        return;
      }
      if ((m = line.match(/^\s*(\d{1,3})[.)]\s+(.*)$/))) {
        flushPara();
        if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [], start: +m[1] }; }
        list.items.push(m[2]);
        return;
      }
      if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1] += '\n' + line.trim(); return; }   // wrapped list item
      flushList();
      para.push(line.trim());
    });
    flushPara(); flushList();
    var fragment = parse(out.join(''));          // our own markup over escaped text; sanitised anyway
    fillText(fragment, SLOT_RE, function (m) { var inner = slots[+m[1]]; return inner == null ? null : bind.node(inner); });
    return fragment;
  }

  /* ---- allowlist sanitiser for options.html (author HTML) ---- */
  var ALLOW_TAGS = toSet('p br hr strong b em i u s del ins sub sup small mark abbr cite q code kbd samp pre span div blockquote ' +
    'ul ol li dl dt dd h1 h2 h3 h4 h5 h6 table thead tbody tfoot tr th td caption colgroup col a img figure figcaption');
  // removed together with their content (active content, embedded documents, foreign markup, forms, media)
  var DROP_TAGS = toSet('script style template iframe frame frameset object embed applet noscript noembed noframes textarea select ' +
    'option optgroup button input form fieldset legend label datalist output link meta base title svg math canvas video audio ' +
    'source track picture portal xmp plaintext listing param slot dialog head');
  var GLOBAL_ATTRS = toSet('class title lang dir');
  var TAG_ATTRS = { a: toSet('href'), img: toSet('src alt width height'), ol: toSet('start type reversed'), li: toSet('value'),
    td: toSet('colspan rowspan'), th: toSet('colspan rowspan scope'), col: toSet('span'), colgroup: toSet('span') };
  var STYLE_PROPS = toSet('text-align font-weight font-style text-decoration vertical-align white-space color background-color');
  var HTML_NS = 'http://www.w3.org/1999/xhtml';
  function toSet(list) { var o = {}; list.split(/\s+/).forEach(function (k) { o[k] = true; }); return o; }

  /**
   * URL allowed for href / img src? Browsers drop ASCII tab / newline anywhere and C0 controls + space at
   * the ends, so the scheme is checked on that normalised form. Links: http(s), mailto, #fragment or
   * relative. Images: relative paths or inline data:image (no remote fetches: reports stay offline).
   */
  function safeUrl(v, img) {
    var low = String(v).replace(/[\u0000- \u007f-\u009f]+/g, '').toLowerCase();
    var scheme = /^[a-z][a-z0-9+.\-]*:/.test(low);
    if (img) {
      if (/^data:image\/(png|gif|jpe?g|webp);base64,[a-z0-9+\/=]+$/.test(low)) return true;
      return !scheme && !/^[\/\\]{2}/.test(low);
    }
    if (/^(https?:|mailto:)/.test(low) || low.charAt(0) === '#') return true;
    return !scheme;
  }

  /** Keep only allowlisted style properties whose values cannot load anything. */
  function safeStyle(v) {
    return String(v).split(';').map(function (decl) {
      var k = decl.indexOf(':');
      if (k < 0) return null;
      var prop = decl.slice(0, k).trim().toLowerCase(), val = decl.slice(k + 1).trim();
      if (!STYLE_PROPS[prop] || !val || /url|expression|image|import|\\|[<>"]/i.test(val)) return null;
      return prop + ': ' + val;
    }).filter(Boolean).join('; ');
  }

  /** Sanitise the children of `node` in place (inert template document: nothing loads or runs meanwhile). */
  function sanitize(node) {
    Array.prototype.slice.call(node.childNodes).forEach(function (ch) {
      if (ch.nodeType === 3) return;
      if (ch.nodeType !== 1) { node.removeChild(ch); return; }
      var tag = String(ch.localName || '').toLowerCase();
      if (ch.namespaceURI !== HTML_NS || DROP_TAGS[tag]) { node.removeChild(ch); return; }
      sanitize(ch);
      if (!ALLOW_TAGS[tag]) {                    // unknown wrapper (font, center …): keep its content only
        while (ch.firstChild) node.insertBefore(ch.firstChild, ch);
        node.removeChild(ch);
        return;
      }
      Array.prototype.slice.call(ch.attributes).forEach(function (a) {
        var name = a.name.toLowerCase(), ok = GLOBAL_ATTRS[name] || (TAG_ATTRS[tag] && TAG_ATTRS[tag][name]);
        if (name === 'style') {
          var st = safeStyle(a.value);
          if (st) ch.setAttribute('style', st); else ch.removeAttribute(a.name);
          return;
        }
        if (!ok) { ch.removeAttribute(a.name); return; }
        if ((name === 'href' || name === 'src') && !safeUrl(a.value, name === 'src')) ch.removeAttribute(a.name);
      });
      if (tag === 'img' && !ch.hasAttribute('src')) { node.removeChild(ch); return; }
      if (tag === 'a' && ch.hasAttribute('href')) ch.setAttribute('rel', 'noopener noreferrer');
    });
  }

  /** HTML string -> sanitised DocumentFragment owned by this document. */
  function parse(html) {
    var tpl = document.createElement('template');
    tpl.innerHTML = String(html == null ? '' : html);
    sanitize(tpl.content);                       // before import: inert template content never fetches or runs
    return document.importNode(tpl.content, true);
  }

  /**
   * Replace matches of re in the fragment's text nodes with nodes from make(match) (null drops the match).
   * Placeholders are only ever filled here, in text — never inside attribute values or serialised HTML.
   */
  function fillText(root, re, make) {
    var walker = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */), list = [], n;
    while ((n = walker.nextNode())) { re.lastIndex = 0; if (re.test(n.nodeValue)) list.push(n); }
    list.forEach(function (node) {
      var s = node.nodeValue, out = document.createDocumentFragment(), last = 0, m;
      re.lastIndex = 0;
      while ((m = re.exec(s))) {
        if (m.index > last) out.appendChild(document.createTextNode(s.slice(last, m.index)));
        var made = make(m);
        if (made) out.appendChild(made);
        last = m.index + m[0].length;
      }
      if (last < s.length) out.appendChild(document.createTextNode(s.slice(last)));
      node.parentNode.replaceChild(out, node);
    });
  }

  /** Author HTML (options.html): allowlist-sanitised, then placeholders filled in text nodes. */
  function safeHTML(html, bind) {
    var fragment = parse(String(html == null ? '' : html).replace(/[\uE000\uE001]/g, ''));
    fillText(fragment, new RegExp(PH.source, 'g'), function (m) { return bind.node(m[1]); });
    return fragment;
  }

  function richText(o, bind) {
    return o.html != null ? safeHTML(o.html, bind) : markdown(o.text, bind);
  }

  /* ------------------------------------------------------------------ *
   * Items (takeaways / stats): options.items, or one item per bound row via encode
   * ------------------------------------------------------------------ */
  function itemsOf(ctx) {
    var o = ctx.options, enc = ctx.enc;
    if (Array.isArray(o.items) && o.items.length) return o.items;
    if (!ctx.dataset) return [];
    return ctx.rows.map(function (r) {
      var it = {};
      ['title', 'text', 'value', 'label', 'format', 'note'].forEach(function (k) {
        if (enc[k] && r[enc[k]] !== undefined) it[k] = r[enc[k]];
      });
      if (it.format == null && enc.value) it.format = ctx.fmtOf(enc.value);
      return it;
    });
  }

  /** Numeric value + format of a stats item: value (number or "{{...}}"), field, or expr. */
  function statValue(it, bind) {
    var src = it.field || it.expr || null;
    if (src == null && typeof it.value === 'string') {
      var m = it.value.match(/^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/);
      if (m) { var p = splitSpec(m[1]); src = p[0]; if (!it.format && p[1]) it = RK.util.merge({}, it, { format: p[1] }); }
      else return { value: it.value, format: it.format, text: true };   // literal text such as "#1"
    }
    if (src != null) {
      var r = bind.resolve(src);
      return { value: r.value, format: it.format || r.format || 'auto' };
    }
    return { value: it.value, format: it.format || 'auto' };
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  /* ------------------------------------------------------------------ *
   * Variants
   * ------------------------------------------------------------------ */
  var VARIANTS = {
    prose: function (ctx, bind) {
      var o = ctx.options;
      var el = h('div.rk-text.rk-prose.rk-text--prose', {
        class: [o.lead ? 'rk-text--lead' : '', o.size && o.size !== 'base' ? 'rk-text--' + o.size : ''].join(' '),
        style: o.columns > 1 ? { '--rk-text-cols': String(o.columns) } : null
      }, richText(o, bind));
      if (o.columns > 1) el.classList.add('rk-text--cols');
      return el;
    },

    takeaways: function (ctx, bind) {
      var o = ctx.options;
      var list = h('ol.rk-text.rk-text--takeaways', { class: 'rk-tk--' + (o.layout === 'list' ? 'list' : 'grid') });
      list._rkMinW = 190;
      itemsOf(ctx).forEach(function (it, i) {
        list.appendChild(h('li.rk-tk', { style: { '--rk-i': String(i) } },
          o.numbered !== false ? h('span.rk-tk__num', { 'aria-hidden': 'true' }, pad2(i + 1)) : null,
          h('div.rk-tk__body',
            it.title != null ? h('h4.rk-tk__title', markdown(it.title, bind, { inlineOnly: true })) : null,
            it.text != null ? h('div.rk-tk__text.rk-prose', markdown(it.text, bind)) : null)));
      });
      return list;
    },

    callout: function (ctx, bind) {
      var o = ctx.options;
      return h('aside.rk-text.rk-text--callout', { style: { '--rk-tone': 'var(' + (TONES[o.tone] || TONES.accent) + ')', '--rk-tone-ink': 'var(' + (TONE_INK[o.tone] || TONES[o.tone] || TONES.accent) + ')' } },
        o.kicker ? h('div.rk-callout__kicker', String(o.kicker)) : null,
        o.title ? h('div.rk-callout__title', markdown(o.title, bind, { inlineOnly: true })) : null,
        h('div.rk-callout__body.rk-prose', richText(o, bind)));
    },

    quote: function (ctx, bind) {
      var o = ctx.options;
      return h('blockquote.rk-text.rk-text--quote',
        h('span.rk-quote__mark', { 'aria-hidden': 'true' }, '“'),
        h('div.rk-quote__text', richText(o, bind)),
        (o.attribution || o.role) ? h('footer.rk-quote__by',
          o.attribution ? h('span.rk-quote__name', markdownInline(o.attribution, bind)) : null,
          o.role ? h('span.rk-quote__role', markdownInline(o.role, bind)) : null) : null);
    },

    stats: function (ctx, bind, prev) {
      var o = ctx.options;
      var grid = h('div.rk-text.rk-text--stats');
      grid._rkMinW = 140;
      var next = {};
      itemsOf(ctx).forEach(function (it, i) {
        var sv = statValue(it, bind);
        // value text in a tone: the text-safe ink variant (accent2 -> accent2-ink)
        var tone = it.tone && TONES[it.tone] ? (TONE_INK[it.tone] || TONES[it.tone]) : null;
        var valueEl = h('div.rk-stat__value.rk-num', { style: tone ? { color: 'var(' + tone + ')' } : null });
        grid.appendChild(h('div.rk-stat', { style: { '--rk-i': String(i) } },
          valueEl,
          it.label != null ? h('div.rk-stat__label', markdown(it.label, bind, { inlineOnly: true })) : null,
          it.note != null ? h('div.rk-stat__note', markdown(it.note, bind, { inlineOnly: true })) : null));
        var key = (it.label || '') + '#' + i;
        if (sv.text) { valueEl.textContent = sv.value == null ? '' : String(sv.value); return; }
        next[key] = sv.value;
        var from = prev && RK.util.isNum(prev[key]) ? prev[key] : 0;
        RK.motion.countUp(valueEl, sv.value, { format: sv.format, from: from, duration: prev ? 700 : 1100, animate: o.countUp !== false && ctx.motion });
      });
      grid._rkValues = next;
      return grid;
    }
  };

  function markdownInline(s, bind) {
    return h('span', markdown(s, bind, { inlineOnly: true }));
  }

  /** Balanced column count: as many as fit (>= minW px), rows evened out (4 -> 2 x 2, 5 -> 3 + 2, 6 -> 3 x 2). */
  function balancedCols(n, width, minW) {
    var fit = Math.max(1, Math.floor((width + 1) / minW));
    if (n <= fit) return Math.max(1, n);
    return Math.ceil(n / Math.ceil(n / fit));
  }

  /** Card grids (takeaways grid, stats): column count + row-start / next-row classes for the rules. */
  function layoutGrid(node, ctx) {
    if (!node || !node._rkMinW || node.classList.contains('rk-tk--list')) return;
    var o = ctx.options, kids = node.children, n = kids.length;
    var cols = o.columns ? Math.max(1, +o.columns) : balancedCols(n, ctx.el.clientWidth || node.clientWidth || 900, node._rkMinW);
    node.style.setProperty('--rk-text-cols', String(cols));
    node.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0, 1fr))';
    for (var i = 0; i < n; i++) {
      kids[i].classList.toggle('is-row-start', i % cols === 0);
      kids[i].classList.toggle('is-next-row', i >= cols);
    }
  }

  /* ------------------------------------------------------------------ *
   * Component
   * ------------------------------------------------------------------ */
  RK.component({
    id: 'text-block',
    deps: [],
    needsData: false,
    defaults: {
      variant: 'prose',      // prose | takeaways | callout | quote | stats
      text: null,            // markdown subset (prose / callout / quote)
      html: null,            // trusted author HTML (sanitised); wins over text
      items: null,           // takeaways [{title, text}] | stats [{value|field|expr, format, label, note, tone}]
      encode: { title: 'title', text: 'text', value: 'value', label: 'label', format: 'format', note: 'note' },
      row: 0,                // bound row for {{field}}: index or RK.expr predicate ("is_target")
      title: null,           // callout heading
      kicker: null,          // callout small-caps label above the heading
      tone: 'accent',        // callout rule colour: accent | accent2 | accent3 | pos | neg | neutral
      attribution: null,     // quote: speaker name
      role: null,            // quote: speaker title / organisation / source
      columns: null,         // prose: CSS text columns; takeaways / stats: fixed grid columns
      layout: 'grid',        // takeaways: grid | list
      numbered: true,        // takeaways: large serif numerals
      lead: false,           // prose: first paragraph set as a larger serif lead-in
      size: 'base',          // prose: sm | base | lg
      countUp: true,         // stats: animate numbers on reveal / update
      tools: false           // no chart toolbar on narrative blocks
    },
    render: function (ctx) {
      var root = h('div.rk-text-host');
      var prevValues = null, offData = null;
      ctx.el.classList.add('is-auto');
      ctx.el.appendChild(root);

      function build(c) {
        ctx = c;
        var bind = binder(c);
        var make = VARIANTS[c.options.variant] || VARIANTS.prose;
        var node = make(c, bind, prevValues);
        if (!c.motion) node.classList.add('is-static');
        prevValues = node._rkValues || null;
        root.textContent = '';
        root.appendChild(node);
        layoutGrid(node, c);
      }
      build(ctx);

      // needsData:false blocks are not refreshed by the runtime on filter / param changes; do it here
      function usesParams() { return /\{\{\s*[^}]*@/.test(JSON.stringify([ctx.options.text, ctx.options.html, ctx.options.items, ctx.options.title, ctx.options.attribution, ctx.options.role])); }
      function refresh() { var b = ctx.block && ctx.block.rkBlock; if (b) b.refresh(); }
      if (ctx.dataset) offData = RK.bus.on('data:changed', function (p) { if (!p || !p.dataset || p.dataset === ctx.dataset.id) refresh(); });

      return {
        update: build,
        resize: function () { layoutGrid(root.firstChild, ctx); },
        onStore: function (changes) {
          var hit = ctx.dataset && RK.data.affected(ctx.dataset, changes);
          if (!hit && usesParams()) hit = changes.some(function (ch) { return ch.type === 'param'; });
          if (hit) refresh();
        },
        destroy: function () {
          if (offData) offData();
          root.remove();
          ctx.el.classList.remove('is-auto');
        }
      };
    }
  });
})();
