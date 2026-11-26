'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const notes = [
  '内容/数学/预科二数学笔记/markdown/预科二数学笔记.md',
  '内容/物理/预科二物理笔记/markdown/预科二物理笔记.md',
  '内容/化学/预科一化学笔记/markdown/预科一化学笔记.md',
  '内容/化学/预科二化学笔记/markdown/预科二化学笔记.md',
  '内容/生物/生物 I 笔记（by wsx）/markdown/预科二生物笔记.md',
];
const errors = [];

function report(file, line, message) {
  errors.push(file + ':' + line + ' ' + message);
}

for (const file of notes) {
  const lines = fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/);
  let chapter = 0;
  let section = 0;
  let subsection = 0;

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    const line = i + 1;

    if (/[ \t]+$/.test(text)) report(file, line, '行尾存在多余空格');
    if (text.includes('。')) report(file, line, '句末使用中文句号');
    if (/<br\s*\/?>/i.test(text)) report(file, line, '存在 HTML 换行标签');
    if (/^```/.test(text)) report(file, line, '笔记正文使用代码块');
    if (/^---+$/.test(text)) report(file, line, '笔记正文使用分隔线');

    if (/^#{1,6} /.test(text)) {
      let match;
      if (/^## [零一二三四五六七八九十]+、\S/.test(text)) {
        chapter++;
        section = 0;
        subsection = 0;
      } else if ((match = /^### (\d+)\. \S/.exec(text))) {
        if (!chapter || Number(match[1]) !== section + 1) {
          report(file, line, '节标题编号不连续');
        }
        section = Number(match[1]);
        subsection = 0;
      } else if ((match = /^#### (\d+)\.(\d+) \S/.exec(text))) {
        if (!chapter || Number(match[1]) !== section || Number(match[2]) !== subsection + 1) {
          report(file, line, '小节标题编号不连续');
        }
        subsection = Number(match[2]);
      } else {
        report(file, line, '标题层级或编号不符合规范');
      }
      if (i > 0 && lines[i - 1] !== '') report(file, line, '标题前缺少空行');
      if (i + 1 < lines.length && lines[i + 1] !== '') report(file, line, '标题后缺少空行');
    }

    const prose = text
      .replace(/\x60[^\x60]*\x60/g, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\$\$[^$\n]*\$\$|\$[^$\n]*\$/g, '');

    if (/[\u3400-\u9fff](?:\*\*)?[A-Za-z0-9]|[A-Za-z0-9](?:\*\*)?[\u3400-\u9fff]/.test(prose)) {
      report(file, line, '中文与英文或数字之间缺少半角空格（含加粗术语）');
    }
    if (/[\u3400-\u9fff]\$(?!\$)|(?<!\$)\$[\u3400-\u9fff]/.test(text)) {
      report(file, line, '中文与行内公式之间缺少半角空格');
    }
    if (/\\rightarrow|\\phi\b/.test(text)) {
      report(file, line, '公式记号使用了未统一的命令');
    }
  }
}

if (errors.length) {
  for (const error of errors) console.error(error);
  console.error('笔记格式检查发现 ' + errors.length + ' 项问题');
  process.exitCode = 1;
} else {
  console.log('笔记格式检查通过：' + notes.length + ' 篇预科数理化笔记');
}
