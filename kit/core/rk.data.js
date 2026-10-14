/*!
 * ReportKit data — datasets, data sources, global store (filters / params / state),
 * filtering, aggregation and the client query engine.
 *
 * Data contract (one file per dataset, see docs/data-contract.md):
 *   {
 *     "id": "comps",
 *     "title": "Trading comparables",
 *     "schema": { "fields": [ {"name": "company", "type": "string", "title": "Company"},
 *                             {"name": "ev_ebitda_25e", "type": "number", "title": "EV/EBITDA 2025E", "format": "0.0x"} ] },
 *     "data": [ {"company": "Alpha", "ev_ebitda_25e": 8.4}, ... ],          // records (or arrays in field order)
 *     "meta": { "source": "FactSet as of 10-Oct-2026", "unit": "USD m", "notes": ["..."] },
 *     "computed": [ {"name": "margin", "formula": "ebitda / revenue", "format": "0.0%"} ]
 *   }
 *
 * Sources (resolved in this order):
 *   1. RK.data.preload(bundle)  — data/bundle.js written by the Python builder (works from file://)
 *   2. <meta name="rk:data" content="data/"> + fetch(manifest.json)  — when served over http(s)
 *   3. <meta name="rk:data-source" content="api"> + <meta name="rk:api" content="https://host/api/reports/42/">
 *      — future data API: GET {api}manifest, GET {api}datasets/{id}
 *   Custom: RK.data.adapter('name', function (cfg) { return Promise<{manifest, datasets}> })
 */
