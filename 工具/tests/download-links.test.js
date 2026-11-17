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
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : entry.isFile() ? [file] : [];
  });
}
function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
const pages = walk(path.join(site, 'notes')).filter(f => f.endsWith('.html'));
assert(pages.length > 0, '找不到笔记页面');
const counts = { 'md-btn': 0, 'pdf-btn': 0, 'tex-btn': 0, 'source-btn': 0 };
const mdFound = new Set();
const sourceHashes = new Set(walk(path.join(root, '内容'))
  .filter(file => /\.(md|markdown|pdf|tex)$/i.test(file)).map(sha));
for (const page of pages) {
  const html = fs.readFileSync(page, 'utf8');
  if (!html.includes('id="note-root"')) continue;
  const seen = new Set();
  const links = [...html.matchAll(/<a class="file-btn ([^"]+)" href="([^"]+)"([^>]*)>/g)];
  assert(links.length, '页面缺少下载按钮：' + page);
  const pageURL = 'https://stormwhip.com/' + path.relative(site, page).split(path.sep).join('/');
  for (const link of links) {
    const kind = link[1];
    const url = new URL(link[2].replace(/&amp;/g, '&'), pageURL);
    assert(Object.hasOwn(counts, kind), '未知下载类型：' + kind);
    assert(!seen.has(kind), '重复下载按钮：' + page + ' ' + kind);
    seen.add(kind);
    counts[kind]++;
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, 'stormwhip.com', '附件必须通过本站 CDN 镜像下载');
    const rel = decodeURIComponent(url.pathname.slice(1));
    assert(rel.startsWith('assets/file/') && !rel.split('/').includes('..'), '附件路径无效：' + rel);
    const target = path.join(site, ...rel.split('/'));
    assert(fs.existsSync(target), '站点镜像文件不存在：' + rel);
    const actual = sha(target);
    if (kind === 'source-btn') {
      assert(rel.endsWith('.zip'), '源码附件格式错误：' + rel);
      if (process.env.CHECK_RELEASE_ASSETS === '1') {
        const assetName = 'source-' + crypto.createHash('sha1').update(fs.readFileSync(target))
          .digest('hex').slice(0, 24) + '.zip';
        assert.equal(sha(target), sha(path.join(root, 'release', assetName)), '源码包内容不一致');
      }
      continue;
    }
    const ext = { 'md-btn': /\.(md|markdown)$/i, 'pdf-btn': /\.pdf$/i,
                  'tex-btn': /\.tex$/i }[kind];
    assert(ext.test(rel), '源文件格式错误：' + rel);
    assert(sourceHashes.has(actual), '镜像内容与源文件不一致：' + rel);
    assert(!link[3].includes('data-github-download'), '附件仍使用跨域 GitHub 下载：' + rel);
    assert(url.searchParams.has('v') || /math1-homework-[0-9a-f]{16}\.pdf$/i.test(rel),
      '缺少内容版本参数：' + rel);
    if (kind === 'md-btn') mdFound.add(actual);
  }
}
const markdown = walk(path.join(root, '内容'))
  .map(file => path.relative(root, file).split(path.sep).join('/'))
  .filter(file => /\/markdown\/[^/]+\.(md|markdown)$/.test(file))
  .filter(file => !file.split('/').some(part => part.startsWith('_')))
  .filter(file => {
    const contents = fs.readFileSync(path.join(root, ...file.split('/')), 'utf8');
    const fm = contents.startsWith('---') ? contents.split('---')[1] || '' : '';
    return !/^\s*draft:\s*true\s*$/m.test(fm);
  });
for (const file of markdown) {
  assert(mdFound.has(sha(path.join(root, ...file.split('/')))), '漏掉 Markdown 下载：' + file);
}
assert.equal(counts['md-btn'], markdown.length, 'Markdown 下载文件覆盖数不一致');
console.log('本站镜像下载检查通过：' + pages.length + ' 篇页面；' +
  counts['md-btn'] + ' Markdown，' + counts['pdf-btn'] + ' PDF，' +
  counts['tex-btn'] + ' LaTeX，' + counts['source-btn'] + ' ZIP');
