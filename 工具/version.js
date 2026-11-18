#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname, '..', '站点配置.json');
const PLAYERS = ["ZywOo","ropz","apEX","flameZ","mezii","NiKo","m0NESY","kyousuke","TeSeS","karrigan","molodoy","KSCERATO","YEKINDAR","yuurih","FalleN","xelex","PR","xertioN","Spinx","torzsi","Twistzz","frozen","Neityu","jcobbb","JBOEN","w0nderful","sh1ro","device","kennyS","rain","DANK1NG","Jee","JamYoung","Mercury","Moseyuh","Zero","XANTARES"];
function parse(value) {
  const m = /^([0-9]+)[.]([0-9]+)[.]([0-9]+)-([A-Za-z0-9]+)$/.exec(value);
  if (!m || !PLAYERS.includes(m[4])) throw Error('版本号或选手 ID 无效：' + value);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), id: m[4] };
}
function next(value, kind) {
  const v = parse(value);
  if (kind === 'note') v.id = PLAYERS[(PLAYERS.indexOf(v.id) + 1) % PLAYERS.length];
  else if (kind === 'patch') { v.patch++; v.id = PLAYERS[0]; }
  else if (kind === 'minor') { v.minor++; v.patch = 0; v.id = PLAYERS[0]; }
  else if (kind === 'major') { v.major++; v.minor = 0; v.patch = 0; v.id = PLAYERS[0]; }
  else throw Error('用法：node 工具/version.js show|check|note|patch|minor|major');
  return `${v.major}.${v.minor}.${v.patch}-${v.id}`;
}
const cmd = process.argv[2] || 'show';
const raw = fs.readFileSync(file, 'utf8');
const version = String(JSON.parse(raw)['版本号'] || '');
parse(version);
if (cmd === 'check') {
  if (next('1.0.0-ZywOo', 'note') !== '1.0.0-ropz' ||
      next('1.0.0-XANTARES', 'note') !== '1.0.0-ZywOo' ||
      next('1.0.0-ropz', 'patch') !== '1.0.1-ZywOo' ||
      next('1.0.0-ropz', 'minor') !== '1.1.0-ZywOo' ||
      next('1.0.0-ropz', 'major') !== '2.0.0-ZywOo') throw Error('版本递增自测失败');
  console.log(version);
} else if (cmd === 'show') console.log(version);
else {
  const updated = next(version, cmd);
  const key = '"版本号": "' + version + '"';
  if (!raw.includes(key)) throw Error('配置中缺少版本号字段');
  fs.writeFileSync(file, raw.replace(key, '"版本号": "' + updated + '"'), 'utf8');
  console.log(version + ' -> ' + updated);
}
