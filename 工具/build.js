#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ===========================================================================
 *  个人笔记网站生成器  build.js
 * ---------------------------------------------------------------------------
 *  作用：把「内容\<学科>\<笔记名>\markdown\」里的 Markdown，加上同一笔记文件夹
 *        里的 pdf\ / latex\ / 图片\ 素材（以及「内容\图片」全局兜底图片），
 *        生成一套纯静态、全相对路径、断网也能看的网站，输出到「网站\」文件夹。
 *
 *  内容结构（2026-10 起）：
 *    内容\化学\预科一化学笔记\
 *      ├ markdown\预科一化学笔记.md
 *      ├ pdf\预科一化学笔记.pdf
 *      ├ latex\预科一化学笔记.tex
 *      └ 图片\*.png
 *  兼容：若新结构一篇笔记都扫不到，会自动回退扫描旧结构「内容\笔记\<学科>\*.md」并报警。
 *
 *  特点：
 *    · 零 npm 依赖，只用 Node 内置模块（fs / path / vm / zlib / crypto）
 *    · Markdown 解析用内置单文件 marked（放在 工具\依赖\marked.min.js）
 *    · 代码高亮用内置单文件 highlight.js（放在 工具\依赖\highlight.min.js）
 *    · 所有输出都用相对路径，不上外网 CDN，双击 index.html 也能正常浏览
 *
 *  用法：双击「生成网站.bat」，或者在这里运行 node 工具\build.js
 * ===========================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const searchIndex = require('./search-index');

const ROOT = path.resolve(__dirname, '..');
const P = (...parts) => path.join(...parts);
const GITHUB_REPO = 'stormwhip/Stormarium';
const GITHUB_REF = (() => {
  const sha = String(process.env.GITHUB_SHA || '').trim();
  if (/^[0-9a-f]{40}$/.test(sha)) return sha;
  try {
    const local = require('child_process').execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (/^[0-9a-f]{40}$/.test(local)) return local;
  } catch (e) { /* Local source archive without Git metadata. */ }
  return 'main';
})();
function githubSourceHref(abs) {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/');
  if (!rel.startsWith('内容/') || rel.split('/').includes('..')) {
    throw new Error('GitHub 下载文件路径无效：' + rel);
  }
  return 'https://raw.githubusercontent.com/' + GITHUB_REPO + '/' + GITHUB_REF + '/' + encodeSegs(rel);
}

const DIRS = {
  root: ROOT,
  config: P(ROOT, '站点配置.json'),
  dep: P(ROOT, '工具', '依赖'),
  tpl: P(ROOT, '工具', '模板'),
  assets: P(ROOT, '工具', '模板', 'assets'),
  content: P(ROOT, '内容'),
  images: P(ROOT, '内容', '图片'),            // 全局图片兜底（老笔记可能引用）
  legacyNotes: P(ROOT, '内容', '笔记'),      // 旧结构：内容\笔记\<学科>\*.md（仅安全网用）
  legacyFiles: P(ROOT, '内容', '附件'),      // 旧结构附件（仅安全网用）
  katex: P(ROOT, '工具', '依赖', 'katex'),
  out: P(ROOT, '网站'),
};

const OUT_ASSETS = 'assets';
const OUT_IMG = 'assets/img';
const OUT_FILE = 'assets/file';
const OUT_KATEX = 'assets/katex';
const NOTE_DIRNAME = 'notes';
const SUBJECT_DIRNAME = 'subjects';
const TOOL_DIRNAME = 'tools';
const SUBJECT_SLUGS = { '语文': 'chinese', '数学': 'math', '英语': 'english', '物理': 'physics', '化学': 'chemistry', '生物': 'biology', '其他': 'other', '综合资料': 'resources' };
const MIT1806_NOTE_NAME = 'MIT18.06线性代数计算笔记_Lecture1-19选编';
const MIT1806_LEGACY_NAMES = [
  'MIT18.06线性代数计算笔记_Lecture1-16选编',
  'MIT18.06线性代数计算笔记_Lecture1-17选编',
];
const NOTE_SLUGS = {
  '语文 I 戏剧部分复习作业': 'chinese1-drama-review',
  '无机化学实验教材': 'inorganic-lab', '预科二化学笔记': 'prep2-chemistry', '预科一化学笔记': 'prep1-chemistry',
  '笔记格式说明': 'format-guide', '少年班生物实验讲义': 'biology-lab',
  '生物 I 笔记': 'biology-1', '预科二生物笔记': 'prep2-biology', '生物 II 笔记': 'biology-2',
  '高数上期中真题-2026': 'calculus-midterm-2026', '高数上期中真题解析-2026': 'calculus-midterm-solutions-2026',
  '数学 I 历次作业及解答': 'math1-homework', '预科二数学笔记': 'prep2-math',
  [MIT1806_NOTE_NAME]: 'mit1806', '预科二物理笔记': 'prep2-physics',
  '预科二英语笔记': 'prep2-english', '少年班结业指南-2026': 'graduation-guide-2026',
  '预科二竞赛指南': 'prep2-contest-guide', '预科二上学期期末复习手册': 'prep2-final-review',
  '2024级少年班专业选择方案': 'major-selection-2024', '少年班新生Q&A-2025': 'freshmen-qa-2025',
};
const TOOL_SLUGS = { '重点总结器': 'summary', '英语课助手': 'english', '光学干涉实验室': 'interference-lab', '原子轨道可视化': 'atomic-orbitals' };
function subjectSlug(subject) { return SUBJECT_SLUGS[subject] || `subject-${sha1(subject).slice(0, 10)}`; }
function noteSlug(subject, name) { return NOTE_SLUGS[name] || `note-${sha1(`${subject}/${name}`).slice(0, 12)}`; }