(function (global) {
  'use strict';
  var RK = global.RK || (global.RK = {});
  var util = RK.util;

  /* ------------------------------------------------------------------ *
   * Dataset
   * ------------------------------------------------------------------ */
  function inferType(rows, name) {
    for (var i = 0; i < Math.min(rows.length, 50); i++) {
      var v = rows[i][name];
      if (v == null || v === '') continue;
      if (typeof v === 'number') return 'number';
      if (typeof v === 'boolean') return 'boolean';
      if (typeof v === 'string' && /^\d{4}-\d{2}(-\d{2})?([T ][\d:.]+Z?)?$/.test(v)) return 'date';
      return 'string';
    }
    return 'string';
  }

  function Dataset(json) {
    json = json || {};
    this.id = json.id;
    this.title = json.title || json.id;
    this.meta = json.meta || {};
    var fields = (json.schema && json.schema.fields) || json.fields || null;
    var data = json.data || json.rows || [];
    // arrays in field order -> records
    if (data.length && Array.isArray(data[0]) && fields) {
      data = data.map(function (arr) {
        var o = {};
        for (var i = 0; i < fields.length; i++) o[fields[i].name] = arr[i];
        return o;
      });
    }
    this.rows = data;
    if (!fields) {
      var names = data.length ? Object.keys(data[0]) : [];
      fields = names.map(function (n) { return { name: n }; });
    }
    this.fields = fields.map(function (f) {
      f = typeof f === 'string' ? { name: f } : util.merge({}, f);
      if (!f.type) f.type = inferType(data, f.name);
      if (!f.title) f.title = f.name;
      return f;
    });
    this._index = Object.create(null);
    var self = this;
    this.fields.forEach(function (f) { self._index[f.name] = f; });
    this.computed = [];
    (json.computed || []).forEach(function (c) { self.addComputed(c, true); });
  }

  Dataset.prototype.field = function (name) { return this._index[name] || null; };
  Dataset.prototype.has = function (name) { return !!this._index[name]; };
  Dataset.prototype.fieldNames = function () { return this.fields.map(function (f) { return f.name; }); };
  Dataset.prototype.values = function (name) { return this.rows.map(function (r) { return r[name]; }); };
  Dataset.prototype.distinct = function (name) { return util.unique(this.values(name).filter(function (v) { return v != null && v !== ''; })); };
  Dataset.prototype.format = function (name) { var f = this._index[name]; return f && f.format; };

  /**
   * Add a derived field computed by an RK.expr formula. Values are materialised on each row and
   * recomputed automatically when a referenced @param changes.
   */
  Dataset.prototype.addComputed = function (spec, silent) {
    var c = RK.expr.compile(spec.formula, { fields: this.fields });
    if (c.aggregate) throw new RK.expr.ExprError('Computed fields must be row formulas (no sum/avg/...)');
    var def = { name: spec.name, title: spec.title || spec.name, type: spec.type || 'number', format: spec.format, formula: spec.formula, computed: true };
    var existing = this._index[def.name];
    if (existing) util.merge(existing, def); else { this.fields.push(def); this._index[def.name] = def; }
    this.computed = this.computed.filter(function (x) { return x.def.name !== def.name; });
    this.computed.push({ def: def, compiled: c });
    this._materialize(def.name);
    if (!silent) RK.bus.emit('data:changed', { dataset: this.id, field: def.name });
    return def;
  };

  Dataset.prototype.removeComputed = function (name) {
    this.computed = this.computed.filter(function (x) { return x.def.name !== name; });
    this.fields = this.fields.filter(function (f) { return f.name !== name; });
    delete this._index[name];
    this.rows.forEach(function (r) { delete r[name]; });
    RK.bus.emit('data:changed', { dataset: this.id, field: name });
  };

  Dataset.prototype._materialize = function (onlyName, paramName) {
    var env = { params: RK.store.params() };
    var rows = this.rows;
    var dirty = {};   // computed fields recomputed in this pass: dependants are recomputed too (definition order)
    this.computed.forEach(function (c) {
      if (onlyName && c.def.name !== onlyName && !c.compiled.fields.some(function (f) { return dirty[f]; })) return;
      if (paramName && c.compiled.params.indexOf(paramName) < 0 && !c.compiled.fields.some(function (f) { return dirty[f]; })) return;
      dirty[c.def.name] = true;
      for (var i = 0; i < rows.length; i++) {
        var v;
        try { v = c.compiled.eval(rows[i], env); } catch (e) { v = null; }
        rows[i][c.def.name] = v;
      }
    });
  };

  Dataset.prototype.usesParam = function (name) {
    return this.computed.some(function (c) { return c.compiled.params.indexOf(name) >= 0; });
  };

  Dataset.prototype.toJSON = function () {
    return { id: this.id, title: this.title, schema: { fields: this.fields }, data: this.rows, meta: this.meta };
  };

  Dataset.prototype.toCSV = function (rows, fields) {
    rows = rows || this.rows;
    fields = fields || this.fields;
    function esc(v) {
      if (v == null) return '';
      var s = String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var lines = [fields.map(function (f) { return esc(f.title || f.name); }).join(',')];
    rows.forEach(function (r) { lines.push(fields.map(function (f) { return esc(r[f.name]); }).join(',')); });
    return '﻿' + lines.join('\n');
  };

  RK.Dataset = Dataset;

  /* ------------------------------------------------------------------ *
   * Store: filters, params, generic state
   * ------------------------------------------------------------------ */
  var store = RK.store = (function () {
    var filters = {}, params = {}, state = {}, subs = [], pending = [], scheduled = false;

    function notify(change) {
      pending.push(change);
      if (scheduled) return;
      scheduled = true;
      Promise.resolve().then(function () {
        var batch = pending; pending = []; scheduled = false;
        subs.slice().forEach(function (fn) {
          try { fn(batch); } catch (e) { console.error('[RK] store subscriber failed', e); }
        });
      });
    }

    return {
      /** spec: {field, op:'in'|'not_in'|'between'|'search'|'expr'|'eq', values|value|min|max|text|expr, source?, datasets?} */
      setFilter: function (key, spec) {
        // spec.allowEmpty: an empty 'in' list means "match nothing" instead of "no filter"
        if (spec && spec.op === 'in' && spec.allowEmpty && (!spec.values || !spec.values.length)) spec.values = [];
        else if (spec == null || (spec.op === 'in' && (!spec.values || !spec.values.length)) ||
            (spec.op === 'search' && !spec.text) || (spec.op === 'expr' && !spec.expr) ||
            (spec.op === 'between' && spec.min == null && spec.max == null)) {
          return store.clearFilter(key);
        }
        if (!spec.field && spec.op !== 'expr' && spec.op !== 'search') spec.field = key;
        if (spec.op === 'expr') {
          try { spec._compiled = RK.expr.compile(spec.expr); } catch (e) { console.warn('[RK] bad filter expression', e.message); return; }
        }
        filters[key] = spec;
        notify({ type: 'filter', key: key, spec: spec });
      },
      clearFilter: function (key) {
        if (!(key in filters)) return;
        var prev = filters[key];
        delete filters[key];
        notify({ type: 'filter', key: key, spec: null, prev: prev });
      },
      clearFilters: function (source) {
        Object.keys(filters).forEach(function (k) { if (!source || filters[k].source === source) store.clearFilter(k); });
      },
      /** toggle a value inside an 'in' filter (used by click-to-filter / cross-filter). */
      toggleValue: function (key, field, value, source, extra) {
        var cur = filters[key];
        var vals = cur && cur.values ? cur.values.slice() : [];
        var i = vals.indexOf(value);
        if (i >= 0) vals.splice(i, 1); else vals.push(value);
        store.setValues(key, field, vals, source, extra);
      },
      /** Replace the whole value list of an 'in' filter (brush / lasso selections). extra: {datasets, either, allowEmpty} */
      setValues: function (key, field, values, source, extra) {
        extra = extra || {};
        if ((!values || !values.length) && !extra.allowEmpty) return store.clearFilter(key);
        var spec;
        if (extra.either) {
          // a node in a link table: match rows where it is on either end (source or target)
          var list = JSON.stringify(values || []);
          spec = { op: 'expr', field: field, values: values, expr: '`' + field + '` in ' + list + ' or `' + extra.either + '` in ' + list };
        } else spec = { field: field, op: 'in', values: values || [], allowEmpty: !!extra.allowEmpty };
        spec.source = source;
        if (extra.datasets) spec.datasets = extra.datasets;
        store.setFilter(key, spec);
      },
      filter: function (key) { return filters[key] || null; },
      filters: function () { return filters; },

      params: function () { return params; },
      param: function (name) { return params[name]; },
      setParam: function (name, value) {
        if (params[name] === value) return;
        params[name] = value;
        RK.data.ids().forEach(function (id) {
          var ds = RK.data.get(id);
          if (ds.usesParam(name)) ds._materialize(null, name);
        });
        notify({ type: 'param', key: name, value: value });
      },
      defineParams: function (defs) {
        Object.keys(defs || {}).forEach(function (k) {
          var d = defs[k];
          params[k] = util.isObj(d) ? d.value : d;
        });
      },

      get: function (k) { return state[k]; },
      set: function (k, v) { if (state[k] === v) return; state[k] = v; notify({ type: 'state', key: k, value: v }); },

      subscribe: function (fn) {
        subs.push(fn);
        return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
      },
      _notify: notify
    };
  })();

  /* ------------------------------------------------------------------ *
   * Filtering
   * ------------------------------------------------------------------ */
  function cmpVal(a, b, type) {
    if (type === 'date') return String(a).localeCompare(String(b));
    return a - b;
  }

  function filterApplies(spec, ds) {
    if (spec.datasets && spec.datasets.indexOf(ds.id) < 0) return false;
    if (spec.op === 'expr') {
      return spec._compiled && spec._compiled.fields.every(function (f) { return ds.has(f); });
    }
    if (spec.op === 'search') return !spec.field || ds.has(spec.field);
    return ds.has(spec.field);
  }

  function makePredicate(spec, ds) {
    var f = spec.field, type = f && ds.field(f) ? ds.field(f).type : null;
    switch (spec.op) {
      case 'in': {
        var set = new Set(spec.values.map(function (v) { return typeof v === 'string' ? v.toLowerCase() : v; }));
        return function (r) { var v = r[f]; return set.has(typeof v === 'string' ? v.toLowerCase() : v); };
      }
      case 'not_in': {
        var nset = new Set(spec.values);
        return function (r) { return !nset.has(r[f]); };
      }
      case 'eq': return function (r) { return r[f] === spec.value; };
      case 'between': return function (r) {
        var v = r[f];
        if (v == null || v === '') return false;
        if (spec.min != null && cmpVal(v, spec.min, type) < 0) return false;
        if (spec.max != null && cmpVal(v, spec.max, type) > 0) return false;
        return true;
      };
      case 'search': {
        var q = String(spec.text).toLowerCase();
        var cols = f ? [f] : ds.fields.filter(function (x) { return x.type === 'string'; }).map(function (x) { return x.name; });
        return function (r) {
          for (var i = 0; i < cols.length; i++) { var v = r[cols[i]]; if (v != null && String(v).toLowerCase().indexOf(q) >= 0) return true; }
          return false;
        };
      }
      case 'expr': {
        var c = spec._compiled, env = { params: store.params() };
        return function (r) { try { return !!c.eval(r, env); } catch (e) { return false; } };
      }
    }
    return function () { return true; };
  }

  /**
   * Rows of a dataset after global filters.
   * opts.exclude: filter source id to ignore (a chart ignores the filter it created itself)
   * opts.ignore:  array of filter keys to ignore; opts.filters === false disables filtering
   * opts.where:   extra RK.expr predicate
   */
  function view(id, opts) {
    opts = opts || {};
    var ds = typeof id === 'string' ? data.get(id) : id;
    if (!ds) return [];
    var rows = ds.rows;
    if (opts.filters !== false) {
      var fs = store.filters();
      var preds = [];
      Object.keys(fs).forEach(function (k) {
        var spec = fs[k];
        if (opts.exclude && spec.source === opts.exclude) return;
        if (opts.ignore && opts.ignore.indexOf(k) >= 0) return;
        if (!filterApplies(spec, ds)) return;
        preds.push(makePredicate(spec, ds));
      });
      if (preds.length) rows = rows.filter(function (r) { for (var i = 0; i < preds.length; i++) if (!preds[i](r)) return false; return true; });
    }
    if (opts.where) {
      var c = RK.expr.compile(opts.where, { fields: ds.fields }), env = { params: store.params() };
      rows = rows.filter(function (r) { return !!c.eval(r, env); });
    }
    return rows;
  }

  /** Does any active filter (or param) affect this dataset? Used to skip needless re-renders. */
  function affected(ds, changes) {
    for (var i = 0; i < changes.length; i++) {
      var ch = changes[i];
      if (ch.type === 'filter') {
        var spec = ch.spec || ch.prev;
        if (!spec) return true;
        if (filterApplies(spec, ds)) return true;
      } else if (ch.type === 'param') {
        if (ds.usesParam(ch.key)) return true;
      } else if (ch.type === 'data') {
        if (!ch.dataset || ch.dataset === ds.id) return true;
      }
    }
    return false;
  }

  /* ------------------------------------------------------------------ *
   * Aggregation
   * ------------------------------------------------------------------ */
  /**
   * aggregate(rows, {by:['sector'], measures:[{name:'med', expr:'median(ev_ebitda_25e)'}], fields})
   * -> array of records {sector, med}
   */
  function aggregate(rows, spec) {
    var by = spec.by || [];
    var measures = (spec.measures || []).map(function (m) {
      var src = m.expr || (m.op ? m.op + '(' + m.field + ')' : m.field);
      return { name: m.name || src, c: RK.expr.compile(src, { fields: spec.fields }) };
    });
    var env = { params: store.params() };
    var groups = by.length ? util.groupBy(rows, function (r) { return by.map(function (b) { return r[b]; }).join('\u0001'); }) : new Map([['', rows]]);
    var out = [];
    groups.forEach(function (g) {
      var rec = {};
      by.forEach(function (b) { rec[b] = g[0][b]; });
      measures.forEach(function (m) { rec[m.name] = m.c.aggregate ? m.c.eval(g, env) : m.c.eval(g[0], env); });
      out.push(rec);
    });
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Query engine (client "type your own metric" console)
   * ------------------------------------------------------------------ *
   * Text syntax:
   *   <items> [from <dataset>] [by <fields>] [where <expr>] [sort <column> [asc|desc]] [top <n>]
   *   items := expr [as "Label"] [format "0.0x"], ...      (* = all fields)
   * Examples:
   *   median(ev_ebitda_25e), avg(ebitda_margin) by sector
   *   company, ev / ebitda_25e as "EV/EBITDA" format "0.0x" where region == "Asia" sort 2 desc top 5
   *   sum(revenue) as "Revenue" by region, year where year >= 2024
   */
  var CLAUSES = ['group by', 'order by', 'from', 'by', 'where', 'sort', 'top', 'limit'];

  function splitTopLevel(text, sepFn) {
    var parts = [], depth = 0, q = null, start = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; continue; }
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      else if (depth === 0) {
        var len = sepFn(text, i);
        if (len) { parts.push({ text: text.slice(start, i), at: start }); start = i + len; i += len - 1; }
      }
    }
    parts.push({ text: text.slice(start), at: start });
    return parts;
  }

  function parseQuery(text) {
    var src = String(text).trim().replace(/^(select|show)\s+/i, '');
    // locate clause keywords at top level
    var found = [];
    splitTopLevel(src, function (t, i) {
      if (i > 0 && !/\s/.test(t[i - 1])) return 0;
      for (var k = 0; k < CLAUSES.length; k++) {
        var kw = CLAUSES[k];
        var seg = t.substr(i, kw.length).toLowerCase();
        if (seg === kw && (i + kw.length >= t.length || /\s/.test(t[i + kw.length]))) {
          found.push({ kw: kw, at: i, len: kw.length });
          return kw.length;
        }
      }
      return 0;
    });
    var spec = { select: [], by: [], where: null, sort: [], limit: null, from: null };
    var headEnd = found.length ? found[0].at : src.length;
    var head = src.slice(0, headEnd).trim();
    found.forEach(function (f, idx) {
      var end = idx + 1 < found.length ? found[idx + 1].at : src.length;
      var body = src.slice(f.at + f.len, end).trim();
      switch (f.kw) {
        case 'from': spec.from = body.replace(/^[`"']|[`"']$/g, ''); break;
        case 'by': case 'group by':
          spec.by = splitTopLevel(body, function (t, i) { return t[i] === ',' ? 1 : 0; }).map(function (p) { return p.text.trim().replace(/^`|`$/g, ''); }).filter(Boolean);
          break;
        case 'where': spec.where = body; break;
        case 'sort': case 'order by':
          spec.sort = splitTopLevel(body, function (t, i) { return t[i] === ',' ? 1 : 0; }).map(function (p) {
            var m = p.text.trim().match(/^(.*?)(?:\s+(asc|desc))?$/i);
            return { key: m[1].trim().replace(/^["'`]|["'`]$/g, ''), dir: (m[2] || 'desc').toLowerCase() };
          });
          break;
        case 'top': case 'limit': spec.limit = parseInt(body, 10) || null; break;
      }
    });
    if (head) {
      spec.select = splitTopLevel(head, function (t, i) { return t[i] === ',' ? 1 : 0; }).map(function (p) {
        var item = p.text.trim(), fmt = null, label = null;
        var fm = item.match(/\s+format\s+("([^"]*)"|'([^']*)'|(\S+))\s*$/i);
        if (fm) { fmt = fm[2] || fm[3] || fm[4]; item = item.slice(0, fm.index).trim(); }
        var am = item.match(/\s+as\s+("([^"]*)"|'([^']*)'|`([^`]*)`|([\wÀ-￿]+))\s*$/i);
        if (am) { label = am[2] || am[3] || am[4] || am[5]; item = item.slice(0, am.index).trim(); }
        return { expr: item, as: label, format: fmt };
      }).filter(function (s) { return s.expr; });
    }
    return spec;
  }

  function guessFormat(c, ds) {
    // single field or aggregate over a single field -> inherit that field's format
    var ast = c.ast;
    if (ast.type === 'field' && ds.field(c.fields[0])) return ds.field(c.fields[0]).format;
    if (ast.type === 'call' && ast.args.length && ast.args[0].type === 'field' && ast.name !== 'count' && ast.name !== 'countd') {
      var f = ds.field(c.fields[0]);
      return f && f.format;
    }
    if (ast.type === 'call' && (ast.name === 'count' || ast.name === 'countd')) return '#,##0';
    return null;
  }

  /**
   * run(spec | text, {dataset}) -> {columns:[{name,title,format,type}], rows:[...], aggregate, spec, dataset}
   */
  function query(specOrText, opts) {
    opts = opts || {};
    var spec = typeof specOrText === 'string' ? parseQuery(specOrText) : specOrText;
    var dsId = spec.from || opts.dataset;
    var ds = dsId ? data.get(dsId) : null;
    if (!ds) {
      var hint = data.ids().join(', ');
      throw new RK.expr.ExprError(dsId ? 'Unknown dataset "' + dsId + '" (available: ' + hint + ')' : 'Choose a dataset (from <name>) — available: ' + hint);
    }
    var fields = ds.fields;
    var rows = opts.filtered === false ? ds.rows : view(ds, { exclude: opts.exclude, ignore: opts.ignore });
    var env = { params: store.params() };
    if (spec.where) {
      var w = RK.expr.compile(spec.where, { fields: fields });
      if (w.aggregate) throw new RK.expr.ExprError('"where" cannot use aggregates');
      rows = rows.filter(function (r) { return !!w.eval(r, env); });
    }
    var by = (spec.by || []).map(function (b) {
      var c = RK.expr.compile(b, { fields: fields });
      if (c.ast.type !== 'field') throw new RK.expr.ExprError('"by" expects field names, got "' + b + '"');
      return c.fields[0];
    });
    var items = spec.select && spec.select.length ? spec.select : [{ expr: '*' }];
    var expanded = [];
    items.forEach(function (it) {
      if (it.expr === '*') fields.forEach(function (f) { expanded.push({ expr: '`' + f.name + '`', as: f.title, format: f.format, _name: f.name }); });
      else expanded.push(it);
    });
    var cols = expanded.map(function (it, i) {
      var c = RK.expr.compile(it.expr, { fields: fields });
      var single = c.ast.type === 'field' ? ds.field(c.fields[0]) : null;
      var name = it._name || (single && !it.as ? single.name : 'c' + (i + 1));
      return {
        name: name,
        title: it.as || (single ? single.title : it.expr),
        format: it.format || guessFormat(c, ds),
        compiled: c,
        type: single ? single.type : 'number'
      };
    });
    var isAgg = by.length > 0 || cols.some(function (c) { return c.compiled.aggregate; });
    var outRows;
    if (isAgg) {
      var keyCols = by.filter(function (b) { return !cols.some(function (c) { return c.name === b; }); });
      var groups = by.length ? util.groupBy(rows, function (r) { return by.map(function (b) { return r[b]; }).join('\u0001'); }) : new Map([['', rows]]);
      outRows = [];
      groups.forEach(function (g) {
        var rec = {};
        keyCols.forEach(function (b) { rec[b] = g[0][b]; });
        cols.forEach(function (c) { rec[c.name] = c.compiled.aggregate ? c.compiled.eval(g, env) : c.compiled.eval(g[0], env); });
        outRows.push(rec);
      });
      cols = keyCols.map(function (b) { var f = ds.field(b); return { name: b, title: f.title, format: f.format, type: f.type }; }).concat(cols);
    } else {
      outRows = rows.map(function (r) {
        var rec = {};
        cols.forEach(function (c) { rec[c.name] = c.compiled.eval(r, env); });
        return rec;
      });
    }
    (spec.sort || []).slice().reverse().forEach(function (s) {
      var col = null;
      if (/^\d+$/.test(s.key)) col = cols[parseInt(s.key, 10) - 1];
      if (!col) col = cols.filter(function (c) { return c.name === s.key || String(c.title).toLowerCase() === s.key.toLowerCase(); })[0];
      if (!col) throw new RK.expr.ExprError('Cannot sort by "' + s.key + '" — use a column label or position');
      var dir = s.dir === 'asc' ? 1 : -1;
      outRows.sort(function (a, b) {
        var x = a[col.name], y = b[col.name];
        if (x == null || (typeof x === 'number' && isNaN(x))) return 1;
        if (y == null || (typeof y === 'number' && isNaN(y))) return -1;
        return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
      });
    });
    if (spec.limit) outRows = outRows.slice(0, spec.limit);
    return {
      dataset: ds.id,
      aggregate: isAgg,
      spec: spec,
      columns: cols.map(function (c) { return { name: c.name, title: c.title, format: c.format, type: c.type }; }),
      rows: outRows
    };
  }
  query.parse = parseQuery;
  RK.query = query;

  /* ------------------------------------------------------------------ *
   * Data registry + loading
   * ------------------------------------------------------------------ */
  var datasets = Object.create(null);
  var adapters = Object.create(null);
  var preloaded = null;

  var data = RK.data = {
    manifest: { report: {}, datasets: {}, params: {} },

    /** Called by data/bundle.js. */
    preload: function (bundle) { preloaded = bundle; },

    put: function (json) {
      var ds = json instanceof Dataset ? json : new Dataset(json);
      if (!ds.id) throw new Error('[RK] dataset needs an id');
      datasets[ds.id] = ds;
      RK.bus.emit('data:changed', { dataset: ds.id });
      if (data._ready) store._notify({ type: 'data', dataset: ds.id });
      return ds;
    },
    get: function (id) { return datasets[id] || null; },
    ids: function () { return Object.keys(datasets); },
    view: view,
    affected: affected,
    applies: filterApplies,
    aggregate: aggregate,

    adapter: function (name, fn) { adapters[name] = fn; },

    /** Resolve the data source and load everything. Returns a Promise. */
    load: function (cfg) {
      cfg = cfg || {};
      var p;
      if (cfg.bundle || preloaded) p = Promise.resolve(cfg.bundle || preloaded);
      else {
        var kind = cfg.source || meta('rk:data-source') || 'http';
        var fn = adapters[kind];
        if (!fn) return Promise.reject(new Error('[RK] unknown data source "' + kind + '"'));
        p = fn(cfg);
      }
      return p.then(function (bundle) {
        data.manifest = bundle.manifest || data.manifest;
        store.defineParams(data.manifest.params);
        var dsets = bundle.datasets || {};
        Object.keys(dsets).forEach(function (id) {
          var json = dsets[id];
          if (!json.id) json.id = id;
          datasets[id] = new Dataset(json);
        });
        data._ready = true;
        RK.bus.emit('data:loaded', data);
        return data;
      });
    }
  };

  function meta(name) {
    var el = typeof document !== 'undefined' && document.querySelector('meta[name="' + name + '"]');
    return el ? el.getAttribute('content') : null;
  }

  function fetchJSON(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('[RK] ' + r.status + ' loading ' + url);
      return r.json();
    });
  }

  // Static folder served over http(s): data/manifest.json + data/datasets/<id>.json
  data.adapter('http', function (cfg) {
    var base = cfg.base || meta('rk:data') || 'data/';
    if (base && base.slice(-1) !== '/') base += '/';
    if (location.protocol === 'file:') {
      return Promise.reject(new Error('[RK] Opened from file:// and data/bundle.js was not loaded. Include <script src="data/bundle.js"></script> or serve the folder over http.'));
    }
    return fetchJSON(base + 'manifest.json').then(function (manifest) {
      var ids = Object.keys(manifest.datasets || {});
      return Promise.all(ids.map(function (id) {
        var entry = manifest.datasets[id];
        return fetchJSON(base + (entry.path || ('datasets/' + id + '.json')));
      })).then(function (list) {
        var out = {};
        list.forEach(function (json, i) { out[ids[i]] = json; });
        return { manifest: manifest, datasets: out };
      });
    });
  });

  // Future data API: same shapes, different URLs (+ optional bearer token)
  data.adapter('api', function (cfg) {
    var base = cfg.api || meta('rk:api');
    if (!base) return Promise.reject(new Error('[RK] data source "api" needs <meta name="rk:api" content="https://...">'));
    if (base.slice(-1) !== '/') base += '/';
    var headers = cfg.token ? { Authorization: 'Bearer ' + cfg.token } : {};
    function get(path) {
      return fetch(base + path, { headers: headers }).then(function (r) {
        if (!r.ok) throw new Error('[RK] API ' + r.status + ' ' + path);
        return r.json();
      });
    }
    return get('manifest').then(function (manifest) {
      var ids = Object.keys(manifest.datasets || {});
      return Promise.all(ids.map(function (id) { return get('datasets/' + encodeURIComponent(id)); })).then(function (list) {
        var out = {};
        list.forEach(function (json, i) { out[ids[i]] = json; });
        return { manifest: manifest, datasets: out };
      });
    });
  });
})(typeof window !== 'undefined' ? window : this);
