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
  var SLOT = /(\d+)/g;
  var TONES = { accent: '--rk-accent', accent2: '--rk-accent-2', accent3: '--rk-accent-3', pos: '--rk-pos', neg: '--rk-neg', neutral: '--rk-ink-3' };

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
      /** Placeholder as escaped HTML; numbers get .is-num (lining figures, no line break). */
      html: function (inner) {
        var p = splitSpec(inner), r = resolve(p[0]);
        return '<span class="rk-text__v' + (typeof r.value === 'number' ? ' is-num' : '') + '">' + esc(RK.format(r.value, p[1] || r.format || null)) + '</span>';
      }
    };
  }

  /* ------------------------------------------------------------------ *
   * Safe markdown subset: **bold**, *italic*, "- " bullets, "1. " numbered lists, line breaks,
   * blank line = new paragraph. Everything else is escaped. Placeholders are filled last, escaped.
   * ------------------------------------------------------------------ */
  function inline(s) {
    return esc(s)
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*(?=\S)([^*]*?\S)\*(?!\*)/g, '$1<em>$2</em>');
  }

  function markdown(src, bind, opts) {
    var slots = [];
    src = String(src == null ? '' : src).replace(PH, function (_, inner) { slots.push(inner); return '' + (slots.length - 1) + ''; });
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
    return out.join('').replace(SLOT, function (_, i) { return bind.html(slots[+i]); });
  }

  /** Author HTML (options.html): strip scripts / handlers / javascript: URLs, then fill placeholders. */
  function safeHTML(html, bind) {
    var tpl = document.createElement('template');
    tpl.innerHTML = String(html || '');
    RK.util.qsa('script, style, iframe, object, embed, link, meta, base, form', tpl.content).forEach(function (n) { n.remove(); });
    RK.util.qsa('*', tpl.content).forEach(function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (a) {
        if (/^on/i.test(a.name) || (/^(href|src|xlink:href|action|formaction)$/i.test(a.name) && /^\s*(javascript|data|vbscript):/i.test(a.value))) el.removeAttribute(a.name);
      });
    });
    return tpl.innerHTML.replace(PH, function (_, inner) { return bind.html(inner); });
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
        style: o.columns > 1 ? { '--rk-text-cols': o.columns } : null,
        html: richText(o, bind)
      });
      if (o.columns > 1) el.classList.add('rk-text--cols');
      return el;
    },

    takeaways: function (ctx, bind) {
      var o = ctx.options;
      var list = h('ol.rk-text.rk-text--takeaways', {
        class: 'rk-tk--' + (o.layout === 'list' ? 'list' : 'grid'),
        style: o.columns ? { '--rk-text-cols': o.columns } : null
      });
      itemsOf(ctx).forEach(function (it, i) {
        list.appendChild(h('li.rk-tk', { style: { '--rk-i': i } },
          o.numbered !== false ? h('span.rk-tk__num', { 'aria-hidden': 'true' }, pad2(i + 1)) : null,
          h('div.rk-tk__body',
            it.title != null ? h('h4.rk-tk__title', { html: markdown(it.title, bind, { inlineOnly: true }) }) : null,
            it.text != null ? h('div.rk-tk__text.rk-prose', { html: markdown(it.text, bind) }) : null)));
      });
      return list;
    },

    callout: function (ctx, bind) {
      var o = ctx.options;
      return h('aside.rk-text.rk-text--callout', { style: { '--rk-tone': 'var(' + (TONES[o.tone] || TONES.accent) + ')' } },
        o.kicker ? h('div.rk-callout__kicker', o.kicker) : null,
        o.title ? h('div.rk-callout__title', { html: markdown(o.title, bind, { inlineOnly: true }) }) : null,
        h('div.rk-callout__body.rk-prose', { html: richText(o, bind) }));
    },

    quote: function (ctx, bind) {
      var o = ctx.options;
      return h('blockquote.rk-text.rk-text--quote',
        h('span.rk-quote__mark', { 'aria-hidden': 'true' }, '“'),
        h('div.rk-quote__text', { html: richText(o, bind) }),
        (o.attribution || o.role) ? h('footer.rk-quote__by',
          o.attribution ? h('span.rk-quote__name', markdownInline(o.attribution, bind)) : null,
          o.role ? h('span.rk-quote__role', markdownInline(o.role, bind)) : null) : null);
    },

    stats: function (ctx, bind, prev) {
      var o = ctx.options;
      var grid = h('div.rk-text.rk-text--stats', { style: o.columns ? { '--rk-text-cols': o.columns } : null });
      var next = {};
      itemsOf(ctx).forEach(function (it, i) {
        var sv = statValue(it, bind);
        var valueEl = h('div.rk-stat__value.rk-num', { style: it.tone && TONES[it.tone] ? { color: 'var(' + TONES[it.tone] + ')' } : null });
        grid.appendChild(h('div.rk-stat', { style: { '--rk-i': i } },
          valueEl,
          it.label != null ? h('div.rk-stat__label', { html: markdown(it.label, bind, { inlineOnly: true }) }) : null,
          it.note != null ? h('div.rk-stat__note', { html: markdown(it.note, bind, { inlineOnly: true }) }) : null));
        var key = (it.label || '') + '#' + i;
        if (sv.text) { valueEl.textContent = sv.value; return; }
        next[key] = sv.value;
        var from = prev && RK.util.isNum(prev[key]) ? prev[key] : 0;
        RK.motion.countUp(valueEl, sv.value, { format: sv.format, from: from, duration: prev ? 700 : 1100, animate: o.countUp !== false && ctx.motion });
      });
      grid._rkValues = next;
      return grid;
    }
  };

  function markdownInline(s, bind) {
    return h('span', { html: markdown(s, bind, { inlineOnly: true }) });
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
        root.innerHTML = '';
        root.appendChild(node);
      }
      build(ctx);

      // needsData:false blocks are not refreshed by the runtime on filter / param changes; do it here
      function usesParams() { return /\{\{\s*[^}]*@/.test(JSON.stringify([ctx.options.text, ctx.options.html, ctx.options.items, ctx.options.title, ctx.options.attribution, ctx.options.role])); }
      function refresh() { var b = ctx.block && ctx.block.rkBlock; if (b) b.refresh(); }
      if (ctx.dataset) offData = RK.bus.on('data:changed', function (p) { if (!p || !p.dataset || p.dataset === ctx.dataset.id) refresh(); });

      return {
        update: build,
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