// Keep shared Chinese URLs working, including query strings and chapter fragments.
function writeLegacyRedirect(legacyPath, targetPath) {
  const relative = path.posix.relative(path.posix.dirname(legacyPath), targetPath);
  const href = encodeSegs(relative);
  writeText(P(DIRS.out, ...legacyPath.split('/')), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="robots" content="noindex"><title>正在跳转</title><script>location.replace(${JSON.stringify(href)}+location.search+location.hash);</script><noscript><meta http-equiv="refresh" content="0;url=${escapeHtml(href)}"></noscript><a href="${escapeHtml(href)}">打开新地址</a></html>`);
}
// 选区问答暂时下架；保留源码，恢复时改为 true 后重新生成。
const ENABLE_NOTE_QA = false;

/* 新内容结构：内容\<学科>\<笔记名>\{markdown,pdf,latex,图片}\ */
const NOTE_MARKDOWN_DIR = 'markdown';
const NOTE_PDF_DIR = 'pdf';
const NOTE_LATEX_DIR = 'latex';
const NOTE_IMAGE_DIR = '图片';
const OUT_NOTE_IMG = 'assets/笔记图片';    // 每篇笔记自己的插图输出目录

/* 可选站点素材：站点素材\ 里的网站图标/背景/学科图标/工具图标，缺失时全部走默认样式 */
const CUSTOM_SRC = P(ROOT, '站点素材');
const OUT_CUSTOM = 'assets/custom';

/* 8 个固定学科：顺序即首页卡片顺序。空的学科也要显示（数量 0）。 */
const SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '其他', '综合资料'];
const SUBJECT_OTHER = '其他';

/* 在线 AI 工具与独立运行的实验室。 */
const TOOLS = [
  {
    name: '重点总结器',
    tpl: 'tool-summary.html',
    legacy: true,
    ico: 'Σ',
    desc: '上传 PDF / PPTX / DOCX / TXT 或图片，AI 提炼重点并排版成 PDF。',
  },
  {
    name: '英语课助手',
    tpl: 'tool-english.html',
    legacy: true,
    ico: 'Aa',
    desc: '上传课文或材料，AI 自动完成各项任务',
  },
  {
    name: '光学干涉实验室',
    tpl: 'tool-interference-lab.html',
    assets: 'interference-lab',
    ico: 'λ',
    desc: '旋转三维光路，调节参数，实时观察五种干涉条纹。',
  },
  {
    name: '原子轨道可视化',
    tpl: 'tool-atomic-orbitals.html',
    assets: 'atomic-orbitals',
    worker: 'atomic-orbitals-model.js',
    withKatex: true,
    ico: 'ψ',
    desc: '旋转氢样原子的三维轨道，观察概率点云、概率等值面和径向分布。',
  },
];

/* ----------------------------- 控制台输出 ----------------------------- */

const C = {
  reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m',
  red: '\u001b[31m', green: '\u001b[32m', yellow: '\u001b[33m',
  blue: '\u001b[36m', magenta: '\u001b[35m',
};

function say(msg) { console.log(msg); }
function step(msg) { console.log(`${C.blue}▸${C.reset} ${msg}`); }
function ok(msg) { console.log(`  ${C.green}✓${C.reset} ${msg}`); }
function warn(msg) { console.log(`  ${C.yellow}!${C.reset} ${C.yellow}${msg}${C.reset}`); }
function fail(msg) { console.log(`  ${C.red}✗${C.reset} ${C.red}${msg}${C.reset}`); }
function title(msg) { console.log(`\n${C.bold}${msg}${C.reset}`); }

/* ------------------------------- 小工具 ------------------------------- */

function readText(file) {
  let s = fs.readFileSync(file, 'utf8');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s;
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

function readBinary(file) { return fs.readFileSync(file); }

function sha1(s) { return require('crypto').createHash('sha1').update(s).digest('hex'); }

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripTags(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function countChars(s) {
  const m = String(s).replace(/\s/g, '');
  return m.length;
}

function hashOf(obj) {
  return sha1(JSON.stringify(obj)).slice(0, 10);
}

function extOf(p) { return (path.extname(p).replace(/^\./, '') || '').toLowerCase(); }

function urlJoin(base, rel) {
  if (!base) return rel;
  return base.replace(/\/+$/, '') + '/' + String(rel).replace(/^\/+/, '');
}

/** URL / 相对路径段编码（保留 / . - _ ~） */
function encodeSegs(p) {
  return String(p).split('/').map((s) => encodeURIComponent(s).replace(/%2F/gi, '/')).join('/');
}

function decodeSafe(s) {
  try { return decodeURIComponent(s); } catch (e) { return s; }
}

/* --------------------------- 读取站点配置 --------------------------- */

function loadConfig() {
  const raw = readText(DIRS.config);
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error('站点配置.json 格式有问题（多半是少了逗号或多了一个逗号）：\n' + e.message);
  }
  const cfg = {
    siteTitle: json['站点标题'] || '我的学习笔记',
    nickname: json['昵称'] || '匿名同学',
    bio: json['简介'] || '',
    avatar: json['头像'] || json['avatar'] || '',
    footerText: json['页脚文字'] || '',
    version: String(json['版本号'] || '').trim(),
    icp: String(json['备案号'] || json.icp || '').trim(),
    police: String(json['公安备案号'] || json.police || '').trim(),
    siteUrl: (json['站点地址'] || '').replace(/\/+$/, ''),
    toolboxTitle: String(json['工具箱标题'] || '').trim() || '神秘工具箱',
    links: json['社交链接'] || json['links'] || [],
    options: json['生成选项'] || {},
  };
  if (!/^\d+\.\d+\.\d+-[A-Za-z0-9]+$/.test(cfg.version)) throw new Error('版本号格式应为 MAJOR.MINOR.PATCH-选手ID');
  if (!Array.isArray(cfg.links)) cfg.links = [];
  // 过滤掉没填地址的链接（含「地址」/「名称」/ name / url 各种写法）
  cfg.links = cfg.links
    .map((l) => ({
      name: String((l && (l['名称'] || l.name)) || '').trim(),
      url: String((l && (l['地址'] || l.url)) || '').trim(),
    }))
    .filter((l) => l.url && l.name);
  // 默认主题：跟随系统 / 浅色 / 深色（也接受 auto / light / dark）
  {
    const raw = String(cfg.options['默认配色'] || '跟随系统').trim().toLowerCase();
    const map = {
      '跟随系统': 'auto', 'auto': 'auto', '系统': 'auto',
      '浅色': 'light', 'light': 'light', '亮色': 'light', '宣纸初白': 'light',
      '深色': 'dark', 'dark': 'dark', '暗色': 'dark', '墨染长夜': 'dark',
    };
    cfg.themeDefault = map[raw] || map[String(cfg.options['默认配色'] || '').trim()] || 'auto';
  }

  // 文件 CDN 前缀：填了就把 PDF / md / tex 的下载地址换成 CDN（如 https://cdn.stormwhip.com/file/），留空用相对路径
  {
    const cdnRaw = String(cfg.options['文件CDN前缀'] || '').trim();
    cfg.fileCdnPrefix = cdnRaw ? (cdnRaw.endsWith('/') ? cdnRaw : cdnRaw + '/') : '';
  }

  cfg.summaryLen = Number(cfg.options['笔记卡片摘要字数']) || 90;

  return cfg;
}

/* ----------------------------- 递归扫文件 ----------------------------- */

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) out.push(full);
    }
  }
  out.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  return out;
}

/* --------------------------- YAML frontmatter --------------------------- */

function parseFrontmatter(text) {
  const meta = {};
  const m = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { meta, body: text };
  const block = m[1];
  const body = text.slice(m[0].length);
  let currentKey = null;

  const coerce = (v) => {
    let s = String(v).trim();
    if (s === '') return '';
    const hash = s.search(/\s+#/);
    if (hash > 0 && !/^["']/.test(s)) s = s.slice(0, hash).trim();
    if ((s.startsWith('"') && s.endsWith('"') && s.length > 1) ||
        (s.startsWith("'") && s.endsWith("'") && s.length > 1)) {
      s = s.slice(1, -1);
    }
    const low = s.toLowerCase();
    if (low === 'true' || low === 'yes') return true;
    if (low === 'false' || low === 'no') return false;
    if (low === 'null' || low === '~') return null;
    return s;
  };

  const pushArr = (key, value) => {
    if (!Array.isArray(meta[key])) meta[key] = [];
    if (value !== '' && value !== null) meta[key].push(value);
  };

  for (const line of block.split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;

    // 列表项：  - xxx   或   - 标题: xxx
    const item = /^\s*-\s*(.*)$/.exec(line);
    if (item && currentKey) {
      const val = item[1].trim();
      const kv = /^([^:：]+)[:：]\s*(.*)$/.exec(val);
      pushArr(currentKey, coerce(kv ? kv[2] : val));
      continue;
    }

    const kv = /^([^:：]+)[:：]\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].trim();
    let val = kv[2].trim();
    currentKey = key;

    if (val === '') { meta[key] = ''; continue; }

    // 行内数组 [a, b, c]
    if (/^\[.*\]$/.test(val)) {
      meta[key] = val.slice(1, -1).split(',')
        .map((x) => coerce(x)).filter((x) => x !== '' && x !== null);
      continue;
    }
    meta[key] = coerce(val);
  }

  return { meta, body };
}

function asArray(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (v === '' || v == null) return [];
  return String(v).split(/[,，、]/).map((x) => x.trim()).filter(Boolean);
}

function asDate(v) {
  if (v instanceof Date) return v;
  const s = String(v == null ? '' : v).trim();
  const m = /^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?/.exec(s);
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3] || 1);
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (!isNaN(dt.getTime())) return dt;
  }
  return null;
}

function fmtDate(d) {
  if (!d) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ---------------------------- 加载 marked ---------------------------- */

function loadMarked() {
  const file = P(DIRS.dep, 'marked.min.js');
  if (!fs.existsSync(file)) throw new Error('找不到 Markdown 解析库：' + file);
  const src = readText(file);
  const sandbox = { module: { exports: {} }, exports: {}, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'marked.min.js' });
  const marked = sandbox.module.exports;
  if (!marked || typeof marked.parse !== 'function') throw new Error('marked.min.js 加载失败：没有导出 parse 函数');
  return marked;
}

/* ------------------------ 加载 highlight.js ------------------------ */

function loadHighlighter() {
  const file = P(DIRS.dep, 'highlight.min.js');
  if (!fs.existsSync(file)) return null;
  try {
    const src = readText(file);
    const sandbox = { module: { exports: {} }, exports: {}, console, window: undefined, document: undefined, navigator: undefined };
    sandbox.globalThis = sandbox;
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, { filename: 'highlight.min.js' });
    const m = sandbox.module.exports;
    const hljs = (m && typeof m.highlight === 'function') ? m
      : (m && m.default && typeof m.default.highlight === 'function') ? m.default
      : (typeof sandbox.hljs === 'object' && sandbox.hljs && typeof sandbox.hljs.highlight === 'function') ? sandbox.hljs
      : null;
    return hljs;
  } catch (e) {
    console.log(`  ${C.yellow}!${C.reset} highlight.js 加载失败，代码块将使用纯等宽样式：${e.message}`);
    return null;
  }
}

/* --------------------------- 数学公式 KaTeX --------------------------- */
/*
 * 关键点：公式在「构建时」就用 KaTeX 渲染成 HTML 写进页面，浏览器不需要加载任何
 * 渲染脚本——所以不会闪一下再变、断网也一样好看。
 * 产物只需要 网站\assets\katex\katex.min.css + fonts\*（纯字体，无 JS 请求）。
 */

function loadKatex() {
  const jsFile = P(DIRS.katex, 'katex.min.js');
  const cssFile = P(DIRS.katex, 'katex.min.css');
  if (!fs.existsSync(jsFile) || !fs.existsSync(cssFile)) return null;
  try {
    const quiet = { log() {}, warn() {}, error() {}, info() {} };
    const sandbox = {
      module: { exports: {} },
      exports: {},
      console: quiet,
      window: undefined,
      document: undefined,
      navigator: undefined,
      setTimeout,
      clearTimeout,
    };
    sandbox.globalThis = sandbox;
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(readText(jsFile), sandbox, { filename: 'katex.min.js' });
    const k = sandbox.katex
      || (sandbox.module && sandbox.module.exports && typeof sandbox.module.exports.renderToString === 'function'
        ? sandbox.module.exports : null);
    if (!k || typeof k.renderToString !== 'function') return null;
    return k;
  } catch (e) {
    warn('KaTeX 加载失败，公式会按原文显示：' + e.message);
    return null;
  }
}

/* KaTeX 比 LaTeX 严格：^{\circ} 这种「没有底数的上标」会报错
   （LaTeX 允许空底数，很多笔记里写 $30\,^{\circ}\text{C}$ 就是从 LaTeX 抄来的）。
   遇到渲染失败时，自动在上标前补一个空组 {} 再试一次，并统计修复个数。 */
let katexRepaired = 0;
function repairBareSuperscript(tex) {
  return String(tex).replace(/(\\[,;:! ]|\\quad|\\qquad|\s|^)(\^)/g, (m, pre, caret) => pre + '{}' + caret);
}

/** 单个公式 → HTML 片段；失败返回空串（调用方会降级成原文） */
function katexToHtml(katex, tex, displayMode) {
  if (!katex || !tex) return '';
  const opts = {
    displayMode: !!displayMode,
    throwOnError: false,     // 语法错误不抛异常，交给下面判断后降级
    strict: false,           // 不管 Unicode / 中文等兼容性告警
    trust: false,
    output: 'htmlAndMathml',
  };
  try {
    const html = katex.renderToString(tex, opts);
    if (html && !/class="katex-error"/.test(html)) return html;
  } catch (e) { /* 走下面的重试 */ }

  // 重试：给没有底数的上标补 {}
  const fixed = repairBareSuperscript(tex);
  if (fixed !== tex) {
    try {
      const html = katex.renderToString(fixed, opts);
      if (html && !/class="katex-error"/.test(html)) {
        katexRepaired++;
        return html;
      }
    } catch (e) { /* 还是失败，降级 */ }
  }
  return '';
}

/*
 * 行内公式 $...$ 的保守判定。
 * 目标是「宁可漏渲染，也不要把正文里的美元符号当公式」，同时又要保证
 * 单个字母（$s$ / $l$ / $g$ / $Si$）和纯数字（$2025$）这种真实写法能正常渲染。
 * 规则：
 *   · 开头 $ 前面不能是 \（转义）或 $（那是 $$）
 *   · 开头 $ 后面不能紧跟空白（「$ 100 元」是价格/货币，不是公式）
 *   · 结尾 $ 前面不能是空白 —— 「$5 和 $10」里第二个 $ 前面是空格，靠这条挡住
 *   · 结尾 $ 后面不能紧跟数字（$5$10 这种）
 *   · 内容里不能有换行、不能有裸露的 $
 *   · 内容里出现中文（\text{中文} 除外）当普通正文处理
 *   · 只有数字和标点、且首尾不是数字（$5-、$5,）当价格/区间，不当公式
 */
const INLINE_MATH_RE = /(?<![\\$\u0000])\$(?![\s$\u0000])([^\n$\u0000]{1,400}?)(?<!\s)(?<!\\)\$(?![\d$\u0000])/g;
const CJK_RE = /[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/;
/** 行内公式源码长度达到这个值就标记为「可能很宽」，由所在段落负责横向滚动 */
const LONG_MATH_MIN = 18;

function inlineMathReject(tex) {
  const t = String(tex);
  if (!t.trim() || t.length > 300) return true;
  // \text{中文}、\stackrel{通电}{...} 之类里的中文是正常的公式内容，先摘掉再判断
  const stripped = t.replace(/\\(?:text|textrm|textsf|texttt|mbox|mathrm|operatorname|textbf|mathbf|stackrel|underset|overset)\s*\{[^{}]*\}/g, '');
  // 中文 + 完全不像 LaTeX（没有反斜杠/上下标/花括号）→ 当正文，比如「$5 和 $10」里剩的残片
  if (CJK_RE.test(stripped) && !/[\\^_{}]/.test(t)) return true;
  // 只有数字和标点、而且不是以字母数字结尾的（$5-、$5,）当价格/区间；
  // $+6$、$-1$（化合价）、$2025$（年份）这类保留
  if (/^[\d\s.,:;/\-–—+*]+$/.test(t) && !/[\w]$/.test(t.trim())) return true;
  return false;
}

/**
 * 把 Markdown 正文里的公式先在构建时渲染好，正文里换成占位符。
 * 返回的 text 可以继续交给 marked；渲染结果由 restoreHtml / restoreText 塞回去。
 */
function preRenderMath(mdText, katex) {
  const store = [];
  const masked = maskCode(mdText);   // 代码块 / 行内代码先挖掉，里面的 $ 一律不动
  let text = masked.text;

  const add = (tex, displayMode, rawFull) => {
    const body = String(tex).trim();
    if (!body) return rawFull;
    const html = katexToHtml(katex, body, displayMode);
    const idx = store.length;
    store.push({
      html,
      tex: body,
      display: !!displayMode,
      ok: !!html,
      // 超过这个长度才可能宽到撑破一栏，交给段落去横向滚动；短公式保持原生渲染
      long: !displayMode && body.length >= LONG_MATH_MIN,
      raw: String(rawFull).replace(/\s*\r?\n\s*/g, ' ').trim(),
    });
    return '\u0001M' + idx + '\u0001';
  };

  // 引用块里的每行 `>` 属于 Markdown，不能传给 KaTeX 当成大于号。
  const displayMath = (full, tex, offset, source) => {
    const line = source.slice(source.lastIndexOf('\n', offset - 1) + 1, offset);
    const quoted = /^[ \t]*>[ \t]*$/.test(line);
    const clean = quoted ? tex.replace(/^[ \t]*>[ \t]?/gm, '') : tex;
    // 标题中的双美元公式属于标题文字，应按行内公式排版。
    const heading = /^[ \t]{0,3}#{1,6}[ \t]+/.test(line);
    return add(clean, !heading, full);
  };
  // 1) $$...$$（块级）
  text = text.replace(/(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$/g, displayMath);
  // 2) \[...\]（块级）
  text = text.replace(/(?<!\\)\\\[([\s\S]+?)(?<!\\)\\\]/g, displayMath);
  // 3) \(...\)（行内）
  text = text.replace(/(?<!\\)\\\(([\s\S]+?)(?<!\\)\\\)/g, (full, tex) => add(tex, false, full));
  // 4) $...$（行内，保守规则）
  text = text.replace(INLINE_MATH_RE, (full, tex) => {
    if (inlineMathReject(tex)) return full;
    return add(tex, false, full);
  });

  const htmlOf = (it) => it.html;
  return {
    text: masked.restore(text),
    count: store.length,
    failed: store.filter((x) => !x.ok).length,
    /** 还原成真正的页面 HTML（公式是 KaTeX 渲染出的标签） */
    restoreHtml(html) {
      let out = String(html);
      // 独占一个段落的块级公式：连 <p> 一起去掉，避免 <p> 里套块级元素
      out = out.replace(/<p([^>]*)>\s*\u0001M(\d+)\u0001\s*<\/p>/g, (full, attrs, i) => {
        const it = store[Number(i)];
        if (!it || !it.display) return full;
        return it.ok ? `<div${attrs}>${it.html}</div>` : `<div${attrs}><span class="math-fallback">${escapeHtml(it.raw)}</span></div>`;
      });
      out = out.replace(/\u0001M(\d+)\u0001/g, (full, i) => {
        const it = store[Number(i)];
        if (!it) return full;
        if (!it.ok) return `<span class="math-fallback">${escapeHtml(it.raw)}</span>`;
        if (it.display) return `<span class="math-block">${htmlOf(it)}</span>`;
        // 长公式加一个「标记」，下面 markMathScroll() 会把所在段落变成可横向滚动的块。
        // 注意：公式本身仍然是原生 inline，不套 inline-block、不加 overflow，
        // 否则基线会变成盒子底边（公式整体上移），短公式还会因亚像素取整冒出滚动条。
        return it.long ? `<span class="m-long">${htmlOf(it)}</span>` : it.html;
      });
      return out;
    },
    /** 还原成纯文字版本（用于目录标题、摘要、搜索索引，不夹带 KaTeX 的一大堆标签） */
    restoreText(html) {
      return String(html).replace(/\u0001M(\d+)\u0001/g, (full, i) => {
        const it = store[Number(i)];
        return it ? escapeHtml(it.tex) : full;
      });
    },
    // Keep Markdown HTML but render only visible search formulas in the browser.
    previewHtml(html) {
      return String(html).replace(/\u0001M(\d+)\u0001/g, (full, i) => {
        const it = store[Number(i)];
        return it ? `<span data-search-tex="${escapeHtml(it.tex)}">${escapeHtml(it.tex)}</span>` : '';
      });
    },
  };
}

/* --------------------- 长公式的横向滚动（段落级） --------------------- */
/*
 * 太宽的公式（比如一整条化学方程式）在手机上一栏放不下。
 * 但给公式套 inline-block + overflow 会让基线变成盒子底边（公式整体上移），
 * 短公式还会因为亚像素取整冒出多余的滚动条；给「所有含长公式的段落」加 overflow
 * 又会把个别公式的上下标切掉几像素。
 *
 * 所以这里的策略是：
 *   · 构建时只给长公式套一个 <span class="m-long"> 标记（纯 inline，零样式，不影响排版）
 *   · 浏览器端（note.js）逐段量一下，只有真的超出段落宽度的那一段才加 .math-scroll
 * 这样短公式完全不受影响，滚动条只在真的放不下时出现。
 * 注意：KaTeX 的行内公式本来就会在运算符处换行，绝大多数长公式根本不会溢出。
 */

/* --------------------- 素材解析与链接改写 --------------------- */

const ASSET_EXTS = {
  image: new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']),
  file: new Set(['pdf', 'zip', 'rar', '7z', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'txt', 'md', 'csv', 'json', 'mp3', 'wav', 'm4a', 'mp4', 'mov', 'mkv', 'webm',
    'apk', 'exe', 'psd', 'ai', 'ipynb', 'py', 'js', 'html']),
};

const assetMap = new Map();   // 绝对路径 -> { disk: 写盘相对路径, href: 网页里用的相对路径 }
const assetDisk = new Map();  // 写盘相对路径 -> 写盘相对路径（方便按网页路径反查）
const assetKind = new Map();  // 写盘相对路径 -> 'image' | 'file'
const missingAssets = [];
const usedOutputs = new Set();
const warnings = [];          // 构建过程里的非致命警告（附件多选、图片缺失提示等）

function uniqueOutPath(dir, base) {
  const ext = path.extname(base);
  const stem = path.basename(base, ext);
  let name = base;
  let out = dir + '/' + name;
  let i = 2;
  while (usedOutputs.has(out)) {
    name = `${stem}-${i}${ext}`;
    out = dir + '/' + name;
    i++;
  }
  usedOutputs.add(out);
  return out;
}

/**
 * 把一个本地素材登记进“待复制清单”。
 *  · 写盘用原始 UTF-8 文件名（磁盘上是「示例.png」，绝不能是 %E7%A4%BA...）
 *  · 网页里用百分号编码的地址
 *  · hrefPrefix：笔记页住在 网站\笔记\ 里，所以素材地址要回退一层 ../
 *  · 去哪个子目录只看扩展名，跟调用顺序无关（图片一律 assets/img，其它一律 assets/file）
 */
function registerAsset(refPath, baseDir, hrefPrefix) {
  const prefix = hrefPrefix || '';
  const clean = decodeSafe(refPath).split('#')[0].split('?')[0].trim();
  if (!clean) return null;
  const abs = path.resolve(baseDir, clean);
  const relFromRoot = path.relative(ROOT, abs).split(path.sep).join('/');

  if (assetMap.has(abs)) return prefix + encodeSegs(assetMap.get(abs).disk);

  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    if (!missingAssets.some((x) => x.abs === abs)) {
      missingAssets.push({ abs, ref: refPath, from: path.relative(ROOT, baseDir).split(path.sep).join('/') });
    }
    return null;
  }

  const ext = extOf(abs);
  const isImage = ASSET_EXTS.image.has(ext);
  const dir = isImage ? OUT_IMG : OUT_FILE;
  const absPosix = abs.split(path.sep).join('/');
  let baseName;
  if (isImage) {
    // 图片：优先保留「内容/图片」下的原始文件名，便于日后维护
    if (absPosix.startsWith(DIRS.images.split(path.sep).join('/') + '/')) {
      baseName = path.basename(abs);
    } else {
      const stem = path.basename(abs, path.extname(abs)).replace(/[^\w\u4e00-\u9fa5.-]+/g, '-');
      baseName = `${stem}-${sha1(relFromRoot).slice(0, 6)}${path.extname(abs).toLowerCase()}`;
    }
  } else {
    baseName = path.basename(abs);
  }

  const out = uniqueOutPath(dir, baseName);   // 原始 UTF-8 文件名（写盘用）
  assetMap.set(abs, { disk: out, href: prefix + encodeSegs(out) });
  assetDisk.set(out, out);
  assetKind.set(out, isImage ? 'image' : 'file');
  return prefix + encodeSegs(out);
}

/**
 * 登记「某篇笔记自己的插图」：绝对路径 fileAbs →
 *   写盘：网站\assets\笔记图片\<学科>\<笔记名>\<原始文件名>
 *   网页：hrefPrefix + 百分号编码路径（笔记页 hrefPrefix 是 ../../）
 * 写盘文件名保持原始 UTF-8 中文，绝不出现 %E7... 这种文件名。
 */
function registerNoteImage(fileAbs, subject, noteName, hrefPrefix) {
  const prefix = hrefPrefix || '';
  if (assetMap.has(fileAbs)) return prefix + encodeSegs(assetMap.get(fileAbs).disk);
  if (!fs.existsSync(fileAbs) || !fs.statSync(fileAbs).isFile()) {
    if (!missingAssets.some((x) => x.abs === fileAbs)) {
      missingAssets.push({ abs: fileAbs, ref: path.basename(fileAbs), from: path.relative(ROOT, path.dirname(fileAbs)).split(path.sep).join('/') });
    }
    return null;
  }
  const dir = `${OUT_NOTE_IMG}/${subject}/${noteName}`;
  const out = uniqueOutPath(dir, path.basename(fileAbs));
  assetMap.set(fileAbs, { disk: out, href: prefix + encodeSegs(out) });
  assetDisk.set(out, out);
  assetKind.set(out, 'image');
  return prefix + encodeSegs(out);
}

/**
 * 把笔记的 Markdown 原文件复制到 网站\assets\file\<笔记名>.md（供页面「下载 Markdown」）。
 * 返回写盘相对路径（原始 UTF-8 文件名）；调用方自行加笔记页的 ../../ 前缀。
 */
function registerNoteMarkdown(mdAbs, noteName) {
  if (!mdAbs) return null;
  let abs;
  try { abs = path.resolve(mdAbs); } catch (e) { return null; }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  if (assetMap.has(abs)) return assetMap.get(abs).disk;
  const out = uniqueOutPath(OUT_FILE, `${noteName || path.basename(abs, path.extname(abs))}.md`);
  assetMap.set(abs, { disk: out, href: encodeSegs(out) });
  assetDisk.set(out, out);
  assetKind.set(out, 'file');
  return out;
}

/**
 * 解析 Markdown 里图片引用的真实文件（相对这篇笔记的 图片\ 目录）。
 * 支持：foo.png / 图片/foo.png / ./图片/foo.png / ../图片/foo.png（含子目录），
 * 再兜底：相对 markdown\ 目录、相对笔记文件夹、全局 内容\图片\。
 */
function resolveNoteImage(refPath, noteCtx) {
  const clean = decodeSafe(refPath).split('#')[0].split('?')[0].trim().replace(/\\/g, '/');
  if (!clean) return null;
  const imgDir = P(noteCtx.noteDir, NOTE_IMAGE_DIR);
  const candidates = [];
  // 1) 明确指向「图片」目录的写法（图片/x、./图片/x、../图片/x、../../图片/x…）
  const marker = /(?:^|\/)图片\/(.+)$/.exec(clean);
  const relInImages = marker ? marker[1] : (!clean.includes('/') ? clean : '');
  if (relInImages) candidates.push(P(imgDir, relInImages.split('/').join(path.sep)));
  // 2) 裸文件名 / 子目录文件名（放在 图片\ 里时）
  candidates.push(P(imgDir, path.posix.basename(clean)));
  // 3) 相对 markdown\ 目录正常解析（兼容 ../图片/x 这类路径）
  candidates.push(path.resolve(noteCtx.mdDir, clean));
  // 4) 相对笔记文件夹解析
  candidates.push(path.resolve(noteCtx.noteDir, clean));
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    } catch (e) { /* 权限/非法路径，继续找下一个 */ }
  }
  return null;
}

/**
 * 把代码块 / 行内代码先挖掉，返回 argv 占位版本和还原函数。
 * 否则"教 Markdown 语法"的笔记里，写在代码块里的示例链接会被当成真链接去解析。
 */
function maskCode(text) {
  const store = [];
  const hide = (m) => {
    store.push(m);
    return '\u0000' + (store.length - 1) + '\u0000';
  };
  let out = String(text)
    // 围栏代码块 ```lang ... ```
    .replace(/^([ \t]*(?:`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*(?:`{3,}|~{3,})[ \t]*$)/gm, hide)
    // 行内代码 `xxx`
    .replace(/(`+)([^`\n]*?)\1/g, hide);
  return {
    text: out,
    restore(s) {
      return String(s).replace(/\u0000(\d+)\u0000/g, (full, i) => {
        const v = store[Number(i)];
        return v == null ? full : v;
      });
    },
  };
}

/**
 * 在交给 marked 之前，把 Markdown 里的图片 / 链接地址改写成输出目录里的相对路径。
 * noteCtx：当前笔记上下文 { noteDir, subject, noteName }，图片优先指向这篇笔记的 图片\。
 * 素材顺序：笔记自己的 图片\ → 相对 markdown\ 的普通相对路径 → 全局 内容\图片\ 兜底。
 */
function rewriteMarkdownAssets(mdText, mdDir, noteByAbs, hrefPrefix, noteCtx) {
  const prefix = hrefPrefix || '';
  const ctx = noteCtx || null;
  const resolveOne = (rawHref, isImage) => {
    const href = String(rawHref).trim();
    if (!href) return null;
    if (/\s/.test(href)) return null;                          // 带空格的当作普通文字，不乱改
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) return null;   // http: https: mailto: data: ...
    if (href.startsWith('//') || href.startsWith('#')) return null;

    // 按扩展名再兜一层「这是图片」的判断（引用式图片定义 [id]: 图片/x.png 也要能进图片解析）
    const hrefNoHash = decodeSafe(href).split('#')[0].split('?')[0];
    const mayBeImage = !!isImage || ASSET_EXTS.image.has(extOf(hrefNoHash));

    // 1) 图片优先找这篇笔记自己的 图片\ 目录（支持 4 种写法）
    if (mayBeImage && ctx) {
      const noteImg = resolveNoteImage(href, { noteDir: ctx.noteDir, mdDir });
      if (noteImg) {
        const out = registerNoteImage(noteImg, ctx.subject, ctx.noteName, prefix);
        if (out) return out;
      }
    }

    // 2) 普通相对路径（含老笔记的 ../图片/x.png）
    //    先判断文件真的存在再登记，避免「下一步全局兜底成功了，却还报一个缺失」。
    const relCandidate = path.resolve(mdDir, hrefNoHash);
    try {
      if (fs.existsSync(relCandidate) && fs.statSync(relCandidate).isFile()) {
        const mapped = registerAsset(href, mdDir, prefix);
        if (mapped) return mapped;
      }
    } catch (e) { /* 忽略，继续兜底 */ }

    // 3) 全局 内容\图片\ 兜底：只按文件名找
    if (mayBeImage) {
      const base = path.posix.basename(hrefNoHash.replace(/\\/g, '/'));
      const globalHit = base ? P(DIRS.images, base) : '';
      try {
        if (globalHit && fs.existsSync(globalHit) && fs.statSync(globalHit).isFile()) {
          const g = registerAsset(globalHit, DIRS.images, prefix);
          if (g) return g;
        }
      } catch (e) { /* 忽略 */ }
    }

    // 4) 本地找不到：如果是指向另一篇 .md 笔记，就改写成那篇笔记的页面
    if (/\.(md|markdown)$/i.test(href)) {
      const target = noteByAbs.get(path.resolve(mdDir, decodeSafe(href).split('#')[0]));
      if (target) return prefix + target.url;
    }

    // 5) 确实找不到：登记为缺失，最后统一给出清晰警告（构建不失败）
    try {
      if (!missingAssets.some((x) => x.abs === relCandidate)) {
        missingAssets.push({ abs: relCandidate, ref: href, from: path.relative(ROOT, mdDir).split(path.sep).join('/') });
      }
    } catch (e) { /* 忽略 */ }
    return null;   // 找不到的素材保持原样，最后统一报警告
  };

  const masked = maskCode(mdText);
  let text = masked.text;

  // 1) [文字](地址 "标题")
  text = text.replace(/(!?\[[^\]]*\]\()\s*([^()\s]+)((?:\s+"[^"]*")?\s*\))/g,
    (full, pre, href, post) => {
      const isImage = pre.trimStart().startsWith('!');
      const res = resolveOne(href, isImage);
      return res == null ? full : `${pre}${res}${post}`;
    });

  // 2) [文字]: 地址  形式的引用定义
  text = text.replace(/^([ \t]{0,3}\[[^\]\n]+\]:[ \t]*)(\S+)([ \t]+(?:".*"|'.*'|\(.*\))?[ \t]*)$/gm,
    (full, pre, href, post) => {
      const res = resolveOne(href, false);
      return res == null ? full : `${pre}${res}${post}`;
    });

  // 3) Obsidian 风格 ![[图片名]]
  text = text.replace(/!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, (full, target) => {
    const res = resolveOne(target, true);
    return res == null ? full : `![](${res})`;
  });

  return masked.restore(text);
}

/* ------------------------------ 目录 TOC ------------------------------ */

function slugify(text, used) {
  let s = String(text)
    .replace(/<[^>]*>/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '-')
    .replace(/[`~!@#$%^&*()+=\[\]{}\\|;:'",.<>/?！@#￥%……&*（）——+={}【】、；：""''《》，。？·]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
  if (!s) s = 'section';
  let base = s, i = 2;
  while (used.has(s)) { s = `${base}-${i}`; i++; }
  used.add(s);
  return s;
}

/**
 * 给 h2/h3 加 id 与锚点，并返回目录数据。
 * altHtml：同一份 HTML 的「纯文字版本」（公式已换成原文），用来算 id，
 *          这样 id 稳定、不会随 KaTeX 的标签结构变化。
 * 目录里显示的则是标题的**真实渲染结果**：Markdown（粗体、行内代码…）和
 * KaTeX 公式都会被正常渲染，而不是露出一堆 $...$ 或 ** 原文。
 */
function tocLabel(innerHtml) {
  return String(innerHtml)
    // 去掉 KaTeX 里给无障碍/复制用的 MathML 副本（视觉上看不见，留着只是白占体积）
    .replace(/<span class="katex-mathml">[\s\S]*?<\/math><\/span>/g, '')
    // 标题里可能已经带锚点了，别复制到目录里
    .replace(/<a class="anchor"[^>]*>[\s\S]*?<\/a>/g, '')
    .trim();
}

function buildToc(html, altHtml) {
  const used = new Set();
  const usedIds = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), (m) => m[1]));
  const items = [];
  const altInner = [];
  if (altHtml) {
    const altRe = /<h([123])([^>]*)>([\s\S]*?)<\/h\1>/g;
    let am;
    while ((am = altRe.exec(String(altHtml)))) altInner.push(am[3]);
  }
  let altIdx = 0;
  let sectionNumber = 0;
  const out = html.replace(/<h([123])([^>]*)>([\s\S]*?)<\/h\1>/g, (full, lvl, attrs, inner) => {
    const level = Number(lvl);
    const src = altInner.length ? (altInner[altIdx++] || inner) : inner;
    const plain = stripTags(src);
    const existing = /id\s*=\s*"([^"]*)"/.exec(attrs);
    sectionNumber++;
    const legacyId = (existing && existing[1]) || slugify(plain, used);
    used.add(legacyId);
    let id = existing && /^[a-zA-Z0-9_-]+$/.test(existing[1]) ? existing[1] : `section-${sectionNumber}`;
    if (!existing || id !== existing[1]) {
      while (usedIds.has(id)) id += '-section';
    }
    usedIds.add(id);
    const anchor = `<a class="anchor" href="#${encodeURIComponent(id)}" aria-label="本节链接">#</a>`;
    let attrs2 = existing ? attrs.replace(/id\s*=\s*"[^"]*"/, `id="${id}"`) : `${attrs} id="${id}"`;
    if (legacyId !== id && !/data-legacy-id=/.test(attrs2)) attrs2 += ` data-legacy-id="${escapeHtml(legacyId)}"`;
    // label 保留渲染后的行内标记；html 只用来算 id 和兜底
    items.push({ level, id, text: plain, label: tocLabel(inner) || escapeHtml(plain) });
    return `<h${level}${attrs2}>${inner}${anchor}</h${level}>`;
  });
  return { html: out, toc: items };
}

