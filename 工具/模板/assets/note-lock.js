/* Stormarium · MIT 18.06 访问码界面。 */
(function () {
  'use strict';
  var EXPECTED_SHA256 = '388783776deae628032cc575b662cdaee07f721f2c5e5f23887b1065a146527b';
  var STORAGE_KEY = 'stormarium:mit1806:unlocked:v1';
  function init() {
    var gate = document.getElementById('note-lock-gate');
    if (!gate || !document.body.classList.contains('note-protected')) return;
    function unlock() {
      document.body.classList.add('note-unlocked');
      gate.hidden = true;
      window.dispatchEvent(new Event('resize'));
    }
    try {
      if (sessionStorage.getItem(STORAGE_KEY) === '1') {
        unlock();
        return;
      }
    } catch (err) { /* 私密窗口可能禁用会话存储。 */ }
    var form = document.getElementById('note-lock-form');
    var input = document.getElementById('note-lock-code');
    var toggle = document.getElementById('note-lock-visibility');
    var submit = document.getElementById('note-lock-submit');
    var error = document.getElementById('note-lock-error');
    if (!form || !input || !toggle || !submit || !error) return;
    function feedback(message) {
      error.textContent = message;
      input.setAttribute('aria-invalid', message ? 'true' : 'false');
    }
    toggle.addEventListener('click', function () {
      var visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      toggle.setAttribute('aria-pressed', visible ? 'true' : 'false');
      toggle.setAttribute('aria-label', visible ? '隐藏访问码' : '显示访问码');
      input.focus();
    });
    input.addEventListener('input', function () { feedback(''); });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (submit.disabled) return;
      if (!input.value) {
        feedback('请输入访问码。');
        input.focus();
        return;
      }
      if (!window.crypto || !window.crypto.subtle || !window.TextEncoder) {
        feedback('当前浏览器无法验证访问码，请使用 HTTPS 打开网站。');
        return;
      }
      submit.disabled = true;
      window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.value)).then(function (bytes) {
        return Array.prototype.map.call(new Uint8Array(bytes), function (byte) {
          return byte.toString(16).padStart(2, '0');
        }).join('');
      }).then(function (digest) {
        if (digest !== EXPECTED_SHA256) {
          feedback('访问码错误，请重新输入。');
          input.select();
          input.focus();
          return;
        }
        input.value = '';
        try {
          sessionStorage.setItem(STORAGE_KEY, '1');
          location.reload();
        } catch (err) {
          unlock();
        }
      }).catch(function () {
        feedback('验证失败，请重试。');
      }).finally(function () {
        submit.disabled = false;
      });
    });
    input.focus({ preventScroll: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
