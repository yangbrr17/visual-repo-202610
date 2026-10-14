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

  var reduced = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);

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

    /** Animate a number into el.textContent using an RK format code. */
    countUp: function (el, to, opts) {
      opts = opts || {};
      var fmt = opts.format, from = opts.from || 0, dur = opts.duration || 1100;
      if (!motion.enabled || !RK.util.isNum(to) || opts.animate === false) {
        el.textContent = RK.format(to, fmt);
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
})(typeof window !== 'undefined' ? window : this);