function renderTocHtml(toc, root) {
  if (!toc.length) return '<p class="panel-hint">这篇笔记没有小标题。</p>';
  let html = '<ol>';
  let openSub = false;
  toc.forEach((it, idx) => {
    const label = it.label || escapeHtml(it.text);
    if (it.level === 3) {
      if (!openSub) { html += '<ol>'; openSub = true; }
      html += `<li class="toc-lv3"><a href="#${encodeURIComponent(it.id)}">${label}</a></li>`;
    } else {
      if (openSub) { html += '</ol>'; openSub = false; }
      html += `<li class="toc-lv2"><a href="#${encodeURIComponent(it.id)}">${label}</a></li>`;
    }
    if (idx === toc.length - 1 && openSub) { html += '</ol>'; openSub = false; }
  });
  html += '</ol>';
  return html;
}

/* --------------------- 内容扫描：新结构 + 旧结构安全网 --------------------- */
/**
 * 新结构（2026-10 起）：
 *   内容\<学科>\<笔记名>\markdown\<任意名>.md    ← 笔记正文
 *   内容\<学科>\<笔记名>\pdf\*.pdf              ← 这篇笔记的 PDF（多个取第一个）
 *   内容\<学科>\<笔记名>\latex\*.tex            ← 这篇笔记的 LaTeX（多个取第一个）
 *   内容\<学科>\<笔记名>\图片\*                 ← 这篇笔记自己的插图
 * 学科目录名必须是 8 个学科之一，否则归入「其他」。
 * 安全网：新结构一篇都扫不到时，回退扫描旧结构 内容\笔记\<学科>\*.md，避免整站空白。
 */

/** 排序后的目录项（默认跳过 . / _ 开头；allowUnderscore 时保留 _ 开头，用于笔记文件夹） */
function sortedDirEntries(dir, allowUnderscore) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.') && (allowUnderscore || !e.name.startsWith('_')))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  } catch (e) {
    return [];
  }
}

