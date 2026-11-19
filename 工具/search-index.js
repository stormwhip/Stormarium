'use strict';

// Build-time only. Index the same leaf blocks that receive anchors in the page.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

function text(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) =>
    String.fromCodePoint(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n) => ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[n])
    .replace(/\s+/g, ' ').trim();
}

function leaves(html) {
  const stack = [], found = [];
  const re = /<\/?(h[1-6]|p|li|tr|pre)\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1].toLowerCase();
    if (m[0][1] !== '/') {
      stack.push({tag, start:m.index, content:re.lastIndex, open:m[0], children:[]});
    } else {
      const item = stack.pop();
      if (!item || item.tag !== tag) throw new Error('搜索索引：HTML 内容块不匹配');
      let inner=html.slice(item.content,m.index);
      for (const child of item.children.reverse()) {
        inner=inner.slice(0,child.start-item.content)+inner.slice(child.end-item.content);
      }
      found.push({...item, end:re.lastIndex, inner});
      if(stack.length)stack[stack.length-1].children.push({start:item.start,end:re.lastIndex});
    }
  }
  return found.sort((a,b) => a.start-b.start);
}

function annotate(html, plain, noteTitle, preview = (s) => s) {
  const visible = leaves(html), source = leaves(plain);
  if (visible.length !== source.length) {
    const at=visible.findIndex((b,i)=>!source[i] || b.tag!==source[i].tag);
    throw new Error(`搜索索引：${noteTitle} 正文块数量不一致 ${visible.length}/${source.length}，首个差异 ${at}：${JSON.stringify(visible.slice(Math.max(0,at-1),at+2).map(b=>[b.tag,text(b.inner).slice(0,80)]))} / ${JSON.stringify(source.slice(Math.max(0,at-1),at+2).map(b=>[b.tag,text(b.inner).slice(0,80)]))}`);
  }
  const sections = [], changes = [], used = new Map(), headingPath = [];
  let section = {id:'', title:noteTitle, path:[], blocks:[]};
  let sectionSeed = '';
  sections.push(section);
  for (let i=0; i<visible.length; i++) {
    const block = visible[i], raw = source[i];
    if (block.tag !== raw.tag) throw new Error(`搜索索引：${noteTitle} 正文块顺序不一致`);
    const value = text(raw.inner);
    if (!value) continue;
    const existing = /\bid="([^"]+)"/.exec(block.open);
    let id = existing ? existing[1] : '';
    const heading = /^h[1-6]$/.test(block.tag);
    if (!id) {
      const seed = `${sectionSeed}\n${block.tag}\n${value}`;
      const count = (used.get(seed) || 0) + 1; used.set(seed,count);
      id = `find-${hash(seed)}${count>1?'-'+count:''}`;
      changes.push({at:block.start, length:block.open.length,
        value:block.open.slice(0,-1)+` id="${id}">`});
    }
    if (heading) {
      // Preserve previously shared paragraph anchors when chapter URLs change.
      const legacy = /data-legacy-id="([^"]+)"/.exec(block.open);
      sectionSeed = legacy ? legacy[1] : id;
      const level = Number(block.tag.slice(1));
      headingPath.length = level-1; headingPath[level-1] = value;
      section = {id, title:value, html:preview(block.inner.replace(/<a class="anchor"[^>]*>[\s\S]*?<\/a>/g,'')), path:headingPath.filter(Boolean), blocks:[]};
      sections.push(section);
    } else {
      // Long paragraphs stay one addressable block; the browser finds the best excerpt.
      section.blocks.push({id, text:value, html:preview(block.inner)});
    }
  }
  for (const edit of changes.reverse()) html=html.slice(0,edit.at)+edit.value+html.slice(edit.at+edit.length);
  return {html, sections:sections.filter((s)=>s.id || s.blocks.length)};
}

function buildIndex(notes, subjects, preview = () => '') {
  const docs = notes.map((n) => {
    let info = {};
    const metadata = path.join(n.noteDir,'搜索信息.json');
    if (fs.existsSync(metadata)) {
      info=JSON.parse(fs.readFileSync(metadata,'utf8').replace(/^\uFEFF/,''));
      if (!info || typeof info !== 'object' || Array.isArray(info) ||
          (info.summary !== undefined && typeof info.summary !== 'string') ||
          (info.keywords !== undefined && (!Array.isArray(info.keywords) || info.keywords.some((x)=>typeof x!=='string')))) {
        throw new Error(`搜索信息.json 格式错误：${n.noteDir}`);
      }
    }
    const summary=n.locked ? '该笔记已锁定，输入访问码以访问' : (info.summary || n.frontSummary || '');
    return {title:n.title, subject:n.subject, url:n.url, date:n.mtimeStr,
      kind:n.hasMarkdown?'markdown':'pdf', tags:n.tags || [],
      keywords:n.locked ? [] : (info.keywords || []), summary, summaryHtml:preview(summary),
      sections:n.locked ? [] : (n.searchSections || [])};
  });
  const data={schema:1, subjects, docs};
  data.version=hash(JSON.stringify(data));
  return data;
}
module.exports={annotate,buildIndex};
