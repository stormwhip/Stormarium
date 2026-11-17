/* ===========================================================
   tool.js —— 两个在线工具页的静态壳交互（零依赖、离线可加载）
   · 前端先拦：扩展名白名单 + 20 MB 上限
   · POST /api/jobs（multipart: file / tool / task）→ 拿 id
   · 每 1.5 秒 GET /api/jobs/<id> 轮询，最多 3 分钟
   · done → 显示「下载 PDF」（pdf_url）
   页面里没有任何 API Key；接口地址由 data-root 拼成相对路径。
   =========================================================== */
(function () {
  'use strict';

  var app = document.getElementById('tool-app');
  if (!app) return;

  var TOOL = app.getAttribute('data-tool') || 'summary';
  var ROOT = app.getAttribute('data-root') || '';
  var API = ROOT + 'api/jobs';
  var MAX_BYTES = 20 * 1024 * 1024;
  var POLL_MS = 1500;
  var MAX_WAIT_MS = 3 * 60 * 1000;

  var dropZone = document.getElementById('drop-zone');
  var fileInput = document.getElementById('file-input');
  var ALLOWED = fileInput.accept.split(',').map(function (extension) {
    return extension.trim().slice(1).toLowerCase();
  });
  var fileChosen = document.getElementById('file-chosen');
  var fileNameEl = document.getElementById('file-name');
  var fileSizeEl = document.getElementById('file-size');
  var fileClear = document.getElementById('file-clear');
  var startBtn = document.getElementById('start-btn');
  var statusBox = document.getElementById('status');
  var progressTrack = document.getElementById('progress-track');
  var progressBar = document.getElementById('progress-bar');
  var statusText = document.getElementById('status-text');
  var resultBox = document.getElementById('result');
  var downloadBtn = document.getElementById('download-btn');
  var errorBox = document.getElementById('error-box');
  var taskSelect = document.getElementById('task-select');
  var taskButtons = Array.prototype.slice.call(document.querySelectorAll('.task-btn'));
  var currentTask = taskButtons.length
    ? (document.querySelector('.task-btn.is-active') || taskButtons[0]).getAttribute('data-task')
    : (taskSelect ? taskSelect.value : '');

  /* 任务类型：优先用按钮组，其次回退到旧的下拉框 */
  function selectedTask() {
    if (taskButtons.length) return currentTask;
    return taskSelect ? taskSelect.value : '';
  }
  taskButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (btn.disabled || polling) return;
      currentTask = btn.getAttribute('data-task');
      taskButtons.forEach(function (b) {
        var on = b === btn;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    });
  });

  var chosenFile = null;
  var polling = false;
  var jobStartedAt = 0;

  /* 后端 state → 兜底进度（后端没给 progress 时用） */
  var STATE_PCT = { queued: 5, extracting: 25, llm: 55, typesetting: 85, done: 100, error: 100 };
  var STATE_TEXT = {
    queued: '排队中…',
    extracting: '正在抽取文本…',
    llm: 'AI 正在生成内容…',
    typesetting: '正在排版并编译 PDF…'
  };

  function showError(msg) {
    errorBox.textContent = String(msg || '出错了，请稍后再试。');
    errorBox.hidden = false;
  }
  function clearError() {
    errorBox.textContent = '';
    errorBox.hidden = true;
  }
  function extOf(name) {
    var i = String(name).lastIndexOf('.');
    return i < 0 ? '' : String(name).slice(i + 1).toLowerCase();
  }
  function fmtSize(n) {
    if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    return Math.max(1, Math.round(n / 1024)) + ' KB';
  }
  function clampPct(n) {
    n = Number(n);
    if (!isFinite(n) || n < 0) return 0;
    if (n <= 1) return Math.round(n * 100); // 兼容后端给 0~1 小数
    return Math.min(100, Math.round(n));
  }
  function setProgress(pct, text) {
    var v = Math.max(0, Math.min(100, Number(pct) || 0));
    if (progressBar) progressBar.style.width = v + '%';
    if (progressTrack) progressTrack.setAttribute('aria-valuenow', String(v));
    if (statusText && text) statusText.textContent = text;
  }
  function setBusy(busy) {
    startBtn.disabled = busy || !chosenFile;
    fileClear.disabled = busy;
    dropZone.classList.toggle('is-busy', !!busy);
    dropZone.setAttribute('aria-disabled', busy ? 'true' : 'false');
    if (taskSelect) taskSelect.disabled = busy;
    taskButtons.forEach(function (b) { b.disabled = !!busy; });
  }
  function resetOutput() {
    resultBox.hidden = true;
    statusBox.hidden = true;
    downloadBtn.setAttribute('href', '#');
    setProgress(0, '');
  }
  function isOnline() {
    return location.protocol === 'http:' || location.protocol === 'https:';
  }
  function validate(file) {
    if (!file) return '没有选择文件。';
    if (ALLOWED.indexOf(extOf(file.name)) < 0) {
      return '不支持的文件类型：只支持 ' + ALLOWED.join(' / ').toUpperCase() + '。';
    }
    if (file.size > MAX_BYTES) return '文件太大：单个文件不能超过 20 MB。';
    if (!file.size) return '这个文件是空的，请换一个文件。';
    return '';
  }
  function resolveUrl(url) {
    if (typeof url !== 'string' || !url) return '';
    try {
      var resolved = new URL(url, location.href);
      if (resolved.origin !== location.origin ||
          !/^\/api\/files\/[0-9a-f]{32}\.pdf$/.test(resolved.pathname) ||
          resolved.search || resolved.hash) return '';
      return resolved.href;
    } catch (e) { return ''; }
  }
  function errorText(data, status) {
    if (data && data.error) return String(data.error);
    if (status === 413) return '文件太大（超过 20 MB），服务器拒收了。';
    if (status === 429) return '今天的使用次数已达上限，请明天再来。';
    if (status === 400) return '请求不正确，请刷新页面后重试。';
    if (status >= 500) return '服务器开小差了，请稍后再试。';
    return '';
  }

  function setFile(file) {
    clearError();
    var err = validate(file);
    if (err) {
      chosenFile = null;
      fileInput.value = '';
      fileChosen.hidden = true;
      startBtn.disabled = true;
      showError(err);
      return;
    }
    chosenFile = file;
    fileNameEl.textContent = file.name;
    fileSizeEl.textContent = fmtSize(file.size);
    fileChosen.hidden = false;
    startBtn.disabled = false;
    resetOutput();
  }

  /* ---------- 选择 / 拽拽 ---------- */
  function pickFile() {
    if (polling) return;
    fileInput.value = '';
    fileInput.click();
  }
  dropZone.addEventListener('click', function (ev) {
    if (ev.target === fileInput || polling) return;
    pickFile();
  });
  dropZone.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
      ev.preventDefault();
      pickFile();
    }
  });
  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files[0]) setFile(fileInput.files[0]);
  });
  fileClear.addEventListener('click', function (ev) {
    ev.stopPropagation();
    pickFile();
  });

  ['dragenter', 'dragover'].forEach(function (name) {
    dropZone.addEventListener(name, function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (!polling) dropZone.classList.add('is-drag');
    });
  });
  ['dragleave', 'dragend'].forEach(function (name) {
    dropZone.addEventListener(name, function (ev) {
      ev.preventDefault();
      dropZone.classList.remove('is-drag');
    });
  });
  dropZone.addEventListener('drop', function (ev) {
    ev.preventDefault();
    ev.stopPropagation();
    dropZone.classList.remove('is-drag');
    if (polling) return;
    var files = ev.dataTransfer && ev.dataTransfer.files;
    if (files && files[0]) setFile(files[0]);
  });
  // 避免把文件拖到页面其它地方时浏览器直接打开它
  ['dragover', 'drop'].forEach(function (name) {
    window.addEventListener(name, function (ev) {
      if (ev.target && dropZone.contains(ev.target)) return;
      ev.preventDefault();
    });
  });

  /* ---------- 轮询进度 ---------- */
  function updateProgress(data) {
    var state = data.state || '';
    var pct = (typeof data.progress === 'number') ? clampPct(data.progress) : (STATE_PCT[state] != null ? STATE_PCT[state] : 0);
    var parts = [];
    if (data.step) parts.push(String(data.step));
    if (data.message) parts.push(String(data.message));
    if (!parts.length && STATE_TEXT[state]) parts.push(STATE_TEXT[state]);
    if (!parts.length) parts.push('处理中…');
    setProgress(pct, parts.join(' · '));
  }

  function finishError(msg) {
    polling = false;
    setBusy(false);
    statusBox.hidden = true;
    resultBox.hidden = true;
    showError(msg || '生成失败，请稍后再试。');
  }

  function finishDone(data) {
    polling = false;
    setBusy(false);
    setProgress(100, '已完成');
    var url = resolveUrl(data.pdf_url);
    if (!url) {
      finishError('生成完成但没有拿到 PDF 下载地址，请稍后再试。');
      return;
    }
    downloadBtn.setAttribute('href', url);
    resultBox.hidden = false;
    statusBox.hidden = false;
    statusText.textContent = data.message ? String(data.message) : '已完成，可以下载了。';
  }

  function startPolling(id) {
    polling = true;
    jobStartedAt = Date.now();
    var tick = function () {
      if (!polling) return;
      if (Date.now() - jobStartedAt > MAX_WAIT_MS) {
        finishError('处理超时（超过 3 分钟），请稍后重试。');
        return;
      }
      fetch(ROOT + 'api/jobs/' + encodeURIComponent(id), { headers: { Accept: 'application/json' }, cache: 'no-store' })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            return { ok: res.ok, status: res.status, data: data };
          });
        })
        .then(function (r) {
          if (!r.ok) {
            finishError(errorText(r.data, r.status) || '查询进度失败，请稍后再试。');
            return;
          }
          var data = r.data || {};
          if (data.state === 'done') { finishDone(data); return; }
          if (data.state === 'error') { finishError(data.error || '生成失败，请稍后再试。'); return; }
          updateProgress(data);
          setTimeout(tick, POLL_MS);
        })
        .catch(function () {
          // 网络短暂抖动：继续重试，直到 3 分钟总超时
          setTimeout(tick, POLL_MS);
        });
    };
    setTimeout(tick, POLL_MS);
  }

  /* ---------- 上传并开始 ---------- */
  function start() {
    if (!chosenFile || polling) return;
    if (!isOnline()) {
      showError('本地双击打开的页面无法使用在线工具，请通过网站域名访问。');
      return;
    }
    clearError();
    resetOutput();
    statusBox.hidden = false;
    setProgress(8, '正在上传文件…');
    setBusy(true);
    polling = true;

    var fd = new FormData();
    fd.append('file', chosenFile);
    fd.append('tool', TOOL);
    var taskValue = selectedTask();
    if (taskValue) fd.append('task', taskValue);

    fetch(API, { method: 'POST', body: fd })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          return { ok: res.ok, status: res.status, data: data };
        });
      })
      .then(function (r) {
        if (!r.ok || !r.data || !r.data.id) {
          finishError(errorText(r.data, r.status) || '上传失败，请检查网络后重试。');
          return;
        }
        setProgress(10, '文件已上传，等待处理…');
        startPolling(r.data.id);
      })
      .catch(function () {
        finishError('上传失败：请检查网络后重试。');
      });
  }

  startBtn.addEventListener('click', start);
  window.addEventListener('beforeunload', function (ev) {
    if (polling) {
      ev.preventDefault();
      ev.returnValue = '';
    }
  });
})();