function subjectOfNote(relFromNotes) {
  const first = String(relFromNotes).split('\\').join('/').split('/')[0];
  return SUBJECTS.includes(first) ? first : SUBJECT_OTHER;
}

/* ---------------- 用户自定义排序 ----------------
 * 内容\_学科顺序.txt        → 首页学科卡 + 学科页的先后顺序（每行一个学科名）
 * 内容\<学科>\_顺序.txt     → 该学科里笔记的先后顺序（每行一个笔记文件夹名）
 * 规则：# 开头是注释；空行忽略；没列到的自动排在最后；写错的名字会 warn 并忽略。
 */
function readNameOrder(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return [];
  }
  const out = [];
  for (const line0 of raw.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = line0.trim();
    if (!line || line.startsWith('#')) continue;
    out.push(line);
  }
  return out;
}

function buildSubjectOrder() {
  const order = [];
  for (const name of readNameOrder(P(DIRS.content, '_学科顺序.txt'))) {
    if (!SUBJECTS.includes(name)) {
      warnings.push(`_学科顺序.txt 里的「${name}」不是 8 个学科之一，已忽略`);
      continue;
    }
    if (!order.includes(name)) order.push(name);
  }
  for (const s of SUBJECTS) if (!order.includes(s)) order.push(s);
  return order;
}

function buildNoteOrder(subject) {
  return readNameOrder(P(DIRS.content, subject, '_顺序.txt'));
}

/** 取目录下第一个指定扩展名的文件（按文件名排序）；多个时取第一个并 warn */
function firstFileInDir(dir, exts, label) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return null;
  }
  const allow = new Set(exts.map((x) => String(x).replace(/^\./, '').toLowerCase()));
  const files = entries
    .filter((e) => e.isFile() && allow.has(extOf(e.name)) && !e.name.startsWith('.') && !e.name.startsWith('_'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  if (!files.length) return null;
  if (files.length > 1) warnings.push(`${label} 下有 ${files.length} 个同类文件，只取第一个：${files[0]}`);
  return P(dir, files[0]);
}

/** 扫描新结构，返回笔记候选数组 */
function discoverNewStructure() {
  const hits = [];
  for (const subjEntry of sortedDirEntries(DIRS.content)) {
    if (!subjEntry.isDirectory()) continue;
    const subjName = subjEntry.name;
    // 全局图片兜底目录 + 旧结构目录，不参与新结构扫描
    if (subjName === '图片' || subjName === '笔记' || subjName === '附件') continue;
    const known = SUBJECTS.includes(subjName);
    const subject = known ? subjName : SUBJECT_OTHER;
    if (!known) warnings.push(`内容\\${subjName} 不是 8 个学科之一，已归入「${SUBJECT_OTHER}」`);
    const subjectDir = P(DIRS.content, subjName);
    // 笔记文件夹允许以 _ 开头（例如临时/草稿文件夹 _临时PDF测试）；markdown\ 里的 _ 文件仍按草稿跳过
    for (const noteEntry of sortedDirEntries(subjectDir, true)) {
      if (!noteEntry.isDirectory()) continue;
      const noteDir = P(subjectDir, noteEntry.name);
      const folderName = noteEntry.name;
      const mdDir = P(noteDir, NOTE_MARKDOWN_DIR);
      let mdNames = [];
      try {
        mdNames = fs.readdirSync(mdDir, { withFileTypes: true })
          .filter((e) => e.isFile() && /\.(md|markdown)$/i.test(e.name) && !e.name.startsWith('.') && !e.name.startsWith('_'))
          .map((e) => e.name)
          .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
      } catch (e) {
        mdNames = [];
      }
      // 只有 PDF 的笔记也算一篇：pdf\*.pdf 存在即可（多个取第一个并 warn）
      const pdfDir = P(noteDir, NOTE_PDF_DIR);
      const pdfAbs = firstFileInDir(pdfDir, ['pdf'], path.relative(ROOT, pdfDir).split(path.sep).join('/'));
      if (!mdNames.length && !pdfAbs) {
        // _ 开头的是模板/占位文件夹（内容\_模板笔记 等），静默跳过，不打扰用户
        if (!folderName.startsWith('_')) {
          warnings.push(`跳过 ${subjName}\\${folderName}：既没有 ${NOTE_MARKDOWN_DIR}\\ 里的 .md，也没有 ${NOTE_PDF_DIR}\\ 里的 .pdf`);
        }
        continue;
      }
      if (mdNames.length > 1) {
        warnings.push(`${subjName}\\${folderName}\\${NOTE_MARKDOWN_DIR} 里有 ${mdNames.length} 篇 md，只取第一篇：${mdNames[0]}`);
      }
      const mdName = mdNames[0] || '';
      hits.push({
        legacy: false,
        subject,
        sourceSubject: subjName,
        mdAbs: mdName ? P(mdDir, mdName) : null,
        pdfAbs: pdfAbs || null,
        noteDir,
        folderName,                      // 标题统一用笔记文件夹名
        noteName: mdName ? mdName.replace(/\.(md|markdown)$/i, '') : folderName,
        mdName,
        rel: mdName ? `${subject}/${folderName}/${mdName}` : `${subject}/${folderName}`,
      });
    }
  }
  return hits;
}

/** 旧结构兜底：内容\笔记\<学科>\*.md（只在安全网触发时使用） */
function discoverLegacyStructure() {
  if (!fs.existsSync(DIRS.legacyNotes)) return [];
  const isNoteFile = (abs) => {
    if (!/\.(md|markdown)$/i.test(abs)) return false;
    const segs = path.relative(DIRS.legacyNotes, abs).split(path.sep);
    return !segs.some((s) => s.startsWith('_') || s.startsWith('.'));
  };
  const allMd = walk(DIRS.legacyNotes).filter((f) => /\.(md|markdown)$/i.test(f));
  return allMd.filter(isNoteFile).map((file) => {
    const rel = path.relative(DIRS.legacyNotes, file).split(path.sep).join('/');
    const mdName = path.posix.basename(rel);
    const noteName = mdName.replace(/\.(md|markdown)$/i, '');
    return {
      legacy: true,
      subject: subjectOfNote(rel),
      mdAbs: file,
      pdfAbs: null,
      noteDir: path.dirname(file),
      folderName: noteName,        // 旧结构没有独立的笔记文件夹名，沿用 md 名
      noteName,
      mdName,
      rel,
    };
  });
}

/** 同一学科内笔记重名时给 URL 名加后缀，避免写盘互相覆盖 */
const usedNoteNames = new Set();
function allocNoteName(subject, rawName) {
  const base = rawName || '未命名笔记';
  let name = base;
  let i = 2;
  while (usedNoteNames.has(subject + '/' + name)) {
    name = `${base}-${i}`;
    i++;
  }
  usedNoteNames.add(subject + '/' + name);
  if (name !== base) warnings.push(`${subject} 学科下有重名笔记「${base}」，页面地址改用「${name}」避免覆盖`);
  return name;
}

/** 旧结构附件查找：内容\附件\<同目录>\<同名>.<ext> 或 内容\笔记\<同目录>\<同名>.<ext> */
function findSideFileForNoteLegacy(relFromNotes, extArg) {
  const ext = String(extArg).replace(/^\./, '').toLowerCase();
  const posixRel = String(relFromNotes).split('\\').join('/');
  const relDir = path.posix.dirname(posixRel);
  const dirPart = (relDir === '.' || relDir === '') ? '' : relDir.replace(/\/+$/, '') + '/';
  const stem = path.posix.basename(posixRel).replace(/\.(md|markdown)$/i, '');
  const toAbs = (dir, rel) => P(dir, rel.split('/').join(path.sep));
  const name = `${stem}.${ext}`;
  const cands = [
    { abs: toAbs(DIRS.legacyFiles, dirPart + name), kind: 'files', rel: dirPart + name },
    { abs: toAbs(DIRS.legacyNotes, dirPart + name), kind: 'notes', rel: dirPart + name },
  ];
  if (!dirPart) cands.push({ abs: toAbs(DIRS.legacyFiles, name), kind: 'files', rel: name });
  for (const c of cands) {
    try {
      if (fs.existsSync(c.abs) && fs.statSync(c.abs).isFile()) return c;
    } catch (e) { /* 权限之类的小问题，忽略继续找 */ }
  }
  return null;
}

/**
 * 取一篇笔记的附件：
 *   新结构 → <笔记名>\pdf\*.pdf / <笔记名>\latex\*.tex（不再按文件名配对）
 *   旧结构兜底 → 沿用原来的同名文件匹配
 */
function findAttachmentForNote(n, kind) {
  if (n.legacy) return findSideFileForNoteLegacy(n.rel, kind === 'pdf' ? 'pdf' : 'tex');
  const subdir = kind === 'pdf' ? NOTE_PDF_DIR : NOTE_LATEX_DIR;
  const exts = kind === 'pdf' ? ['pdf'] : ['tex'];
  const dir = P(n.noteDir, subdir);
  const hit = firstFileInDir(dir, exts, path.relative(ROOT, dir).split(path.sep).join('/'));
  if (!hit) return null;
  return { abs: hit, kind: subdir, rel: path.relative(ROOT, hit).split(path.sep).join('/') };
}

/* ---------------------------- 模板与页面 ---------------------------- */

function loadTemplates() {
  const t = (n) => readText(P(DIRS.tpl, n));
  return {
    page: t('page.html'),
    header: t('header.html'),
    footer: t('footer.html'),
    home: t('home.html'),
    note: t('note.html'),
    subject: t('subject.html'),
    tools: new Map(TOOLS.map((tool) => [tool.name, t(tool.tpl)])),
    notfound: t('404.html'),
  };
}

/** 替换模板里的 {{占位符}}（占位符名字允许中文，例如 {{昵称}}） */
function fill(tpl, map) {
  const out = tpl.replace(/\{\{([^{}\n]{1,40})\}\}/g, (full, rawKey) => {
    const key = rawKey.trim();
    return Object.prototype.hasOwnProperty.call(map, key) ? String(map[key]) : full;
  });
  // 空占位符会留下多余的空行，压一下，输出更干净
  return out.replace(/(?:\r?\n[ \t]*){3,}/g, '\n\n');
}

/* ---------------- 需求一：证明 / 例题 配色 ---------------- */
/*
 * 用户笔记里的写法：> **证明：**（蓝） / > **例**：、> **题**：（紫）
 * 构建时给对应的 <blockquote> 加 class="panel panel-proof / panel-example"。
 * 判定只看块内第一个 <strong>，且它必须出现在块内容的最开头（允许前面是 <p>）；
 * 「解」「注意」「第一步…」等其他标签块保持原样。
 */
const panelStats = { proof: 0, example: 0, note: 0 };

function markPanels(html) {
  return String(html).replace(/<blockquote(\s[^>]*)?>([\s\S]*?)<\/blockquote>/g, (full, attrs, inner) => {
    // 跳过块首空白和一个开头的 <p>，再看是不是正好以 <strong> 开头
    const lead = String(inner).replace(/^\s*(?:<p(?:\s[^>]*)?>\s*)?/, '');
    const m = /^<strong(?:\s[^>]*)?>([\s\S]*?)<\/strong>/.exec(lead);
    if (!m) return full;
    const label = stripTags(m[1]).trim();
    let cls = '';
    if (/^注意(?:[：:]|$)/.test(label)) {
      cls = 'panel panel-note';
    } else if (/^(?:证明|例|题)(?:[：:]|$)/.test(label)) {
      cls = /^证明/.test(label) ? 'panel panel-proof' : 'panel panel-example';
    }
    if (!cls) return full;
    let a = attrs || '';
    const cm = /class\s*=\s*"([^"]*)"/.exec(a);
    if (cm) {
      a = a.replace(/class\s*=\s*"([^"]*)"/, (s, old) => `class="${old} ${cls}"`);
    } else {
      a = `${a} class="${cls}"`;
    }
    if (cls.includes('proof')) panelStats.proof++;
    else if (cls.includes('example')) panelStats.example++;
    else panelStats.note++;
    return `<blockquote${a}>${inner}</blockquote>`;
  });
}

/* ---------------- 可选站点素材（站点素材\，全部可选） ---------------- */
function customAssetPath(relPath) {
  const abs = P(CUSTOM_SRC, String(relPath).split('/').join(path.sep));
  try {
    return fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : null;
  } catch (e) {
    return null;
  }
}

function firstExistingCustom(relPaths) {
  for (const rel of relPaths) {
    const abs = customAssetPath(rel);
    if (abs) return { abs, rel };
  }
  return null;
}

/** 背景支持 .jpg / .jpeg / .png（文档写 .jpg，这里宽容一点） */
function findBackgroundAsset(baseName) {
  return firstExistingCustom([`${baseName}.jpg`, `${baseName}.jpeg`, `${baseName}.png`]);
}

