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

  /* Prototype-safe access. Field names, filter keys and param names come from data and users, so lookup tables have
   * no prototype (Object.create(null)) or are read with has(), and records are read with get() / written with put():
   * a field called "constructor" never reads Object.prototype.constructor, and "__proto__" stays an ordinary key. */
  function has(obj, key) { return obj != null && Object.prototype.hasOwnProperty.call(obj, key); }
  function get(row, key) { return has(row, key) ? row[key] : undefined; }
  /** obj[key] = v that also works for a field literally named "__proto__" (assignment would swap the prototype and drop the value). */
  function put(obj, key, v) {
    if (key === '__proto__') Object.defineProperty(obj, key, { value: v, writable: true, enumerable: true, configurable: true });
    else obj[key] = v;
  }
  function dict(o) { var d = Object.create(null); for (var k in o) if (has(o, k)) d[k] = o[k]; return d; }

  /* ------------------------------------------------------------------ *
   * Dataset
   * ------------------------------------------------------------------ */
  function inferType(rows, name) {
    for (var i = 0; i < Math.min(rows.length, 50); i++) {
      var v = get(rows[i], name);
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
        for (var i = 0; i < fields.length; i++) put(o, fields[i].name, arr[i]);
        return o;
      });
    }
    // Cells must be scalars (or arrays, e.g. sparklines). Object cells (dict / JSONB columns) are turned into JSON
    // text so they can never be mistaken for DOM props / markup by components.
    for (var ri = 0; ri < data.length; ri++) {
      var rec = data[ri];
      for (var ck in rec) {
        if (Object.prototype.hasOwnProperty.call(rec, ck)) {
          var cv = rec[ck];
          if (cv !== null && typeof cv === 'object' && !Array.isArray(cv)) rec[ck] = JSON.stringify(cv);
          else if (Array.isArray(cv)) rec[ck] = cv.map(function (x) { return x !== null && typeof x === 'object' ? JSON.stringify(x) : x; });
        }
      }
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
    this._rev = 0;   // schema revision: bumped when computed fields change (per-dataset caches compare it)
    (json.computed || []).forEach(function (c) { self.addComputed(c, true); });
  }

  Dataset.prototype.field = function (name) { return this._index[name] || null; };
  Dataset.prototype.has = function (name) { return !!this._index[name]; };
  Dataset.prototype.fieldNames = function () { return this.fields.map(function (f) { return f.name; }); };
  Dataset.prototype.values = function (name) { return this.rows.map(function (r) { return get(r, name); }); };
  Dataset.prototype.distinct = function (name) { return util.unique(this.values(name).filter(function (v) { return v != null && v !== ''; })); };
  Dataset.prototype.format = function (name) { var f = this._index[name]; return f && f.format; };

  /**
   * Computed fields in evaluation order: definition order, except that a field always runs after the computed fields
   * it reads (a redefinition may read a field defined after it). A cycle (a -> b -> a) is an ExprError.
   */
  function orderComputed(list) {
    var at = Object.create(null), state = Object.create(null), out = [], path = [];
    list.forEach(function (x, i) { at[x.def.name] = i; });
    function visit(x) {
      var name = x.def.name;
      if (state[name] === 2) return;
      if (state[name] === 1) {
        var loop = path.slice(path.indexOf(name)).concat(name);
        throw new RK.expr.ExprError('Computed fields cannot reference each other in a loop (' + loop.join(' -> ') + ') — give the result a new name');
      }
      state[name] = 1; path.push(name);
      x.compiled.fields.forEach(function (f) { if (f !== name && has(at, f)) visit(list[at[f]]); });
      path.pop(); state[name] = 2;
      out.push(x);
    }
    list.forEach(visit);
    return out;
  }

  /**
   * Add (or redefine) a derived field computed by an RK.expr formula. Values are materialised on each row and
   * recomputed automatically when a referenced @param, or a computed field it reads, changes. A redefinition keeps
   * its place, so the fields that read it are recomputed after it. A formula may not read its own field: x = x * 1.1
   * would compound on every recompute (every slider move).
   */
  Dataset.prototype.addComputed = function (spec, silent) {
    var c = RK.expr.compile(spec.formula, { fields: this.fields });
    if (c.aggregate) throw new RK.expr.ExprError('Computed fields must be row formulas (no sum/avg/...)');
    if (c.fields.indexOf(spec.name) >= 0) throw new RK.expr.ExprError('Computed field "' + spec.name + '" cannot reference itself — give the result a new name');
    var def = { name: spec.name, title: spec.title || spec.name, type: spec.type || 'number', format: spec.format, formula: spec.formula, computed: true };
    var entry = { def: def, compiled: c }, list = this.computed.slice(), i = list.length;
    while (i-- > 0) if (list[i].def.name === def.name) break;
    if (i >= 0) list[i] = entry; else list.push(entry);
    list = orderComputed(list);   // throws on a loop before anything has changed
    var existing = this._index[def.name];
    if (existing) util.merge(existing, def); else { this.fields.push(def); this._index[def.name] = def; }
    this.computed = list;
    this._rev++;
    this._materialize(def.name);
    if (!silent) RK.bus.emit('data:changed', { dataset: this.id, field: def.name });
    return def;
  };

  Dataset.prototype.removeComputed = function (name) {
    this.computed = this.computed.filter(function (x) { return x.def.name !== name; });
    this.fields = this.fields.filter(function (f) { return f.name !== name; });
    delete this._index[name];
    this._rev++;
    this.rows.forEach(function (r) { delete r[name]; });
    RK.bus.emit('data:changed', { dataset: this.id, field: name });
  };

  Dataset.prototype._materialize = function (onlyName, paramName) {
    var env = { params: RK.store.params() };
    var rows = this.rows;
    // computed fields recomputed in this pass; the fields that read them are recomputed too, in evaluation order
    var dirty = Object.create(null);
    function readsDirty(c) { return c.compiled.fields.some(function (f) { return has(dirty, f); }); }
    this.computed.forEach(function (c) {
      if (onlyName && c.def.name !== onlyName && !readsDirty(c)) return;
      if (paramName && c.compiled.params.indexOf(paramName) < 0 && !readsDirty(c)) return;
      dirty[c.def.name] = true;
      for (var i = 0; i < rows.length; i++) {
        var v;
        try { v = c.compiled.eval(rows[i], env); } catch (e) { v = null; }
        put(rows[i], c.def.name, v);
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
      // spreadsheet formula injection: =HYPERLINK(...), +cmd, -cmd, @SUM... are executed by Excel on open
      if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = "'" + s;
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var lines = [fields.map(function (f) { return esc(f.title || f.name); }).join(',')];
    rows.forEach(function (r) { lines.push(fields.map(function (f) { return esc(get(r, f.name)); }).join(',')); });
    return '﻿' + lines.join('\n');
  };

  RK.Dataset = Dataset;

  /* ------------------------------------------------------------------ *
   * Store: filters, params, generic state
   * ------------------------------------------------------------------ */
  var store = RK.store = (function () {
    // keyed by user / data supplied names: no prototype ("constructor", "toString" are ordinary keys)
    var filters = Object.create(null), params = Object.create(null), state = Object.create(null), subs = [], pending = [], scheduled = false;

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
        if (!has(filters, key)) return;
        var prev = filters[key];
        delete filters[key];
        notify({ type: 'filter', key: key, spec: null, prev: prev });
      },
      clearFilters: function (source) {
        Object.keys(filters).forEach(function (k) { if (!source || filters[k].source === source) store.clearFilter(k); });
      },
      /** toggle a value inside an 'in' filter (used by click-to-filter / cross-filter). */
      toggleValue: function (key, field, value, source, extra) {
        var cur = get(filters, key);
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
      filter: function (key) { return get(filters, key) || null; },
      filters: function () { return filters; },

      params: function () { return params; },
      param: function (name) { return get(params, name); },
      /** '@wacc' -> current value of param wacc (manifest default, then fallbacks[name]); other values pass through. */
      resolve: function (v, fallbacks) {
        var m = typeof v === 'string' ? /^@([A-Za-z_]\w*)$/.exec(v) : null;
        if (!m) return v;
        var x = get(params, m[1]);
        if (x === undefined) {
          var d = get((RK.data && RK.data.manifest && RK.data.manifest.params) || {}, m[1]);
          x = d && d.value != null ? d.value : get(fallbacks || {}, m[1]);
        }
        return x;
      },
      setParam: function (name, value) {
        if (has(params, name) && params[name] === value) return;
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
          put(params, k, util.isObj(d) ? d.value : d);
        });
      },

      get: function (k) { return get(state, k); },
      set: function (k, v) { if (has(state, k) && state[k] === v) return; state[k] = v; notify({ type: 'state', key: k, value: v }); },

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

  /**
   * expr filters compile against each dataset's schema, so titles ([Enterprise value]), `names with spaces` and
   * case variants resolve as in queries; null when the formula does not fit this dataset (a field it lacks), and the
   * filter then does not apply to it. Compiled once per (filter, dataset, schema revision).
   */
  var exprMemo = new WeakMap();
  function exprFor(spec, ds) {
    var memo = exprMemo.get(spec);
    if (!memo) exprMemo.set(spec, memo = Object.create(null));
    var m = has(memo, ds.id) ? memo[ds.id] : null;
    if (!m || m.ds !== ds || m.rev !== ds._rev || m.expr !== spec.expr) {
      var c = null;
      try { c = RK.expr.compile(spec.expr, { fields: ds.fields }); } catch (e) { c = null; }
      m = memo[ds.id] = { ds: ds, rev: ds._rev, expr: spec.expr, c: c };
    }
    return m.c;
  }

  function filterApplies(spec, ds) {
    if (spec.datasets && spec.datasets.indexOf(ds.id) < 0) return false;
    if (spec.op === 'expr') return !!(spec._compiled && exprFor(spec, ds));
    if (spec.op === 'search') return !spec.field || ds.has(spec.field);
    return ds.has(spec.field);
  }

  function makePredicate(spec, ds) {
    var f = spec.field, type = f && ds.field(f) ? ds.field(f).type : null;
    switch (spec.op) {
      case 'in': {
        var set = new Set(spec.values.map(function (v) { return typeof v === 'string' ? v.toLowerCase() : v; }));
        return function (r) { var v = get(r, f); return set.has(typeof v === 'string' ? v.toLowerCase() : v); };
      }
      case 'not_in': {   // case-insensitive, like 'in' and RK.expr ==
        var nset = new Set((spec.values || []).map(function (v) { return typeof v === 'string' ? v.toLowerCase() : v; }));
        return function (r) { var v = get(r, f); return !nset.has(typeof v === 'string' ? v.toLowerCase() : v); };
      }
      case 'eq': return function (r) { return get(r, f) === spec.value; };
      case 'between': return function (r) {
        var v = get(r, f);
        if (v == null || v === '') return false;
        if (spec.min != null && cmpVal(v, spec.min, type) < 0) return false;
        if (spec.max != null && cmpVal(v, spec.max, type) > 0) return false;
        return true;
      };
      case 'search': {
        var q = String(spec.text).toLowerCase();
        var cols = f ? [f] : ds.fields.filter(function (x) { return x.type === 'string'; }).map(function (x) { return x.name; });
        return function (r) {
          for (var i = 0; i < cols.length; i++) { var v = get(r, cols[i]); if (v != null && String(v).toLowerCase().indexOf(q) >= 0) return true; }
          return false;
        };
      }
      case 'expr': {
        var c = exprFor(spec, ds), env = { params: store.params() };
        if (!c) return function () { return false; };
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
      var ref = m.field == null ? '' : '`' + m.field + '`';            // field names may contain spaces
      var src = m.expr || (m.op ? m.op + '(' + ref + ')' : ref);
      return { name: m.name || m.expr || (m.op ? m.op + '(' + (m.field == null ? '' : m.field) + ')' : m.field), c: RK.expr.compile(src, { fields: spec.fields }) };
    });
    var env = { params: store.params() };
    var groups = by.length ? util.groupBy(rows, function (r) { return by.map(function (b) { return get(r, b); }).join('\u0001'); }) : new Map([['', rows]]);
    var out = [];
    groups.forEach(function (g) {
      var rec = {};
      by.forEach(function (b) { put(rec, b, get(g[0], b)); });
      measures.forEach(function (m) { put(rec, m.name, m.c.aggregate ? m.c.eval(g, env) : m.c.eval(g[0], env)); });
      out.push(rec);
    });
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Query engine (client "type your own metric" console)
   * ------------------------------------------------------------------ *
   * Text syntax:
   *   <items> [from <dataset>] [by <fields>] [where <expr>] [sort [by] <column> [asc|desc]] [top <n>]
   *   items := expr [as "Label"] [format "0.0x"], ...      (* = all fields)
   * Examples:
   *   median(ev_ebitda_25e), avg(ebitda_margin) by sector
   *   company, ev / ebitda_25e as "EV/EBITDA" format "0.0x" where region == "Asia" sort 2 desc top 5
   *   sum(revenue) as "Revenue" by region, year where year >= 2024
   */
  // clause keywords, longest first ("sort by" before "sort" and "by"); blanks or a line break inside "group by" etc.
  var CLAUSE_RE = /(group\s+by|order\s+by|sort\s+by|from|by|where|sort|top|limit)(?=\s|$)/iy;
  // clauses that may appear once: "order by" and "sort by" are "sort", "group by" is "by", "limit" is "top"
  var CLAUSE_KIND = dict({ 'group by': 'by', 'order by': 'sort', 'sort by': 'sort', limit: 'top' });

  function splitTopLevel(text, sepFn) {
    var parts = [], depth = 0, q = null, start = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === '\\' && q !== '`') i++; else if (c === q) q = null; continue; }   // "a \" b": same escapes as RK.expr
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
      CLAUSE_RE.lastIndex = i;
      var m = CLAUSE_RE.exec(t);
      if (!m) return 0;
      found.push({ kw: m[1].toLowerCase().replace(/\s+/, ' '), at: i, len: m[0].length });
      return m[0].length;
    });
    var spec = { select: [], by: [], where: null, sort: [], limit: null, from: null };
    var headEnd = found.length ? found[0].at : src.length;
    var head = src.slice(0, headEnd).trim();
    var seen = Object.create(null);
    found.forEach(function (f, idx) {
      var end = idx + 1 < found.length ? found[idx + 1].at : src.length;
      var body = src.slice(f.at + f.len, end).trim();
      var kind = has(CLAUSE_KIND, f.kw) ? CLAUSE_KIND[f.kw] : f.kw;
      if (seen[kind]) throw new RK.expr.ExprError('"' + f.kw + '" appears more than once — combine conditions with "and", or list several columns separated by commas');
      seen[kind] = true;
      switch (f.kw) {
        case 'from': spec.from = body.replace(/^[`"']|[`"']$/g, ''); break;
        case 'by': case 'group by':
          spec.by = splitTopLevel(body, function (t, i) { return t[i] === ',' ? 1 : 0; }).map(function (p) { return p.text.trim(); }).filter(Boolean);   // keep `quotes`: "HQ city" is two tokens
          break;
        case 'where': spec.where = body; break;
        case 'sort': case 'sort by': case 'order by':
          spec.sort = splitTopLevel(body, function (t, i) { return t[i] === ',' ? 1 : 0; }).map(function (p) {
            var txt = p.text.trim(), m = txt.match(/\s(asc|desc)$/i);
            return { key: (m ? txt.slice(0, m.index) : txt).trim().replace(/^["'`]|["'`]$/g, ''), dir: (m ? m[1] : 'desc').toLowerCase() };
          });
          break;
        case 'top': case 'limit':
          // "top -3" used to drop the last 3 rows, "top 0" / "top ten" silently returned everything
          if (!/^\d+$/.test(body) || +body < 1) throw new RK.expr.ExprError('"' + f.kw + '" expects a whole number of rows, e.g. top 10 (got "' + body + '")');
          spec.limit = +body;
          break;
      }
    });
    if (head) {
      spec.select = splitTopLevel(head, function (t, i) { return t[i] === ',' ? 1 : 0; }).map(function (p) {
        var item = p.text.trim(), fmt = null, label = null;
        for (var pass = 0; pass < 2; pass++) {   // "as" and "format" may come in either order
          // single \s before the keyword + trimmed item: linear time (\s+...\s*$ backtracked O(n^2) on long blanks)
          var fm = fmt === null && item.match(/\sformat\s+("([^"]*)"|'([^']*)'|(\S+))$/i);
          if (fm) { fmt = fm[2] || fm[3] || fm[4]; item = item.slice(0, fm.index).trim(); }
          var am = label === null && item.match(/\sas\s+("([^"]*)"|'([^']*)'|`([^`]*)`|([\wÀ-￿]+))$/i);
          if (am) { label = am[2] || am[3] || am[4] || am[5]; item = item.slice(0, am.index).trim(); }
        }
        return { expr: item, as: label, format: fmt };
      }).filter(function (s) { return s.expr; });
    }
    return spec;
  }

  // functions whose result has the unit of their first argument (sum(ev) is in dollars like ev) ...
  var SAME_UNIT = dict({ sum: 1, avg: 1, mean: 1, average: 1, median: 1, min: 1, max: 1, first: 1, last: 1, pctl: 1, percentile: 1,
    wavg: 1, stdev: 1, stddev: 1, abs: 1, round: 1, floor: 1, ceil: 1, clamp: 1, coalesce: 1 });
  // ... and functions with a unit of their own: pct_change(revenue, ...) is a %, not "$0"; year(date) is 2019, not a date
  var RESULT_FORMAT = dict({ count: '#,##0', countd: '#,##0', pct_change: '0.0%', cagr: '0.0%', year: '0', month: '0', quarter: '0' });

  /** Two formats that must agree; undefined (a number literal or null) fits either. */
  function agree(a, b) { return a === undefined ? b : (b === undefined || a === b ? a : null); }

  /**
   * Display format of a query column, inferred from the formula: the result keeps the format of the field it is
   * computed from when it keeps that field's unit. ev, sum(ev), -ev, round(avg(ev), 1), ev_26e - ev_25e and
   * sum(if(x, ev, 0)) keep ev's format; count() is "#,##0", pct_change() / cagr() "0.0%", year() "0"; ratios,
   * products, text and other functions get null (General). Returns undefined for a number literal / null.
   */
  function inferFormat(node, ds) {
    switch (node.type) {
      case 'field': { var f = ds.field(node.resolved || node.name); return f && f.format != null ? f.format : null; }
      case 'lit': return node.v === null || typeof node.v === 'number' ? undefined : null;
      case 'un': return node.op === 'neg' ? inferFormat(node.a, ds) : null;
      case 'cond': return agree(inferFormat(node.a, ds), inferFormat(node.b, ds));
      case 'bin': return node.op === '+' || node.op === '-' ? agree(inferFormat(node.a, ds), inferFormat(node.b, ds)) : null;
      case 'call':
        if (has(RESULT_FORMAT, node.name)) return RESULT_FORMAT[node.name];
        if (node.name === 'if' || node.name === 'iif') return node.args.length < 2 ? null : agree(inferFormat(node.args[1], ds), node.args[2] ? inferFormat(node.args[2], ds) : undefined);
        if (has(SAME_UNIT, node.name) && node.args.length) return inferFormat(node.args[0], ds);
        return null;
    }
    return null;
  }
  function guessFormat(c, ds) {
    var f = inferFormat(c.ast, ds);
    return f === undefined ? null : f;
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
      if (ds.has(b)) return b;                                   // spec objects may pass raw names with spaces
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
        type: single ? single.type : null      // expressions: typed from their values below
      };
    });
    var isAgg = by.length > 0 || cols.some(function (c) { return c.compiled.aggregate; });
    var outRows;
    if (isAgg) {
      var keyCols = by.filter(function (b) { return !cols.some(function (c) { return c.name === b; }); });
      var groups = by.length ? util.groupBy(rows, function (r) { return by.map(function (b) { return get(r, b); }).join('\u0001'); }) : new Map([['', rows]]);
      outRows = [];
      groups.forEach(function (g) {
        var rec = {};
        keyCols.forEach(function (b) { put(rec, b, get(g[0], b)); });
        cols.forEach(function (c) { put(rec, c.name, c.compiled.aggregate ? c.compiled.eval(g, env) : c.compiled.eval(g[0], env)); });
        outRows.push(rec);
      });
      cols = keyCols.map(function (b) { var f = ds.field(b); return { name: b, title: f.title, format: f.format, type: f.type }; }).concat(cols);
    } else {
      outRows = rows.map(function (r) {
        var rec = {};
        cols.forEach(function (c) { put(rec, c.name, c.compiled.eval(r, env)); });
        return rec;
      });
    }
    // if(..., "Net cash", "Net debt") is text, min(date) a date: type expression columns by their first value
    cols.forEach(function (c) {
      if (c.type) return;
      c.type = 'number';
      for (var i = 0; i < outRows.length; i++) {
        var v = outRows[i][c.name];
        if (v != null && v !== '') { c.type = inferType([outRows[i]], c.name); break; }
      }
    });
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
    if (spec.limit > 0) outRows = outRows.slice(0, Math.floor(spec.limit));   // spec objects: a non-positive limit is no limit
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
    /** Column names too generic to cross-filter across datasets (see ctx.select scope). */
    GENERIC_FIELDS: /^(type|kind|source|target|step|stage|metric|category|group|name|label|id|parent|value|series|status|item|node|link|bucket|class|level)$/i,
    isGenericField: function (field) { return !!field && RK.data.GENERIC_FIELDS.test(String(field)); },
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
