/* ===========================================================
   theme.js —— 主题切换：墨染长夜（深色）/ 宣纸初白（浅色），零依赖
   默认值来自 站点配置.json 的「默认配色」（跟随系统 / 浅色 / 深色）；用户手动切过之后记到 localStorage。
   =========================================================== */
(function () {
  'use strict';

  var KEY = 'theme';
  var root = document.documentElement;

  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      return (v === 'light' || v === 'dark') ? v : null;
    } catch (e) { return null; }
  }

  function systemTheme() {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    return 'light';
  }

  // 页面 HTML 上写死的默认主题（由 站点配置.json 生成），可能是 auto / light / dark
  function configuredTheme() {
    var a = root.getAttribute('data-theme');
    return (a === 'light' || a === 'dark') ? a : 'auto';
  }

  function current() {
    return stored() || (configuredTheme() === 'auto' ? systemTheme() : configuredTheme());
  }

  function apply() {
    var s = stored();
    if (s) root.setAttribute('data-theme', s);
    else root.setAttribute('data-theme', configuredTheme());   // 没手动设置过就用配置的默认值
    updateButton();
  }

  function updateButton() {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    var isDark = current() === 'dark';
    var icon = btn.querySelector('.theme-icon');
    var label = btn.querySelector('.theme-label');
    if (icon) icon.textContent = isDark ? '☾' : '☀';
    if (label) label.textContent = isDark ? '墨染长夜' : '宣纸初白';
    btn.setAttribute('title', isDark ? '当前：墨染长夜（点击切到宣纸初白）' : '当前：宣纸初白（点击切到墨染长夜）');
    btn.setAttribute('aria-label', btn.getAttribute('title'));
  }

  function toggle() {
    var next = current() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch (e) { /* 忽略 */ }
    root.setAttribute('data-theme', next);
    updateButton();
  }

  function init() {
    apply();
    var btn = document.getElementById('theme-toggle');
    if (btn) btn.addEventListener('click', toggle);

    // 没手动设置过时，跟随系统实时变化
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function () { if (!stored() && configuredTheme() === 'auto') apply(); };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }

    var y = document.getElementById('foot-year');
    if (y) y.textContent = String(new Date().getFullYear());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