/** 没有 网站图标.png 时的兜底 favicon：站点标题首字 + 品牌色底（内联 SVG） */
function makeInlineFavicon(siteTitle) {
  const title = String(siteTitle || '').trim();
  const letter = Array.from(title)[0] || 'S';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
    + '<rect width="64" height="64" rx="14" fill="#2f6df6"/>'
    + '<text x="32" y="45" font-size="36" font-family="&quot;Microsoft YaHei&quot;,&quot;PingFang SC&quot;,sans-serif"'
    + ' font-weight="700" text-anchor="middle" fill="#ffffff">' + escapeHtml(letter) + '</text>'
    + '</svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

async function main() {
  const t0 = Date.now();
  say(`${C.bold}${C.magenta}========================================${C.reset}`);
  say(`${C.bold}${C.magenta}  个人笔记网站生成器${C.reset}`);
  say(`${C.bold}${C.magenta}========================================${C.reset}`);
  say(`${C.dim}目录：${ROOT}${C.reset}`);

  /* ---------- 1. 配置 ---------- */
  title('【1/7】读取站点配置');
  const cfg = loadConfig();
  ok(`站点标题：${cfg.siteTitle}`);
  ok(`昵称：${cfg.nickname}`);
  ok(`头像：${cfg.avatar ? cfg.avatar : '未设置（首页不显示头像）'}`);
  ok(`社交链接：${cfg.links.length ? cfg.links.map((l) => l.name).join('、') : '未设置（首页不显示）'}`);
  ok(`备案号：${cfg.icp ? cfg.icp : '未填写（页脚不显示这一行）'}`);
  if (!fs.existsSync(DIRS.config)) throw new Error('缺少 站点配置.json');

  /* ---------- 2. 依赖 ---------- */
  title('【2/7】加载解析依赖');
  const marked = loadMarked();
  ok(`Markdown 解析库：marked（内置在 工具\\依赖\\marked.min.js）`);
  const hljs = loadHighlighter();
  if (hljs) ok('代码高亮：highlight.js（内置单文件，离线可用）');
  else warn('代码高亮未启用，代码块使用纯等宽样式');
  const katex = loadKatex();
  if (katex) {
    ok(`数学公式：KaTeX ${katex.version || ''}（构建时渲染，页面不加载公式 JS）`.replace('  ', ' '));
  } else {
    warn('没找到 工具\\依赖\\katex\\katex.min.js 或 katex.min.css，公式将按原文显示');
  }

  const templates = loadTemplates();
  ok('HTML 模板读取完成');

  /* ---------- 3. 扫笔记（新结构优先；一篇都扫不到时回退旧结构，避免整站空白） ---------- */
  title('【3/7】扫描笔记与素材');
  if (!fs.existsSync(DIRS.content)) {
    throw new Error('找不到内容文件夹：' + DIRS.content);
  }
  const freshHits = discoverNewStructure();
  const legacyHits = discoverLegacyStructure();
  let noteHits = freshHits;
  let usingLegacy = false;
  if (!freshHits.length) {
    if (legacyHits.length) {
      noteHits = legacyHits;
      usingLegacy = true;
      warnings.unshift(`⚠️ 新结构（内容\\<学科>\\<笔记名>\\${NOTE_MARKDOWN_DIR}\\）一篇笔记都没扫到，已回退旧结构 内容\\笔记\\：找到 ${legacyHits.length} 篇。请尽快迁移到新结构！`);
    } else {
      warnings.push(`新结构（内容\\<学科>\\<笔记名>\\${NOTE_MARKDOWN_DIR}\\）和旧结构（内容\\笔记\\）都没有扫到笔记，生成的首页会没有笔记`);
    }
  } else if (legacyHits.length) {
    warnings.push(`检测到旧结构 内容\\笔记\\ 里还有 ${legacyHits.length} 篇笔记；新结构优先，旧结构已忽略`);
  }
  ok(`扫描到 ${noteHits.length} 篇笔记（${usingLegacy ? '旧结构安全网' : '新结构'}）`);
  noteHits.forEach((h) => {
    const srcRel = (h.mdAbs || h.pdfAbs)
      ? path.relative(ROOT, h.mdAbs || h.pdfAbs).split(path.sep).join('\\')
      : h.rel;
    const kind = h.mdAbs && h.pdfAbs ? 'md+pdf' : (h.mdAbs ? 'md' : 'pdf-only');
    say(`      ${C.dim}${h.subject} / ${h.noteName}  [${kind}]  ←  ${srcRel}${C.reset}`);
  });

  /* ---------- 4. 解析每篇笔记 ---------- */
  const notes = [];
  const noteByAbs = new Map();   // 绝对路径 -> 笔记记录，用于 md 之间互相链接

  for (const hit of noteHits) {
    const noteName = allocNoteName(hit.subject, hit.noteName);
    const urlNoExt = `${NOTE_DIRNAME}/${subjectSlug(hit.subject)}/${noteSlug(hit.subject, noteName)}`;
    if (notes.some((n) => n.diskPath === `${urlNoExt}.html`)) throw new Error(`笔记地址重复：${urlNoExt}`);
    const record = {
      abs: hit.mdAbs,
      mdAbs: hit.mdAbs,
      pdfAbs: hit.pdfAbs || null,
      rel: hit.rel,
      legacy: !!hit.legacy,
      subject: hit.subject,
      noteDir: hit.noteDir,
      mdName: hit.mdName,
      noteName,
      folderName: hit.folderName || noteName,
      hasMarkdown: !!hit.mdAbs,
      // 文件路径与公开链接均使用 ASCII；原中文路径另行生成兼容跳转页。
      diskPath: `${urlNoExt}.html`,
      legacyPath: `笔记/${hit.subject}/${noteName}.html`,
      // 网页地址保持简短，不随浏览器复制而转为中文百分号编码。
      url: `${urlNoExt}.html`,
      // 笔记页位于 notes/<subject>/ 下。
      root: '../'.repeat(Math.max(1, urlNoExt.split('/').length - 1)),
    };
    notes.push(record);
    if (hit.mdAbs) noteByAbs.set(path.resolve(hit.mdAbs), record);
  }

  const mdRenderer = new marked.Renderer();
  const renderer = Object.create(mdRenderer);

  renderer.code = function (codeOrToken, infostring) {
    const code = (codeOrToken && typeof codeOrToken === 'object')
      ? String(codeOrToken.text == null ? '' : codeOrToken.text)
      : String(codeOrToken == null ? '' : codeOrToken);
    let lang = (codeOrToken && typeof codeOrToken === 'object')
      ? String(codeOrToken.lang || '')
      : String(infostring || '');
    lang = lang.trim().split(/\s+/)[0] || '';
    const label = /^\{?\.?([\w+#-]+)\}?$/.exec(lang);
    const cleanLang = label ? label[1] : '';
    const cls = cleanLang ? ` class="language-${escapeHtml(cleanLang)}"` : '';
    const raw = code.replace(/\n$/, '');
    let inner = escapeHtml(raw);
    let used = '';
    if (hljs) {
      try {
        if (cleanLang && hljs.getLanguage(cleanLang)) {
          inner = hljs.highlight(raw, { language: cleanLang, ignoreIllegals: true }).value;
          used = cleanLang;
        } else {
          const auto = hljs.highlightAuto(raw);
          if (auto && auto.relevance > 5 && auto.language) { inner = auto.value; used = auto.language; }
        }
      } catch (e) { inner = escapeHtml(raw); used = ''; }
    }
    const cls2 = used ? ` class="language-${escapeHtml(used)}"` : cls;
    return `<pre><code${cls2}>${inner}</code></pre>\n`;
  };

  renderer.image = function (token) {
    // marked v15 的 renderer.image 收到的是一个 token 对象
    const href = (token && typeof token === 'object') ? token.href : token;
    const title = (token && typeof token === 'object') ? token.title : arguments[1];
    const text = (token && typeof token === 'object') ? token.text : arguments[2];
    // Markdown 图片标题可指定显示高度；宽高自动按原图比例缩放。
    const size = typeof title === 'string' && /^max-height:([1-9]\d{0,3})px$/.exec(title);
    const t = title && !size ? ` title="${escapeHtml(title)}"` : '';
    const sizing = size ? ` style="max-height:${size[1]}px;width:auto;height:auto"` : '';
    return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text || '')}"${t}${sizing} loading="lazy">`;
  };

  marked.setOptions({ renderer, gfm: true, breaks: false, headerIds: false, mangle: false });

  let katexCount = 0;
  let katexFailCount = 0;

  for (const n of notes) {
    // 附件：PDF / LaTeX（新结构 pdf\、latex\ 各取第一个；旧结构按同名匹配）
    const sideOf = (hit) => {
      if (!hit) return null;
      const sitePath = registerAsset(hit.abs, ROOT, '');
      if (!sitePath) return null;
      let size = 0;
      try { size = fs.statSync(hit.abs).size; } catch (e) { size = 0; }
      return { href: n.root + sitePath, size, name: path.basename(hit.abs) };
    };
    const pdfHit = n.legacy
      ? findSideFileForNoteLegacy(n.rel, 'pdf')
      : (n.pdfAbs ? { abs: n.pdfAbs, kind: 'pdf', rel: path.relative(ROOT, n.pdfAbs).split(path.sep).join('/') } : null);
    const texHit = n.legacy ? findSideFileForNoteLegacy(n.rel, 'tex') : findAttachmentForNote(n, 'latex');
    n.pdf = sideOf(pdfHit);
    if (n.pdf && n.folderName === '数学 I 历次作业及解答') {
      // 内容变化时生成新地址，避免旧 PDF 被浏览器或 CDN 缓存。
      const digest = require('crypto').createHash('sha256').update(readBinary(pdfHit.abs)).digest('hex').slice(0, 16);
      const versionedName = `math1-homework-${digest}.pdf`;
      n.pdf.href = n.root + OUT_FILE + '/' + versionedName;
      n.versionedPdf = { abs: pdfHit.abs, name: versionedName };
    }
    n.tex = sideOf(texHit);
    n.hasMarkdown = !!n.mdAbs;

    // Markdown 原文件也复制到站点（供页面「下载 Markdown」）
    n.md = null;
    if (n.hasMarkdown) {
      const mdDisk = registerNoteMarkdown(n.mdAbs, n.noteName);
      if (mdDisk) {
        let size = 0;
        try { size = fs.statSync(n.mdAbs).size; } catch (e) { size = 0; }
        n.md = { href: n.root + encodeSegs(mdDisk), size, name: path.basename(n.mdAbs) };
      }
    }

    if (n.folderName === '语文 I 戏剧部分复习作业') {
      // 随文件内容更新下载与预览地址，避开旧版本的缓存。
      for (const [attachment, source] of [[n.md, n.mdAbs], [n.tex, texHit?.abs], [n.pdf, pdfHit?.abs]]) {
        if (attachment && source) attachment.href += '?v=' + sha1(readBinary(source)).slice(0, 16);
      }
    }

    // 文件内容变动时更新下载地址，避免站点 CDN 复用旧版。
    for (const [item, abs] of [[n.md, n.mdAbs], [n.pdf, pdfHit?.abs], [n.tex, texHit?.abs]]) {
      if (item && abs && !item.href.includes('?v=')) {
        item.href += '?v=' + sha1(readBinary(abs)).slice(0, 16);
      }
    }

    // 「最后修改」= md 与 pdf 中较新的文件修改时间（PDF-only 就是 pdf 的时间）
    const timeStamps = [];
    const pushTime = (abs) => {
      try { if (abs && fs.existsSync(abs)) timeStamps.push(fs.statSync(abs).mtime.getTime()); } catch (e) { /* 忽略 */ }
    };
    if (n.hasMarkdown) pushTime(n.mdAbs);
    if (pdfHit && pdfHit.abs) pushTime(pdfHit.abs);
    if (texHit && texHit.abs) pushTime(texHit.abs);
    const mtime = timeStamps.length ? new Date(Math.max.apply(null, timeStamps)) : new Date();

    let meta = {};
    let body = '';
    n.html = '';
    n.toc = [];
    n.plain = '';
    if (n.hasMarkdown) {
      const rawText = readText(n.mdAbs);
      const parsed = parseFrontmatter(rawText);
      meta = parsed.meta;
      body = parsed.body;
      n.title = String(meta.title || '').trim() || n.folderName;
      n.tags = asArray(meta.tags);
      n.pinned = meta.pinned === true || String(meta.pinned).toLowerCase() === 'true';
      n.draft = meta.draft === true || String(meta.draft).toLowerCase() === 'true';
      n.frontSummary = String(meta.summary || '').trim();
    } else {
      // 只有 PDF 的笔记：标题用笔记文件夹名，没有 Markdown 正文
      n.title = n.folderName;
      n.tags = [];
      n.pinned = false;
      n.draft = false;
      n.frontSummary = '';
    }
    n.mtime = mtime;
    n.mtimeStr = fmtDate(mtime);
    n.date = (n.hasMarkdown && asDate(meta.date)) || mtime;
    n.dateStr = fmtDate(n.date);
    n.hasPdf = !!n.pdf;
    n.summary = n.frontSummary || (n.hasMarkdown ? '' : 'PDF 文档');

    // 这篇笔记自己的插图：整个 图片\ 目录都登记（即使暂时没被引用也一起复制）
    const noteImagesDir = P(n.noteDir, NOTE_IMAGE_DIR);
    try {
      if (fs.existsSync(noteImagesDir) && fs.statSync(noteImagesDir).isDirectory()) {
        for (const img of walk(noteImagesDir)) {
          if (fs.statSync(img).isFile()) registerNoteImage(img, n.subject, n.noteName, n.root);
        }
      }
    } catch (e) {
      warnings.push(`读取图片目录失败：${path.relative(ROOT, noteImagesDir)}（${e.message}）`);
    }

    // A shared ../图片/ reference needs its images alongside both source formats.
    if (texHit && readText(texHit.abs).includes('../图片/')) {
      const bundle = require('./source-bundle').createBundle(n.noteDir, n.mdAbs, texHit.abs);
      if (bundle) {
        const disk = uniqueOutPath(OUT_FILE, `${n.noteName}-源码与插图.zip`);
        n.sourceBundle = {
          href: n.root + encodeSegs(disk),
          size: bundle.length, disk, data: bundle,
        };
      }
    }

    if (n.hasMarkdown) {
      const mdDir = path.dirname(n.mdAbs);
      // 公式先在构建时渲染成 HTML（代码块里的 $ 已经被 maskCode 挖走，不会被误伤）
      const math = preRenderMath(body, katex);
      katexCount += math.count;
      katexFailCount += math.failed || 0;
      // 素材地址按「这篇笔记离网站根目录有多远」回退；图片优先指向这篇笔记的 图片\ 目录
      const rewritten = rewriteMarkdownAssets(math.text, mdDir, noteByAbs, n.root, {
        noteDir: n.noteDir,
        subject: n.subject,
        noteName: n.noteName,
      });

      let htmlTok = marked.parse(rewritten);
      // 表格套一层可横向滚动的容器
      htmlTok = htmlTok.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');

      // 同一份 HTML 出两个版本：真页面（KaTeX 标签）/ 纯文字（目录、摘要、搜索用）
      const htmlPlain = math.restoreText(htmlTok);
      // Anchor before restoring formula HTML: standalone display formulas replace <p>.
      const tokenHeadings = buildToc(htmlTok, htmlPlain);
      const searchable = searchIndex.annotate(tokenHeadings.html, htmlPlain, n.title, math.previewHtml);
      let html = markPanels(math.restoreHtml(searchable.html.replace(/<a class="anchor"[^>]*>[\s\S]*?<\/a>/g, '')));

      // 指向附件的链接加个小小的下载箭头（用 path-only 的路径精确比对，不误伤图片）
      html = html.replace(/href="([^"]+)"/g, (full, href) => {
        const clean = decodeSafe(href).split('#')[0].split('?')[0].replace(/^(?:\.\.?\/)+/, '');
        for (const [out, kind] of assetKind) {
          if (kind === 'file' && out === clean) return `href="${href}" data-file="1"`;
        }
        return full;
      });
      const built = buildToc(html, htmlPlain);
      n.html = built.html;
      n.searchSections = searchable.sections;
      n.toc = built.toc;

      n.plain = stripTags(htmlPlain).slice(0, 4000);
      n.summary = n.frontSummary || (n.plain.length > cfg.summaryLen ? n.plain.slice(0, cfg.summaryLen) + '…' : n.plain);
    }
  }

  if (katexCount) {
    if (katexFailCount) ok(`数学公式：渲染 ${katexCount - katexFailCount} 个，${katexFailCount} 个语法有误已降级为原文`);
    if (katexRepaired) ok(`数学公式：${katexRepaired} 个「无底数上标」写法已自动补 {} 修正`);
    else ok(`数学公式：渲染 ${katexCount} 个（构建时完成，页面里不加载公式 JS）`);
  }
  if (panelStats.proof || panelStats.example) {
    ok(`证明块 panel-proof：${panelStats.proof} 个；例题块 panel-example：${panelStats.example} 个；注意块 panel-note：${panelStats.note} 个`);
  }

  const drafts = notes.filter((n) => n.draft);
  const live = notes.filter((n) => !n.draft);
  if (drafts.length) {
    ok(`跳过 ${drafts.length} 篇 draft:true 的草稿：${drafts.map((d) => d.title).join('、')}`);
  }

  // 基础排序：日期倒序
  live.sort((a, b) => (b.date - a.date) || a.title.localeCompare(b.title, 'zh-Hans-CN'));

  /* 用户自定义排序：学科按 _学科顺序.txt，笔记按 内容\<学科>\_顺序.txt。
     未列出的排在对应组的最后；JS 排序是稳定的，所以结果可预测。 */
  const SUBJECT_ORDER = buildSubjectOrder();
  const orderCache = new Map();
  const noteOrderIndex = (subject, title) => {
    if (!orderCache.has(subject)) orderCache.set(subject, buildNoteOrder(subject));
    const i = orderCache.get(subject).indexOf(title);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  live.sort((a, b) => {
    const sa = SUBJECT_ORDER.indexOf(a.subject);
    const sb = SUBJECT_ORDER.indexOf(b.subject);
    if (sa !== sb) return sa - sb;
    return noteOrderIndex(a.subject, a.title) - noteOrderIndex(b.subject, b.title);
  });
  ok(`有效笔记 ${live.length} 篇（学科顺序：${SUBJECT_ORDER.join(' → ')}）`);
  // Validate optional metadata before clearing the previous successful site.
  const searchData = searchIndex.buildIndex(live, SUBJECT_ORDER, (source) => {
    const math = preRenderMath(source, katex);
    return math.previewHtml(marked.parseInline(math.text));
  });
  if (warnings.length) warnings.forEach(warn);

  /* ---------- 5. 清空输出目录 ---------- */
  title('【4/7】准备输出目录');
  if (fs.existsSync(DIRS.out)) {
    const resolved = path.resolve(DIRS.out);
    if (resolved !== P(ROOT, '网站')) throw new Error('输出目录异常，已中止：' + resolved);
    if (path.dirname(resolved) !== path.resolve(ROOT)) throw new Error('输出目录异常，已中止：' + resolved);
    fs.rmSync(resolved, { recursive: true, force: true });
    ok('已清空旧的 网站\\ 目录');
  }
  fs.mkdirSync(P(DIRS.out, OUT_ASSETS), { recursive: true });
  fs.mkdirSync(P(DIRS.out, OUT_IMG), { recursive: true });
  fs.mkdirSync(P(DIRS.out, OUT_FILE), { recursive: true });
  fs.mkdirSync(P(DIRS.out, NOTE_DIRNAME), { recursive: true });
  ok('目录结构就绪');

  /* --- 4c. 可选站点素材（站点素材\ → 网站\assets\custom\；缺失时全走默认样式） --- */
  const custom = {
    siteIconRel: '',
    brandLogo: { light: null, dark: null },    // 站标（logo+站名一张图）{ rel }
    background: { light: null, dark: null },   // { outRel, file }
    subjectIcons: new Map(),                   // 学科 -> { light?, dark? }（写盘相对路径）
    toolIcons: new Map(),                      // 工具名 -> { light?, dark? }
    cssRel: '',
    copied: 0,
  };
  const customOutDir = P(DIRS.out, OUT_CUSTOM.split('/').join(path.sep));
  const copyCustom = (asset, outRel) => {
    const dst = P(DIRS.out, outRel.split('/').join(path.sep));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, readBinary(asset.abs));
    custom.copied++;
    return outRel;
  };

  // 网站图标（512×512 PNG，可选）
  const siteIconAbs = customAssetPath('网站图标.png');
  if (siteIconAbs) {
    custom.siteIconRel = copyCustom({ abs: siteIconAbs }, `${OUT_CUSTOM}/网站图标.png`);
    ok('站点素材：网站图标.png → 网站\\assets\\custom\\网站图标.png');
  }

  // 站标（logo + 站名合成一张图；有它就整块替换「图标 + 文字」，可选深浅两版）
  const brandExts = ['.png', '.jpg', '.jpeg', '.webp'];
  const findBrandLogo = (base) => {
    for (const ext of brandExts) {
      const a = customAssetPath(base + ext);
      if (a) return { abs: a, name: base + ext };
    }
    return null;
  };
  const brandLight = findBrandLogo('站标');
  if (brandLight) {
    const rel = copyCustom(brandLight, `${OUT_CUSTOM}/${brandLight.name}`);
    custom.brandLogo.light = { rel };
    ok(`站点素材：站标（${brandLight.name}）→ 网站\\${OUT_CUSTOM.split('/').join('\\')}\\`);
    const brandDark = findBrandLogo('站标-深色');
    if (brandDark) {
      const relDark = copyCustom(brandDark, `${OUT_CUSTOM}/${brandDark.name}`);
      custom.brandLogo.dark = { rel: relDark };
      ok(`站点素材：站标深色版（${brandDark.name}）→ 同上`);
    }
  }

  // 页面背景（浅色/深色/共用；背景文件与 custom.css 放同一目录，CSS 里用相对 url）
  const bgCopyCache = new Map();
  const ensureBg = (asset, baseName) => {
    if (!asset) return null;
    if (bgCopyCache.has(asset.abs)) return bgCopyCache.get(asset.abs);
    const ext = path.extname(asset.abs).toLowerCase();
    const file = `${baseName}${ext}`;
    const outRel = copyCustom(asset, `${OUT_CUSTOM}/${file}`);
    const info = { outRel, file };
    bgCopyCache.set(asset.abs, info);
    return info;
  };
  custom.background.light = ensureBg(findBackgroundAsset('背景-浅色') || findBackgroundAsset('背景'), '背景-浅色');
  custom.background.dark = ensureBg(findBackgroundAsset('背景-深色') || findBackgroundAsset('背景'), '背景-深色');
  if (custom.background.light || custom.background.dark) {
    /* 重要：CSS 变量里的相对 url() 是按**页面地址**解析的，不是按 CSS 文件位置，
       写成 --page-bg-image: url('背景-浅色.jpg') 会让首页去请求 /背景-浅色.jpg 而 404。
       所以这里直接给 body 写 background-image（相对路径才按 custom.css 所在目录解析）。 */
    const relUrl = (info) => `url('./${encodeSegs(info.file)}')`;
    const lightInfo = custom.background.light || custom.background.dark;
    const darkInfo = custom.background.dark || custom.background.light;
    const LIGHT_OVERLAY = 'rgba(255, 255, 255, 0.65)';
    const DARK_OVERLAY = 'rgba(15, 18, 24, 0.76)';
    const imgLight = `linear-gradient(${LIGHT_OVERLAY}, ${LIGHT_OVERLAY}), ${relUrl(lightInfo)}`;
    const imgDark = `linear-gradient(${DARK_OVERLAY}, ${DARK_OVERLAY}), ${relUrl(darkInfo)}`;
    writeText(P(customOutDir, 'custom.css'), [
      '/* 自定义页面背景 —— 由 站点素材\\ 自动生成，请勿手改 */',
      `body { background-image: ${imgLight}; }`,
      "html[data-theme='dark'] body {",
      `  background-image: ${imgDark};`,
      '}',
      '@media (prefers-color-scheme: dark) {',
      "  html[data-theme='auto'] body {",
      `    background-image: ${imgDark};`,
      '  }',
      '}',
      'body {',
      '  background-size: cover;',
      '  background-position: center center;',
      '  background-repeat: no-repeat;',
      '  background-attachment: fixed;',
      '}',
      '@supports (-webkit-touch-callout: none) {',
      '  body { background-attachment: scroll; }',
      '}',
      '@media (max-width: 720px) {',
      '  body { background-attachment: scroll; }',
      '}',
      '',
    ].join('\n'));
    custom.cssRel = `${OUT_CUSTOM}/custom.css`;
    ok(`站点素材：页面背景（浅色${custom.background.light ? '✓' : '—'} / 深色${custom.background.dark ? '✓' : '—'}）→ 网站\\assets\\custom\\custom.css`);
  }

  // 学科图标 / 工具图标（88×88 / 80×80 PNG；可选 -深色.png 覆盖）
  const registerIconSet = (map, name, subdir) => {
    const light = customAssetPath(`${subdir}/${name}.png`);
    const dark = customAssetPath(`${subdir}/${name}-深色.png`);
    if (!light && !dark) return;
    const info = { light: null, dark: null };
    if (light) info.light = copyCustom({ abs: light }, `${OUT_CUSTOM}/${subdir}/${name}.png`);
    if (dark) info.dark = copyCustom({ abs: dark }, `${OUT_CUSTOM}/${subdir}/${name}-深色.png`);
    map.set(name, info);
  };
  for (const subject of SUBJECTS) registerIconSet(custom.subjectIcons, subject, '学科图标');
  for (const tool of TOOLS) registerIconSet(custom.toolIcons, tool.name, '工具图标');
  if (custom.subjectIcons.size) ok(`站点素材：学科图标 ${custom.subjectIcons.size} / ${SUBJECTS.length} 个`);
  if (custom.toolIcons.size) ok(`站点素材：工具图标 ${custom.toolIcons.size} / ${TOOLS.length} 个`);
  if (custom.copied === 0) {
    ok('站点素材：未放置自定义素材，全部使用默认样式（favicon 用内联 SVG）');
  } else {
    ok(`站点素材：共复制 ${custom.copied} 个文件（→ 网站\\assets\\custom\\，缺失的自动用默认样式）`);
  }

  // 内联 SVG favicon：没有 网站图标.png 时兜底，保证所有页面都有图标
  const inlineFaviconHref = custom.siteIconRel ? '' : makeInlineFavicon(cfg.siteTitle);

  /** 把学科/工具图标转成 <img>（浅色 + 可选深色两段，纯 CSS 切换，不闪不依赖 JS） */
  function customIconInner(info, altText, root) {
    if (!info) return null;
    const url = (rel) => root + encodeSegs(rel);
    if (info.light && info.dark) {
      return `<img class="ico-img ico-img-light" src="${escapeHtml(url(info.light))}" alt="${escapeHtml(altText)}">` +
        `<img class="ico-img ico-img-dark" src="${escapeHtml(url(info.dark))}" alt="${escapeHtml(altText)}">`;
    }
    const rel = info.light || info.dark;
    return `<img class="ico-img" src="${escapeHtml(url(rel))}" alt="${escapeHtml(altText)}">`;
  }

  /* ---------- 6. 复制静态资源 ---------- */
  title('【5/7】复制样式、脚本与图片');
  const css = readText(P(DIRS.assets, 'style.css'));
  const styleVersion = require('crypto').createHash('sha256').update(css).digest('hex').slice(0,16);
  writeText(P(DIRS.out, OUT_ASSETS, 'style.css'), css);
  ['theme.js', 'note.js', 'tool.js', 'search.js', 'search-core.js', 'note-pdf.js', 'note-pdf.css', ...(ENABLE_NOTE_QA ? ['note-qa.js', 'note-qa.css'] : [])].forEach((f) => {
    const source = readText(P(DIRS.assets, f));
    const publicSource = f === 'tool.js'
      ? source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[\t ]*\/\/[^\n]*$/gm, '').replace(/\n[\t ]*\n/g, '\n')
      : source;
    writeText(P(DIRS.out, OUT_ASSETS, f), publicSource);
  });
  const themeVersion = sha1(readBinary(P(DIRS.assets, 'theme.js'))).slice(0, 12);
  const noteScriptVersion = require('crypto').createHash('sha256')
    .update(readText(P(DIRS.assets, 'note.js'))).digest('hex').slice(0,16);
  const qaVersion = ENABLE_NOTE_QA ? require('crypto').createHash('sha256')
    .update(readText(P(DIRS.assets, 'note-qa.js'))).update(readText(P(DIRS.assets, 'note-qa.css')))
    .update(readText(P(DIRS.dep, 'marked.min.js'))).digest('hex').slice(0,16) : '';
  if (ENABLE_NOTE_QA) writeText(P(DIRS.out, OUT_ASSETS, 'marked.min.js'), readText(P(DIRS.dep, 'marked.min.js')));
  const pdfVersion = require('crypto').createHash('sha256')
    .update(readText(P(DIRS.assets, 'note-pdf.js'))).update(readText(P(DIRS.assets, 'note-pdf.css')))
    .update(readText(P(DIRS.dep, 'pdfjs', 'package.json'))).digest('hex').slice(0,16);
  function copyPdfRuntime(src, dst) {
    fs.mkdirSync(dst, {recursive:true});
    for (const item of fs.readdirSync(src, {withFileTypes:true})) {
      if (item.isDirectory()) copyPdfRuntime(P(src, item.name), P(dst, item.name));
      else if (item.isFile()) fs.writeFileSync(P(dst, item.name.replace(/\.mjs$/, '.js')), readBinary(P(src, item.name)));
    }
  }
  copyPdfRuntime(P(DIRS.dep, 'pdfjs'), P(DIRS.out, OUT_ASSETS, 'pdfjs'));
  writeText(P(DIRS.out, OUT_ASSETS, 'tool.css'), readText(P(DIRS.assets, 'tool.css')));
  writeText(P(DIRS.out, OUT_ASSETS, 'search.css'), readText(P(DIRS.assets, 'search.css')));
  searchData.version = require('crypto').createHash('sha256')
    .update(JSON.stringify(searchData))
    .update(readText(P(DIRS.assets, 'search.js')))
    .update(readText(P(DIRS.assets, 'search-core.js')))
    .update(readText(P(DIRS.assets, 'search.css'))).digest('hex').slice(0,16);
  const searchVersion = searchData.version;
  writeText(P(DIRS.out, OUT_ASSETS, `search-index.${searchVersion}.js`),
    'window.SITE_SEARCH_INDEX=' + JSON.stringify(searchData).replace(/</g, '\\u003c') + ';\n');
  ok('样式表 + 主题/笔记/工具/搜索脚本 + 工具与搜索样式');

  // highlight.js 与主题（只在有代码块时才用得上，反正一起带上）
  let hljsRel = '';
  const hljsCore = P(DIRS.dep, 'highlight.min.js');
  if (hljs && fs.existsSync(hljsCore)) {
    writeText(P(DIRS.out, OUT_ASSETS, 'highlight.min.js'), readText(hljsCore));
    const lightCss = P(DIRS.dep, 'hljs-github.min.css');
    const darkCss = P(DIRS.dep, 'hljs-github-dark.min.css');
    if (fs.existsSync(lightCss) && fs.existsSync(darkCss)) {
      writeText(P(DIRS.out, OUT_ASSETS, 'hljs-theme.css'), readText(lightCss) + '\n' + readText(darkCss));
      hljsRel = 'highlight.min.js';
      ok('highlight.js + 深浅两套配色');
    }
  }

  // Notes use SSR; search excerpts load the local renderer only when a formula is visible.
  let katexCssRel = '';
  if (katex) {
    const srcCss = P(DIRS.katex, 'katex.min.css');
    const srcFonts = P(DIRS.katex, 'fonts');
    if (fs.existsSync(srcCss) && fs.existsSync(srcFonts)) {
      writeText(P(DIRS.out, OUT_KATEX.split('/').join(path.sep), 'katex.min.css'), readText(srcCss));
      writeText(P(DIRS.out, OUT_KATEX, 'katex.min.js'), readText(P(DIRS.katex, 'katex.min.js')));
      let fontN = 0;
      for (const f of fs.readdirSync(srcFonts, { withFileTypes: true })) {
        if (!f.isFile()) continue;
        const src = P(srcFonts, f.name);
        const dst = P(DIRS.out, OUT_KATEX.split('/').join(path.sep), 'fonts', f.name);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.writeFileSync(dst, readBinary(src));
        fontN++;
      }
      katexCssRel = `${OUT_KATEX}/katex.min.css`;
      ok(`KaTeX 样式 + ${fontN} 个字体文件（→ 网站\\assets\\katex\\）`);
    } else {
      warn('工具\\依赖\\katex\\ 里缺少 katex.min.css 或 fonts\\，公式会没有字形');
    }
  }

  // 头像（配置留空则跳过，首页不渲染头像——隐私默认）
  let avatarRel = '';
  if (cfg.avatar) {
    const absAvatar = path.resolve(ROOT, decodeSafe(cfg.avatar));
    if (fs.existsSync(absAvatar) && fs.statSync(absAvatar).isFile()) {
      const relFromRoot = path.relative(ROOT, absAvatar).split(path.sep).join('/');
      const relOut = relFromRoot.startsWith('内容/')
        ? '内容/' + relFromRoot.slice('内容/'.length)
        : `内容/图片/${path.basename(absAvatar)}`;
      const dst = P(DIRS.out, relOut.split('/').join(path.sep));
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, readBinary(absAvatar));   // 二进制原样复制
      avatarRel = encodeSegs(relOut);
      ok(`头像：${cfg.avatar} → 网站\\${relOut.split('/').join('\\')}`);
    } else {
      warn(`头像文件不存在，首页将不显示头像：${cfg.avatar}`);
    }
  } else {
    ok('未配置头像（按隐私默认，首页不显示头像）');
  }

  /* ---------- 7. 生成页面 ---------- */
  title('【6/7】生成网页');

  const now = new Date();
  const buildInfo = {
    site: cfg.siteTitle,
    nickname: cfg.nickname,
    builtAt: `${fmtDate(now)} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    notes: live.length,
  };

  // 备案信息：ICP（工信部）与公安联网备案，两项都留空时整块都不渲染（不留空行）
  const beianItems = [];
  if (cfg.icp) {
    beianItems.push(`<a class="beian" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">${escapeHtml(cfg.icp)}</a>`);
  }
  if (cfg.police) {
    beianItems.push(`<a class="beian" href="https://beian.mps.gov.cn/" target="_blank" rel="noopener noreferrer">${escapeHtml(cfg.police)}</a>`);
  }
  const beianBlock = `\n    <p class="foot-line foot-beian">${beianItems.join(' · ')}
      <span class="foot-version">当前版本：${escapeHtml(cfg.version)}</span>
      <a class="foot-github" href="https://github.com/stormwhip/Stormarium" target="_blank" rel="noopener noreferrer" aria-label="在 GitHub 查看 Stormarium 源码">GitHub</a></p>`;
  const footerCommon = fill(templates.footer, {
    '昵称': escapeHtml(cfg.nickname),
    '页脚文字': cfg.footerText === 'Stormarium' ? '<span class="footer-art-brand" role="img" aria-label="Stormarium"></span>' : escapeHtml(cfg.footerText),
    '备案行': beianBlock,
  });

  /** 生成一个完整页面（统一入口，所有路径都是相对路径） */
  function page({ root, bodyClass, mainClass, pageTitle, description, body, scripts, extraHead, headerExtra, withKatex }) {
    // 顶栏左侧：优先用「站标」（logo+站名一张图）；没有则退回「图标 + 文字」
    const brandIconSrc = custom.siteIconRel
      ? `${root}${encodeSegs(custom.siteIconRel)}`
      : inlineFaviconHref;
    let brandHtml;
    if (custom.brandLogo.light) {
      const alt = escapeHtml(cfg.siteTitle);
      brandHtml = `<img class="brand-logo" src="${root}${encodeSegs(custom.brandLogo.light.rel)}" alt="${alt}" decoding="async">`;
      if (custom.brandLogo.dark) {
        brandHtml += `\n      <img class="brand-logo brand-logo-dark" src="${root}${encodeSegs(custom.brandLogo.dark.rel)}" alt="" aria-hidden="true" decoding="async">`;
      }
    } else {
      brandHtml = `<img class="brand-ico" src="${brandIconSrc}" alt="" width="24" height="24" decoding="async">`
        + `\n      <span class="brand-text">${escapeHtml(cfg.siteTitle)}</span>`;
    }
    const header = fill(templates.header, {
      ROOT: root,
      '站点标题': escapeHtml(cfg.siteTitle),
      '站点图标': brandIconSrc,
      '站标': brandHtml,
      HEADER_EXTRA: headerExtra || '',
    });
    // favicon：有自定义 网站图标.png 就用它，否则用内联 SVG（站点标题首字 + 品牌色底）
    const faviconTags = custom.siteIconRel
      ? `<link rel="icon" type="image/png" href="${root}${encodeSegs(custom.siteIconRel)}">\n`
        + `<link rel="apple-touch-icon" href="${root}${encodeSegs(custom.siteIconRel)}">`
      : `<link rel="icon" href="${inlineFaviconHref}">`;
    const head = [
      `<title>${escapeHtml(pageTitle)}</title>`,
      faviconTags,
      `<meta name="description" content="${escapeHtml(description || cfg.bio || cfg.siteTitle)}">`,
      extraHead || '',
      // KaTeX 的样式里带 @font-face，字体就放在它旁边的 fonts\ 里，全本地
      (withKatex && katexCssRel) ? `<link rel="stylesheet" href="${root}${katexCssRel}">` : '',
      `<link rel="stylesheet" href="${root}${OUT_ASSETS}/style.css?v=${styleVersion}">`,
      `<link rel="stylesheet" href="${root}${OUT_ASSETS}/search.css?v=${searchVersion}">`,
      // 自定义背景的 CSS 变量（只在放了背景图时生成）
      custom.cssRel ? `<link rel="stylesheet" href="${root}${encodeSegs(custom.cssRel)}">` : '',
      hljsRel ? `<link rel="stylesheet" href="${root}${OUT_ASSETS}/hljs-theme.css">` : '',
    ].filter(Boolean).join('\n');
    return fill(templates.page, {
      ROOT: root,
      BODYCLASS: bodyClass,
      MAIN_CLASS: mainClass ? ` ${mainClass}` : '',
      主题: cfg.themeDefault || 'auto',
      HEAD: head,
      HEADER: header,
      FOOTER: footerCommon,
      BODY: body,
      THEME_VERSION: themeVersion,
      SCRIPTS: (scripts || '') + `\n<script src="${root}${OUT_ASSETS}/search.js?v=${searchVersion}" data-search-app data-root="${root}" data-version="${searchVersion}" defer></script>`,
    });
  }

  /* --- 7a. 图片素材 --- */
  // 图片素材（笔记里引用过的 + 内容\图片 下全部，没有别处引用的也一起复制过去）
  for (const img of walk(DIRS.images)) {
    if (!ASSET_EXTS.image.has(extOf(img))) continue;
    registerAsset(path.relative(DIRS.images, img), DIRS.images, '');
  }

  /* --- 7b. 首页：只保留「笔记与资料」+「神秘工具箱」两块 --- */
  const mdCount = live.filter((n) => n.hasMarkdown).length;
  const pdfCount = live.filter((n) => n.pdf).length;
  const pdfOnlyCount = live.filter((n) => !n.hasMarkdown && n.pdf).length;
  const texCount = live.filter((n) => n.tex).length;
  ok(`笔记内容：Markdown ${mdCount} 篇、PDF ${pdfCount} 篇（其中只有 PDF 的 ${pdfOnlyCount} 篇）、LaTeX 源码 ${texCount} 篇`);

  // 按学科分组：固定 8 个学科，空学科也保留空数组（首页照样出卡片）
  const bySubject = new Map(SUBJECT_ORDER.map((s) => [s, []]));
  for (const n of live) {
    const list = bySubject.get(n.subject) || bySubject.get(SUBJECT_OTHER);
    list.push(n);
  }

  // 8 张学科卡片使用英文地址，显示名称仍为中文。
  const subjectCards = SUBJECT_ORDER.map((subject) => {
    const count = bySubject.get(subject).length;
    const href = `${SUBJECT_DIRNAME}/${subjectSlug(subject)}.html`;
    const icon = custom.subjectIcons.get(subject) || null;
    const icoInner = icon ? customIconInner(icon, subject, '') : escapeHtml(subject.slice(0, 1));
    const icoClass = icon ? 'subject-ico has-img' : 'subject-ico';
    return `    <a class="subject-card" href="${href}">` +
      `<span class="${icoClass}" aria-hidden="true">${icoInner}</span>` +
      `<span class="subject-main">` +
      `<span class="subject-name">${escapeHtml(subject)}</span>` +
      `<span class="subject-count">${count} 份资料</span>` +
      `</span>` +
      `<span class="subject-arrow" aria-hidden="true">→</span>` +
      `</a>`;
  }).join('\n');

  // 工具卡片
  const toolCards = TOOLS.map((tool) => {
    const href = `${TOOL_DIRNAME}/${TOOL_SLUGS[tool.name]}.html`;
    const icon = custom.toolIcons.get(tool.name);
    const icoInner = icon ? customIconInner(icon, tool.name, '') : escapeHtml(tool.ico);
    const icoClass = icon ? 'tool-card-ico has-img' : 'tool-card-ico';
    return `    <a class="tool-card" href="${href}">` +
      `<span class="${icoClass}" aria-hidden="true">${icoInner}</span>` +
      `<h3 class="tool-card-title">${escapeHtml(tool.name)}</h3>` +
      `<p class="tool-card-desc">${escapeHtml(tool.desc)}</p>` +
      `<span class="tool-card-link">打开工具 <span aria-hidden="true">→</span></span>` +
      `</a>`;
  }).join('\n');

  const homeBody = fill(templates.home, {
    '站点标题': escapeHtml(cfg.siteTitle),
    '学科卡片': subjectCards,
    '工具箱标题': escapeHtml(cfg.toolboxTitle),
    '工具卡片': toolCards,
  });

  writeText(P(DIRS.out, 'index.html'), page({
    root: '',
    bodyClass: 'home',
    pageTitle: cfg.siteTitle,
    description: cfg.bio || cfg.siteTitle,
    body: homeBody,
  }));
  ok(`index.html（笔记与资料 ${SUBJECTS.length} 个学科 + ${cfg.toolboxTitle} ${TOOLS.length} 个工具）`);

  /* --- 7c. 笔记页（Markdown / PDF 视图；三种格式按实际存在的文件给下载） --- */
  for (let i = 0; i < live.length; i++) {
    const n = live[i];
    const root = n.root;
    const hasToggle = n.hasMarkdown && !!n.pdf;

    const humanSize = (size) => (size >= 1024 * 1024
      ? (size / 1024 / 1024).toFixed(1) + ' MB'
      : Math.max(1, Math.round(size / 1024)) + ' KB');
    const fmtSize = (size) => (size ? `<span class="file-size">${humanSize(size)}</span>` : '');
    // 所有笔记附件从本站镜像下载，保留固定版本的下载链接。
    const fileHref = (item) => item ? item.href : '';
    const fileBtn = (cls, ico, label, item, attr) => {
      if (!item) return '';
      return `<a class="file-btn ${cls}" href="${escapeHtml(fileHref(item))}"${attr}>` +
        `<span class="file-ico" aria-hidden="true">${ico}</span>` +
        `<span class="file-text">${label}</span>${fmtSize(item.size)}</a>`;
    };

    // Source bundles preserve the shared image paths when reading/compiling offline.
    if (n.sourceBundle) fs.writeFileSync(P(DIRS.out, n.sourceBundle.disk), n.sourceBundle.data);
    const downloadBtns = [
      fileBtn('md-btn', 'MD', '下载 Markdown', n.md, ' download'),
      fileBtn('pdf-btn', 'PDF', '下载 PDF', n.pdf, ' download'),
      fileBtn('tex-btn', 'TeX', '下载 LaTeX', n.tex, ' download'),
      fileBtn('source-btn', 'ZIP', '下载源码与插图', n.sourceBundle, ' download'),
    ].filter(Boolean);
    const downloadsHtml = downloadBtns.length
      ? `    <div class="note-downloads" aria-label="下载这篇笔记">\n      ${downloadBtns.join('\n      ')}\n    </div>${n.sourceBundle ? '\n    <p class="source-download-hint">离线使用 Markdown 或 LaTeX 时，请下载「源码与插图」并完整解压，保留其中的文件夹结构。</p>' : ''}`
      : '';

    // 滑动式视图开关：左 Markdown / 右 PDF（只有两者都有时才出现）
    const switchHtml = hasToggle
      ? `    <div class="view-switch" id="view-switch" data-view="markdown" role="group" aria-label="切换显示方式（左 Markdown，右 PDF）">
      <button type="button" class="view-switch-btn is-active" data-view-btn="markdown" aria-pressed="true">Markdown</button>
      <button type="button" class="view-switch-btn" data-view-btn="pdf" aria-pressed="false">PDF</button>
      <span class="view-switch-thumb" aria-hidden="true"></span>
    </div>`
      : '';

    const tocHtml = n.toc.length ? renderTocHtml(n.toc, root) : '';
    const desktopTocHtml = tocHtml
      ? `  <aside class="toc-desktop" aria-label="页内目录">
    <p class="toc-desktop-title">本页目录</p>
    <nav class="toc" aria-label="页内目录">
${tocHtml}
    </nav>
  </aside>`
      : '';
    const mobileTocHtml = tocHtml
      ? `    <details class="toc-mobile" open>
      <summary>本页目录</summary>
      <nav class="toc" id="toc-mobile" aria-label="页内目录">
${tocHtml}
      </nav>
    </details>`
      : '';

    const mdViewHtml = n.hasMarkdown
      ? `  <div class="note-view note-view-md" id="view-markdown">
${mobileTocHtml}
    <div class="note-body" id="note-body">
${n.html}
    </div>
  </div>`
      : '';

    // PDF 视图按需逐页绘制。
    const frameTitleAttr = `data-pdf-title="${escapeHtml(n.title)} PDF 预览"`;
    const frameSrcAttr = `data-pdf-src="${escapeHtml(n.pdf ? n.pdf.href : '')}"`;
    let pdfViewHtml = '';
    if (n.pdf) {
      pdfViewHtml = `  <div class="note-view note-view-pdf" id="view-pdf"${hasToggle ? ' data-default-hidden="1"' : ''}>
    <div class="pdf-frame-wrap" id="pdf-frame-wrap" ${frameSrcAttr} ${frameTitleAttr}></div>
    <noscript><p><a href="${escapeHtml(n.pdf.href)}">打开 PDF 原文件</a>（连续阅读需要启用 JavaScript）</p></noscript>
  </div>`;
    }

    // 面包屑：首页 / 笔记与资料 / 学科 / 笔记标题（学科链接回学科目录；PDF-only 同样适用）
    const subjectPageHref = `${root}${SUBJECT_DIRNAME}/${subjectSlug(n.subject)}.html`;
    const breadcrumbHtml = `  <nav class="breadcrumb note-breadcrumb" aria-label="面包屑">
    <a href="${root}index.html">首页</a>
    <span class="crumb-sep" aria-hidden="true">/</span>
    <a href="${root}index.html#notes">笔记与资料</a>
    <span class="crumb-sep" aria-hidden="true">/</span>
    <a href="${subjectPageHref}">${escapeHtml(n.subject)}</a>
    <span class="crumb-sep" aria-hidden="true">/</span>
    <span class="crumb-current" aria-current="page">${escapeHtml(n.title)}</span>
  </nav>`;

    const noteBody = fill(templates.note, {
      '笔记标题': escapeHtml(n.title),
      '原生预览': n.pdf ? `      <a class="pdf-native-link" href="${escapeHtml(n.pdf.href)}" target="_blank" rel="noopener">原生预览 ↗</a>` : '',
      '最后修改': escapeHtml(n.mtimeStr),
      '标签行': n.tags.map((t) => `      <a class="tag-pill" href="${root}index.html">#${escapeHtml(t)}</a>`).join('\n'),
      ROOT: root,
      '面包屑': breadcrumbHtml,
      '桌面目录': desktopTocHtml,
      '笔记附加类': hasToggle ? ' has-view-toggle' : '',
      '默认视图': n.hasMarkdown ? 'markdown' : 'pdf',
      '视图切换': switchHtml,
      '下载按钮': downloadsHtml,
      'Markdown视图': mdViewHtml,
      'PDF视图': pdfViewHtml,
    });

    writeText(P(DIRS.out, n.diskPath.split('/').join(path.sep)), page({
      root,
      bodyClass: 'note',
      mainClass: tocHtml ? 'has-toc' : '',
      pageTitle: `${n.title} - ${cfg.siteTitle}`,
      description: n.summary || n.title,
      body: noteBody,
      withKatex: n.hasMarkdown || ENABLE_NOTE_QA,
      extraHead: `<script>document.documentElement.classList.add('note-js');window.SITE_CFG = { root: '${root}' };</script>` +
        (ENABLE_NOTE_QA ? `<link rel="stylesheet" href="${root}${OUT_ASSETS}/note-qa.css?v=${qaVersion}">` : '') +
        (n.pdf ? `<link rel="stylesheet" href="${root}${OUT_ASSETS}/note-pdf.css?v=${pdfVersion}">` : ''),
      scripts: [
        hljsRel && n.hasMarkdown ? `<script src="${root}${OUT_ASSETS}/highlight.min.js" defer></script>` : '',
        `<script src="${root}${OUT_ASSETS}/note.js?v=${noteScriptVersion}" defer></script>`,
        n.pdf ? `<script src="${root}${OUT_ASSETS}/note-pdf.js?v=${pdfVersion}" defer></script>` : '',
        ENABLE_NOTE_QA ? `<script src="${root}${OUT_ASSETS}/note-qa.js?v=${qaVersion}" defer></script>` : '',
      ].filter(Boolean).join('\n'),
    }));
  }
  for (const n of live) writeLegacyRedirect(n.legacyPath, n.diskPath);
  const mit1806 = live.find((n) => n.subject === '数学' && n.noteName === MIT1806_NOTE_NAME);
  if (mit1806) {
    writeLegacyRedirect('notes/math/mit1806-lectures1-16.html', mit1806.diskPath);
    for (const name of MIT1806_LEGACY_NAMES) {
      writeLegacyRedirect(`笔记/数学/${name}.html`, mit1806.diskPath);
    }
  }
  ok(`${live.length} 个笔记页（输出在 网站\\${NOTE_DIRNAME}\\，保留旧地址跳转）`);

  /* --- 7c-2. 学科页：8 个（空学科也生成，进去显示「该学科暂无资料」） --- */
  const subjectOutDir = P(DIRS.out, SUBJECT_DIRNAME);
  fs.mkdirSync(subjectOutDir, { recursive: true });
  for (const subject of SUBJECT_ORDER) {
    const items = bySubject.get(subject);
    let listHtml;
    if (items.length) {
      const rows = items.map((n) => {
        const badges = (n.hasMarkdown ? '<span class="md-badge" title="有 Markdown 版">MD</span>' : '') +
          (n.pdf ? '<span class="pdf-badge" title="有 PDF 版">PDF</span>' : '') +
          (n.tex ? '<span class="tex-badge" title="有 LaTeX 源码">LaTeX</span>' : '');
        return `      <li class="material-item">` +
          `<a class="material-title" href="../${escapeHtml(n.url)}">${escapeHtml(n.title)}</a>` +
          (badges ? `<span class="material-badges">${badges}</span>` : '') +
          `</li>`;
      }).join('\n');
      listHtml = `    <ul class="material-list">\n${rows}\n    </ul>`;
    } else {
      listHtml = '    <p class="empty-tip">该学科暂无资料</p>';
    }
    const subjectBody = fill(templates.subject, {
      '学科名': escapeHtml(subject),
      '资料列表': listHtml,
    });
    // 学科名称和公开文件名分开维护。
    writeText(P(subjectOutDir, `${subjectSlug(subject)}.html`), page({
      root: '../',
      bodyClass: 'subject',
      pageTitle: `${subject} - ${cfg.siteTitle}`,
      description: `${subject}学科的学习笔记与资料`,
      body: subjectBody,
    }));
  }
  for (const subject of SUBJECT_ORDER) writeLegacyRedirect(`学科/${subject}.html`, `${SUBJECT_DIRNAME}/${subjectSlug(subject)}.html`);
  ok(`8 个学科页（${SUBJECT_DIRNAME}\\，保留旧地址跳转）`);

  /* --- 7c-3. 工具页 --- */
  const toolOutDir = P(DIRS.out, TOOL_DIRNAME);
  fs.mkdirSync(toolOutDir, { recursive: true });
  const uploadScriptVersion = sha1(readBinary(P(DIRS.assets, 'tool.js'))).slice(0, 12);
  for (const tool of TOOLS) {
    let extraHead = `<link rel="stylesheet" href="../${OUT_ASSETS}/tool.css">`;
    let scripts = `<script src="../${OUT_ASSETS}/tool.js?v=${uploadScriptVersion}" defer></script>`;
    if (tool.assets) {
      const cssFile = `${tool.assets}.css`;
      const jsFile = `${tool.assets}.js`;
      const toolCss = readText(P(DIRS.assets, cssFile));
      const toolJs = readText(P(DIRS.assets, jsFile));
      writeText(P(DIRS.out, OUT_ASSETS, cssFile), toolCss);
      writeText(P(DIRS.out, OUT_ASSETS, jsFile), toolJs);
      extraHead += `\n<link rel="stylesheet" href="../${OUT_ASSETS}/${cssFile}?v=${sha1(toolCss).slice(0, 12)}">`;
      scripts = `<script src="../${OUT_ASSETS}/${jsFile}?v=${sha1(toolJs).slice(0, 12)}" defer></script>`;
      if (tool.worker) {
        const workerJs = readText(P(DIRS.assets, tool.worker));
        // A blob worker also runs when the generated website is opened from disk.
        scripts = `<script type="text/plain" data-tool-worker>${workerJs.replace(/<\/script/gi, '<\\/script')}</script>\n${scripts}`;
      }
      if (tool.withKatex) scripts = `<script src="../${OUT_KATEX}/katex.min.js" defer></script>\n${scripts}`;
    }
    const toolBody = fill(templates.tools.get(tool.name), {
      ROOT: '../',
      '工具箱标题': escapeHtml(cfg.toolboxTitle),
      '工具名': escapeHtml(tool.name),
      '工具简介': escapeHtml(tool.desc),
    });
    writeText(P(toolOutDir, `${TOOL_SLUGS[tool.name]}.html`), page({
      root: '../',
      bodyClass: 'tool',
      pageTitle: `${tool.name} - ${cfg.siteTitle}`,
      description: tool.desc,
      body: toolBody,
      withKatex: tool.withKatex,
      extraHead,
      scripts,
    }));
  }
  for (const tool of TOOLS) {
    if (tool.legacy) writeLegacyRedirect(`工具/${tool.name}.html`, `${TOOL_DIRNAME}/${TOOL_SLUGS[tool.name]}.html`);
  }
  ok(`${TOOLS.length} 个工具页`);

  /* --- 7d. 404 --- */
  writeText(P(DIRS.out, '404.html'), page({
    root: '/',
    bodyClass: 'notfound',
    pageTitle: `页面不存在 - ${cfg.siteTitle}`,
    description: '页面不存在',
    body: templates.notfound,
  }));
  ok('404.html');

  writeText(P(DIRS.out, 'search.html'), page({
    root: '', bodyClass: 'search', pageTitle: `知识点搜索 - ${cfg.siteTitle}`,
    description: '搜索笔记中的知识点、章节和资料，直接定位原文。',
    body: '<section class="search-page"><h1 class="visually-hidden">知识点搜索</h1><div id="search-page-app"></div><noscript><p>搜索需要启用 JavaScript。你也可以返回首页，按学科浏览资料。</p><a href="index.html">按学科浏览 →</a></noscript></section>',
  }));
  ok(`搜索：${searchData.docs.length} 份资料，${searchData.docs.reduce((n,d)=>n+d.sections.length,0)} 个章节（索引 ${searchVersion}）`);

  /* --- 7e. robots.txt / sitemap.xml / README --- */
  writeText(P(DIRS.out, 'robots.txt'), [
    'User-agent: *',
    'Allow: /',
    cfg.siteUrl ? `Sitemap: ${cfg.siteUrl}/sitemap.xml` : '# 还没配置「站点地址」，所以暂时不生成 sitemap 链接',
    '',
  ].join('\n'));
  ok('robots.txt');

  if (cfg.siteUrl) {
    // 注意：笔记 / 学科 / 工具的 url 都已经是百分号编码过的，这里不能再 encodeURI 一次
    // （否则 %E7%A4%BA 会被编成 %25E7%25A4%25BA，服务器上就成了 404）
    const subjectUrls = SUBJECT_ORDER.map((s) => `${cfg.siteUrl}/${SUBJECT_DIRNAME}/${subjectSlug(s)}.html`);
    const toolUrls = TOOLS.map((t) => `${cfg.siteUrl}/${TOOL_DIRNAME}/${TOOL_SLUGS[t.name]}.html`);
    const urls = [`${cfg.siteUrl}/`, `${cfg.siteUrl}/search.html`]
      .concat(subjectUrls)
      .concat(toolUrls)
      .concat(live.map((n) => `${cfg.siteUrl}/${n.url}`));
    const xml = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
      .concat(urls.map((u) => `  <url><loc>${escapeHtml(u)}</loc></url>`))
      .concat(['</urlset>', '']).join('\n');
    writeText(P(DIRS.out, 'sitemap.xml'), xml);
    ok(`sitemap.xml（${urls.length} 个地址）`);
  } else {
    warn('站点地址 没填，跳过 sitemap.xml（部署后填上再重新生成即可）');
  }

  writeText(P(ROOT, '网站目录说明.txt'), [
    '【给网站主人的提示，不要上传到服务器】',
    '',
    '1. 要发布的网站都在「网站\\」文件夹里。它每次生成都会被清空重写，不要在里面手改东西。',
    '2. 上传到服务器 / 静态托管时，只上传「网站\\」里的内容，不要上传「工具\\」「内容\\」「站点配置.json」。',
    '3. 要双击看的首页是：网站\\index.html',
    '4. 要写笔记请去：内容\\<学科>\\<笔记名>\\markdown\\<笔记名>.md（PDF 放同一笔记文件夹的 pdf\\，LaTeX 放 latex\\，插图放 图片\\；只有 PDF 没有 markdown 的笔记也会生成页面。页面按实际存在的文件提供 Markdown / PDF / LaTeX 下载。PDF 视图切换后直接加载（带缓存与分段加载）。学科目录：语文/数学/英语/物理/化学/生物/其他/综合资料）',
    '5. 要改网站标题、昵称、备案号请改：站点配置.json',
    '6. 完整的图文教程见：使用说明.md',
    '7. 要换网站图标 / 学科图标 / 工具图标 / 页面背景：把图片按文件名放进「站点素材\\」对应位置（详见 站点素材\\图片素材规格.md），重新生成即可；没放就用默认样式。',
    '',
    '生成时间：' + buildInfo.builtAt,
    '',
  ].join('\r\n'));

  /* --- 7h. 把登记过的素材真正复制过去（写盘用原始 UTF-8 文件名） --- */
  let copied = 0;
  for (const [abs, info] of assetMap) {
    const dst = P(DIRS.out, info.disk.split('/').join(path.sep));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, readBinary(abs));
    copied++;
  }
  for (const n of notes) {
    if (n.versionedPdf) {
      fs.copyFileSync(n.versionedPdf.abs, P(DIRS.out, OUT_FILE, n.versionedPdf.name));
    }
  }
  if (mit1806) {
    // 旧下载地址继续提供当前版，兼容已分享的链接和缓存中的旧网页。
    for (const extension of ['md', 'pdf', 'tex']) {
      const current = P(DIRS.out, OUT_FILE, `${MIT1806_NOTE_NAME}.${extension}`);
      if (!fs.existsSync(current)) continue;
      for (const name of MIT1806_LEGACY_NAMES) {
        fs.copyFileSync(current, P(DIRS.out, OUT_FILE, `${name}.${extension}`));
      }
    }
  }
  ok(`复制素材（图片 + 被引用的文件）${copied} 个`);

  /* ---------- 汇总 ---------- */
  title('【7/7】完成');
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (missingAssets.length) {
    say('');
    warn(`有 ${missingAssets.length} 个引用的文件找不到（网页里会显示成断图或断链）：`);
    missingAssets.forEach((m) => say(`      ${C.dim}${m.from} 里引用了 ${m.ref}${C.reset}`));
    say(`      ${C.dim}检查文件名大小写和扩展名；图片可放到这篇笔记的 图片\\ 目录，或全局 内容\\图片\\ 下${C.reset}`);
  }
  say('');
  say(`${C.green}${C.bold}完成！共 ${live.length} 篇笔记、${copied} 个素材，用时 ${secs} 秒。${C.reset}`);
  say(`输出目录：${C.bold}网站\\${C.reset}`);
  say(`打开首页：${C.bold}网站\\index.html${C.reset}（双击即可离线浏览）`);
  say(`${C.dim}生成时间：${buildInfo.builtAt}${C.reset}`);
}

main().catch((err) => {
  console.log('');
  console.log(`${C.red}${C.bold}生成失败：${C.reset}`);
  console.log(`${C.red}${err && err.stack ? err.stack : err}${C.reset}`);
  console.log('');
  console.log(`${C.yellow}常见原因：${C.reset}`);
  console.log('  1. 站点配置.json 里少了逗号、多了逗号，或者引号没配对；');
  console.log('  2. 文件被别的程序占用（比如正在编辑器里保存）——关掉重试；');
  console.log('  3. 网站\\ 文件夹被打开着或被占用——关掉文件夹窗口重试。');
  process.exitCode = 1;
});
