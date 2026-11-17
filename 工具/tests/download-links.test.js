#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const assert = require('assert').strict;
const root = path.resolve(__dirname, '../..');
const site = process.env.SITE_DIR ? path.resolve(process.env.SITE_DIR) : path.join(root, '网站');
const filesDir = path.join(site, 'assets/file');
const ref = /^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA || '') ? process.env.GITHUB_SHA
  : cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
assert.match(ref, /^[0-9a-f]{40}$/);
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const f = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(f) : entry.isFile() ? [f] : [];
  });
}
function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
const packed = new Set(walk(filesDir).map(sha));
const pages = walk(path.join(site, 'notes')).filter(f => f.endsWith('.html'));
assert(pages.length > 0, '找不到笔记页面');
const prefix = '/stormwhip/Stormarium/' + ref + '/';
const counts = { 'md-btn': 0, 'pdf-btn': 0, 'tex-btn': 0, 'source-btn': 0 };
const mdFound = new Set();
for (const page of pages) {
  const html = fs.readFileSync(page, 'utf8');
  const seen = new Set();
  const buttons = [...html.matchAll(/<a class="file-btn ([^"]+)" href="([^"]+)"([^>]*)>/g)];
  assert(buttons.length, '页面缺少下载按钮：' + page);
  for (const match of buttons) {
    const kind = match[1], url = new URL(match[2].replace(/&amp;/g, '&')), attrs = match[3];
    assert(Object.hasOwn(counts, kind), '未知下载类型：' + kind);
    assert(!seen.has(kind), '重复下载按钮：' + page + ' ' + kind);
    seen.add(kind);
    counts[kind]++;
    if (kind === 'source-btn') {
      assert.equal(url.hostname, 'github.com');
      assert(url.pathname.startsWith('/stormwhip/Stormarium/releases/download/site-' + ref + '/'));
      const name = path.basename(url.pathname);
      assert.match(name, /^source-[0-9a-f]{24}\.zip$/);
      if (process.env.CHECK_RELEASE_ASSETS === '1') {
        const release = path.join(root, 'release', name);
        assert(fs.existsSync(release), 'Release 未附带 ZIP：' + name);
        const expectedPrefix = name.slice(7, 31);
        const matchZip = walk(filesDir).find(f => f.endsWith('-源码与插图.zip') &&
          crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').startsWith(expectedPrefix));
        assert(matchZip && sha(matchZip) === sha(release), 'Release ZIP 与网站源码包不同');
      }
      continue;
    }
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, 'raw.githubusercontent.com');
    assert(url.pathname.startsWith(prefix), '版本不匹配：' + url.pathname);
    const rel = decodeURIComponent(url.pathname.slice(prefix.length));
    assert(rel.startsWith('内容/') && !rel.split('/').includes('..'), '源文件路径无效：' + rel);
    const source = path.join(root, ...rel.split('/'));
    assert(fs.existsSync(source), 'GitHub 源文件不存在：' + rel);
    const ext = { 'md-btn': /\.(md|markdown)$/, 'pdf-btn': /\.pdf$/, 'tex-btn': /\.tex$/ }[kind];
    assert(ext.test(rel), '源文件格式不符：' + rel);
    assert(packed.has(sha(source)), '源文件与生成资源内容不一致：' + rel);
    assert(attrs.includes('data-github-download='), '缺少跨域文件下载支持：' + rel);
    if (kind === 'md-btn') mdFound.add(rel);
  }
}
const markdown = walk(path.join(root, '内容'))
  .map(f => path.relative(root, f).split(path.sep).join('/'))
  .filter(f => /\/markdown\/[^/]+\.(md|markdown)$/.test(f))
  .filter(f => !f.split('/').some(part => part.startsWith('_')))
  .filter(f => {
    const contents = fs.readFileSync(path.join(root, ...f.split('/')), 'utf8');
    const fm = contents.startsWith('---') ? contents.split('---')[1] || '' : '';
    return !/^\s*draft:\s*true\s*$/m.test(fm);
  });
for (const file of markdown) assert(mdFound.has(file), '漏掉 Markdown 下载：' + file);
assert.equal(counts['md-btn'], markdown.length, 'Markdown 文件覆盖数不一致');
console.log('GitHub 下载检查通过，' + pages.length + ' 篇页面：' +
  counts['md-btn'] + ' Markdown，' + counts['pdf-btn'] + ' PDF，' +
  counts['tex-btn'] + ' LaTeX，' + counts['source-btn'] + ' ZIP');
