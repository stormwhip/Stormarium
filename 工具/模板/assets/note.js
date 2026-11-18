/* ===========================================================
   note.js —— 笔记页：代码复制、目录高亮定位
   零依赖，离线可用。
   =========================================================== */
(function () {
  'use strict';

  function initToTop() {
    /* ---- 5. 回到顶部：往下读了一段之后才浮出来，点一下平滑回到页首 ---- */
    var toTop = document.getElementById('to-top');
    if (toTop) {
      var SHOW_AFTER = 360;   // 滚动超过这个距离（px）才显示

      // 直接读写：只读一次 scrollTop + 切一个 class，开销比 rAF 排队更可控，
      // 也不受「后台标签页 rAF 被暂停」影响。
      function syncToTop() {
        var y = window.pageYOffset || document.documentElement.scrollTop || 0;
        toTop.classList.toggle('is-visible', y > SHOW_AFTER);
      }

      window.addEventListener('scroll', syncToTop, { passive: true });
      // 从缓存返回、旋转屏幕、跳锚点后也同步一次
      window.addEventListener('pageshow', syncToTop);
      window.addEventListener('resize', syncToTop);
      window.addEventListener('hashchange', function () { setTimeout(syncToTop, 60); });

      toTop.addEventListener('click', function () {
        var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        try {
          window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
        } catch (e) {
          window.scrollTo(0, 0);
        }
        // 无障碍：把焦点还给正文开头
        var root = document.getElementById('note-root');
        if (root && root.focus) {
          root.setAttribute('tabindex', '-1');
          root.focus({ preventScroll: true });
        }
      });

      syncToTop();
    }
  }

  function init() {
    initToTop();
    /* ---- 0. Markdown / PDF 视图切换（只有两者都有才出现开关） ---- */
    /* PDF 视图由独立阅读器按需加载。 */
    var noteRoot = document.getElementById('note-root');
    var viewSwitch = document.getElementById('view-switch');
    var mdView = document.getElementById('view-markdown');
    var pdfView = document.getElementById('view-pdf');
    var pdfWrap = document.getElementById('pdf-frame-wrap');

    function ensurePdfFrame() {
      if (pdfWrap) window.dispatchEvent(new Event('note:pdfview'));
    }

    function viewStorageKey() {
      return 'noteView:' + location.pathname;
    }

    function applyView(view, save) {
      if (!noteRoot) return;
      var isPdf = view === 'pdf';
      noteRoot.classList.toggle('is-pdf-view', isPdf);
      document.body.classList.toggle('note-pdf-view', isPdf);
      if (viewSwitch) {
        viewSwitch.setAttribute('data-view', isPdf ? 'pdf' : 'markdown');
        var btns = viewSwitch.querySelectorAll('[data-view-btn]');
        Array.prototype.forEach.call(btns, function (btn) {
          var on = btn.getAttribute('data-view-btn') === (isPdf ? 'pdf' : 'markdown');
          btn.classList.toggle('is-active', on);
          btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      }
      if (mdView) mdView.setAttribute('aria-hidden', isPdf ? 'true' : 'false');
      if (pdfView) pdfView.setAttribute('aria-hidden', isPdf ? 'false' : 'true');
      if (isPdf) ensurePdfFrame();
      if (save) {
        try { localStorage.setItem(viewStorageKey(), isPdf ? 'pdf' : 'markdown'); } catch (e) { /* 隐私模式忽略 */ }
      }
    }

    if (viewSwitch) {
      var savedView = null;
      try { savedView = localStorage.getItem(viewStorageKey()); } catch (e) { /* 忽略 */ }
      applyView(savedView === 'pdf' ? 'pdf' : 'markdown', false);
      viewSwitch.addEventListener('click', function (ev) {
        var btn = ev.target.closest ? ev.target.closest('[data-view-btn]') : null;
        if (!btn) return;
        applyView(btn.getAttribute('data-view-btn') === 'pdf' ? 'pdf' : 'markdown', true);
      });
    } else if (noteRoot && pdfView && pdfWrap) {
      // PDF-only 笔记：直接加载
      applyView('pdf', false);
    }

    var body = document.getElementById('note-body');
    if (!body) return;

    // A fixed pixel destination becomes stale when lazy images above it load.
    // Keep the selected heading aligned on layout changes until the reader takes over.
    var navigationTarget = null;
    var navigationFrame = 0;
    function navigationOffset() {
      var header = document.querySelector('.site-head');
      var crumb = document.querySelector('.note-breadcrumb');
      var bottom = header ? header.getBoundingClientRect().bottom : 0;
      if (crumb) {
        var top = parseFloat(window.getComputedStyle(crumb).top);
        if (isFinite(top)) bottom = Math.max(bottom, top + crumb.getBoundingClientRect().height);
      }
      return Math.ceil(bottom + 12);
    }
    function instantScroll(top) {
      // CSS sets smooth scrolling globally: temporarily override it for corrections.
      var previous = document.documentElement.style.scrollBehavior;
      document.documentElement.style.scrollBehavior = 'auto';
      window.scrollTo(0, top);
      document.documentElement.style.scrollBehavior = previous;
    }
    function alignNavigation() {
      navigationFrame = 0;
      if (!navigationTarget || !navigationTarget.isConnected) return;
      var desired = navigationTarget.getBoundingClientRect().top + window.pageYOffset - navigationOffset();
      var maximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      desired = Math.max(0, Math.min(maximum, desired));
      if (Math.abs(window.pageYOffset - desired) > 1) instantScroll(desired);
    }
    function scheduleNavigation() {
      if (navigationTarget && !navigationFrame) navigationFrame = requestAnimationFrame(alignNavigation);
    }
    function stopNavigation() {
      navigationTarget = null;
      if (navigationFrame) cancelAnimationFrame(navigationFrame);
      navigationFrame = 0;
    }
    function navigate(target) {
      if (!target || (target !== noteRoot && !body.contains(target))) return;
      stopNavigation();
      window.dispatchEvent(new Event('note:navigation'));
      if (mdView) applyView('markdown', false);
      for (var parent = target.parentElement; parent; parent = parent.parentElement) {
        if (parent.tagName === 'DETAILS') parent.open = true;
      }
      navigationTarget = target;
      alignNavigation();
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      scheduleNavigation();
    }
    function hashTarget() {
      try {
        var id = decodeURIComponent(location.hash.slice(1));
        var target = document.getElementById(id);
        if (!target) {
          var legacy = body.querySelectorAll('[data-legacy-id]');
          for (var i = 0; i < legacy.length; i++) {
            if (legacy[i].getAttribute('data-legacy-id') === id) {
              target = legacy[i];
              history.replaceState(null, '', location.pathname + location.search + '#' + target.id);
              break;
            }
          }
        }
        return target;
      }
      catch (e) { return null; }
    }
    document.addEventListener('click', function (ev) {
      if (ev.defaultPrevented || ev.button || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) return;
      var a = ev.target.closest ? ev.target.closest('.toc a[href^="#"], #note-body a.anchor[href^="#"]') : null;
      if (!a) return;
      var target;
      try { target = document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1))); }
      catch (e) { return; }
      if (!target || !body.contains(target)) return;
      ev.preventDefault();
      navigate(target);
      try { history.replaceState(null, '', a.getAttribute('href')); }
      catch (e) { location.hash = a.getAttribute('href'); }
    });
    function readerTakesOver(ev) {
      if (ev.target.closest && ev.target.closest('.toc-desktop, .toc-mobile')) return;
      stopNavigation();
    }
    window.addEventListener('wheel', readerTakesOver, { passive: true });
    window.addEventListener('touchstart', readerTakesOver, { passive: true });
    window.addEventListener('pointerdown', readerTakesOver, { passive: true });
    window.addEventListener('keydown', function (ev) {
      if (!/^(Shift|Control|Alt|Meta)$/.test(ev.key)) readerTakesOver(ev);
    });
    if ('ResizeObserver' in window) new ResizeObserver(scheduleNavigation).observe(body);
    body.addEventListener('load', scheduleNavigation, true);
    body.addEventListener('error', scheduleNavigation, true);
    body.addEventListener('toggle', scheduleNavigation, true);
    window.addEventListener('resize', scheduleNavigation);
    // The browser can apply its native fragment scroll after a view switch/load.
    // Keep the chosen passage aligned until an actual reader action releases it.
    window.addEventListener('scroll', scheduleNavigation, { passive: true });
    window.addEventListener('load', scheduleNavigation);
    window.addEventListener('hashchange', function () { navigate(hashTarget()); });
    if (document.fonts) {
      document.fonts.ready.then(scheduleNavigation);
      if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', scheduleNavigation);
    }
    window.NoteNavigation = { navigate: navigate };
    window.dispatchEvent(new Event('note:ready'));
    if (location.hash && !new URLSearchParams(location.search).has('search')) navigate(hashTarget());

    /* ---- 2. 代码块：语言角标 + 复制按钮 ---- */
    var blocks = body.querySelectorAll('pre');
    Array.prototype.forEach.call(blocks, function (pre) {
      var code = pre.querySelector('code');
      var wrap = document.createElement('div');
      wrap.className = 'code-wrap';
      var lang = '';
      if (code && code.className) {
        var m = /language-([\w+#-]+)/.exec(code.className);
        if (m) lang = m[1];
      }
      if (lang) {
        wrap.classList.add('has-lang');
        var tag = document.createElement('span');
        tag.className = 'code-lang';
        tag.textContent = lang;
        wrap.appendChild(tag);
      }
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copy-btn';
      btn.textContent = '复制';
      btn.addEventListener('click', function () {
        var text = code ? code.textContent : pre.textContent;
        var done = function () {
          btn.textContent = '已复制 ✓';
          setTimeout(function () { btn.textContent = '复制'; }, 1400);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function () { fallback(); });
        } else { fallback(); }
        function fallback() {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', 'readonly');
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); done(); } catch (e) { btn.textContent = '请手动选中'; }
          document.body.removeChild(ta);
        }
      });
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);
    });

    /* ---- 3. 目录高亮：滚动到哪个标题就点亮哪一项 ---- */
    var headings = body.querySelectorAll('h2[id], h3[id]');
    var links = document.querySelectorAll('.toc a[href^="#"]');
    if (headings.length && links.length) {
      var activeId = null;
      var pendingTocFrame = false;
      var setActive = function () {
        pendingTocFrame = false;
        var cutoff = navigationOffset() + 8;
        var best = headings[0].id;
        for (var i = 0; i < headings.length; i++) {
          if (headings[i].getBoundingClientRect().top > cutoff) break;
          best = headings[i].id;
        }
        if (best === activeId) return;
        activeId = best;
        Array.prototype.forEach.call(links, function (a) {
          var id = a.getAttribute('href').slice(1);
          try { id = decodeURIComponent(id); } catch (e) {}
          a.classList.toggle('toc-active', id === best);
        });
      };
      var scheduleToc = function () {
        if (pendingTocFrame) return;
        pendingTocFrame = true;
        window.requestAnimationFrame(setActive);
      };
      window.addEventListener('scroll', scheduleToc, { passive: true });
      window.addEventListener('resize', scheduleToc);
      window.addEventListener('hashchange', scheduleToc);
      if ('ResizeObserver' in window) new ResizeObserver(scheduleToc).observe(body);
      scheduleToc();
    }

    /* ---- 4. 太宽的行内公式：只让真正放不下的那一段横向滚动 ----
       公式本身始终保持 KaTeX 原生的 inline 盒（基线正确、短公式不会长出滚动条），
       这里逐段量：公式右边界超出段落右边界，才给那一段加 .math-scroll。
       同时补 6px 上下内边距、用等量负外边距抵消，避免 overflow 把上下标切掉。 */
    var fitMath = (function () {
      var timer = null;
      var PAD = 6;
      var BLOCKS = { P: 1, LI: 1, TD: 1, TH: 1 };

      function reset(body) {
        var list = body.querySelectorAll('.math-scroll');
        for (var i = 0; i < list.length; i++) {
          list[i].classList.remove('math-scroll');
          list[i].style.paddingTop = '';
          list[i].style.paddingBottom = '';
          list[i].style.marginTop = '';
          list[i].style.marginBottom = '';
        }
      }

      function run() {
        var body = document.getElementById('note-body');
        if (!body) return;
        reset(body);
        var longs = body.querySelectorAll('.m-long');
        var seen = [];
        for (var i = 0; i < longs.length; i++) {
          var el = longs[i];
          var box = el.parentNode;
          while (box && box !== body && !BLOCKS[box.tagName]) box = box.parentNode;
          if (!box || box === body || seen.indexOf(box) !== -1) continue;
          seen.push(box);
          if (el.getBoundingClientRect().right <= box.getBoundingClientRect().right + 1) continue;
          var cs = window.getComputedStyle(box);
          var mt = parseFloat(cs.marginTop) || 0;
          var mb = parseFloat(cs.marginBottom) || 0;
          box.classList.add('math-scroll');
          box.style.paddingTop = PAD + 'px';
          box.style.paddingBottom = PAD + 'px';
          box.style.marginTop = (mt - PAD) + 'px';
          box.style.marginBottom = (mb - PAD) + 'px';
        }
      }

      function schedule() {
        clearTimeout(timer);
        timer = setTimeout(run, 80);
      }

      return { run: run, schedule: schedule };
    })();

    fitMath.run();
    // 公式字体（woff2）加载完宽度会变，要再量一次
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(function () { fitMath.schedule(); });
    }
    window.addEventListener('load', function () { fitMath.schedule(); });
    window.addEventListener('resize', fitMath.schedule);


  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
