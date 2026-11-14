'use strict';
// Self-contained UTF-8 ZIP export for source files that share a local image folder.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const table = Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);return c>>>0;});
function crc32(data){let c=0xffffffff;for(const byte of data)c=(c>>>8)^table[(c^byte)&255];return(c^0xffffffff)>>>0;}
function createBundle(noteDir, mdAbs, texAbs) {
  const files=[];
  for(const source of [mdAbs,texAbs])if(source)files.push(source);
  function collect(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())collect(file);else if(entry.isFile())files.push(file);}}
  const images=path.join(noteDir,'图片');
  if(!fs.existsSync(images))return null;
  collect(images);
  // Keep local TeX dependencies beside the source folders in the archive.
  if(texAbs){
    const tex=fs.readFileSync(texAbs,'utf8');
    for(const match of tex.matchAll(/\\includepdf(?:\[[^\]]*\])?\{([^}]+)\}/g)){
      const dependency=path.resolve(path.dirname(texAbs),match[1]);
      const fallback=path.resolve(noteDir,match[1]);
      const file=fs.existsSync(dependency)?dependency:fallback;
      if(fs.existsSync(file)&&fs.statSync(file).isFile()&&!files.includes(file))files.push(file);
    }
  }
  if(files.length<([mdAbs,texAbs].filter(Boolean).length+1))return null;
  const locals=[],centrals=[];let offset=0;
  for(const file of files){
    const relative=path.relative(noteDir,file).split(path.sep).join('/');
    if(relative.startsWith('../')||path.isAbsolute(relative))throw new Error('源码包文件不在笔记目录内');
    const name=Buffer.from(relative,'utf8'),data=fs.readFileSync(file),packed=zlib.deflateRawSync(data),crc=crc32(data);
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(8,8);header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(packed.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
    locals.push(header,name,packed);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(8,10);central.writeUInt16LE(33,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
    centrals.push(central,name);offset+=header.length+name.length+packed.length;
  }
  const directory=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,directory,end]);
}
module.exports={createBundle};
