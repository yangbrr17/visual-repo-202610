/*!
 * ReportKit motion — restrained, professional motion:
 *   - scroll reveal (fade + 12px rise, staggered per page)
 *   - number count-up for KPI figures
 *   - charts mount when scrolled into view so their entry animation plays in context
 * Disabled automatically for prefers-reduced-motion and print.
 */
(function (global) {
  'use strict';
  var RK = global.RK || (global.RK = {});

  var rmq = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var reduced = !!(rmq && rmq.matches);

  var easing = {
    outCubic: function (t) { return 1 - Math.pow(1 - t, 3); },
    outQuart: function (t) { return 1 - Math.pow(1 - t, 4); },
    inOutCubic: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  };

  var motion = RK.motion = {
    enabled: !reduced,
    reduced: reduced,
    easing: easing,

    /** Mark elements for scroll-reveal. Stagger children of each page. */
    reveal: function (root) {
      root = root || document;
      var els = RK.util.qsa('.rk-page__head, .rk-block, .rk-cover__inner, [data-rk-reveal]', root);
      if (!motion.enabled || !('IntersectionObserver' in global)) return;
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
        });
      }, { rootMargin: '0px 0px -6% 0px', threshold: 0.01 });
      els.forEach(function (el) {
        if (el.classList.contains('rk-reveal')) return;
        var page = el.closest('.rk-page');
        var idx = page ? RK.util.qsa('.rk-page__head, .rk-block, [data-rk-reveal]', page).indexOf(el) : 0;
        el.style.setProperty('--rk-delay', Math.min(idx, 8) * 70 + 'ms');
        el.classList.add('rk-reveal');
        io.observe(el);
      });
    },

    /** Animate a number into el.textContent using an RK format code (screen readers get the final value). */
    countUp: function (el, to, opts) {
      opts = opts || {};
      var fmt = opts.format, from = opts.from || 0, dur = opts.duration || 1100;
      var finalText = RK.format(to, fmt);
      el.setAttribute('aria-label', finalText);
      if (!motion.enabled || !RK.util.isNum(to) || opts.animate === false || document.hidden) {
        el.textContent = finalText;
        return;
      }
      var start = null;
      var decimals = RK.format.decimals(fmt);
      function frame(ts) {
        if (start === null) start = ts;
        var t = Math.min(1, (ts - start) / dur);
        var v = from + (to - from) * easing.outQuart(t);
        if (t >= 1) v = to;
        else if (decimals === 0) v = Math.round(v);
        el.textContent = RK.format(v, fmt);
        if (t < 1) global.requestAnimationFrame(frame);
      }
      global.requestAnimationFrame(frame);
    },

    /**
     * Run a DOM update inside a View Transition when supported (filter / sort / tab swaps),
     * otherwise just run it. Returns a Promise that resolves after the update.
     */
    swap: function (update) {
      if (!motion.enabled || !document.startViewTransition || document.hidden) {
        update();
        return Promise.resolve();
      }
      try { return document.startViewTransition(update).updateCallbackDone; } catch (e) { update(); return Promise.resolve(); }
    },

    /**
     * FLIP re-order for keyed DOM rows (table sort / filter): measure, rebuild, glide.
     *   RK.motion.flip([tbody, tfoot], function () { ...replace the rows... });
     * Children carrying the same data-key before and after glide from their old position (the
     * component CSS gives them a `transition: transform`); new children get `.is-enter` for an
     * entry animation. Without motion it just runs the rebuild.
     */
    flip: function (containers, rebuild) {
      function rows() {
        var out = [];
        [].concat(containers).forEach(function (c) { if (c) out.push.apply(out, c.children); });
        return out;
      }
      if (!motion.enabled) { rebuild(); return; }
      var before = new Map();
      rows().forEach(function (el) { before.set(el.dataset.key, el.getBoundingClientRect()); });
      rebuild();
      var moved = [];
      rows().forEach(function (el) {
        var b = before.get(el.dataset.key);
        if (b == null) { el.classList.add('is-enter'); return; }
        var r = el.getBoundingClientRect(), dx = b.left - r.left, dy = b.top - r.top;   // rows and grids (2-D)
        if (Math.abs(dy) < 0.5 && Math.abs(dx) < 0.5) return;
        el.style.transition = 'none';
        el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        moved.push(el);
      });
      if (!moved.length) return;
      void moved[0].offsetHeight;   // commit the inverted positions before releasing them
      moved.forEach(function (el) { el.style.transition = ''; el.style.transform = ''; });
    },

    /** Generic tween: tween(600, t => ..., 'outCubic') */
    tween: function (duration, onFrame, ease) {
      var e = easing[ease || 'outCubic'], start = null;
      if (!motion.enabled) { onFrame(1); return; }
      function frame(ts) {
        if (start === null) start = ts;
        var t = Math.min(1, (ts - start) / duration);
        onFrame(e(t));
        if (t < 1) global.requestAnimationFrame(frame);
      }
      global.requestAnimationFrame(frame);
    }
  };

  // follow OS-level changes to the reduced-motion setting while the report is open
  if (rmq) {
    var onChange = function (e) { motion.reduced = e.matches; motion.enabled = !e.matches; };
    if (rmq.addEventListener) rmq.addEventListener('change', onChange); else if (rmq.addListener) rmq.addListener(onChange);
  }
})(typeof window !== 'undefined' ? window : this);
