'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const script = fs.readFileSync('工具/模板/assets/tool.js', 'utf8');
const css = fs.readFileSync('工具/模板/assets/tool.css', 'utf8');
assert.match(css, /#tool-app \[hidden\]\s*\{\s*display:\s*none\s*!important/);
function element(id) {
  const handlers = {};
  const attrs = {};
  return {
    id, hidden: id !== 'drop-zone', disabled: false, value: '', files: [],
    accept: '.pdf,.pptx,.docx,.txt,.png,.jpg,.jpeg,.webp',
    style: {}, classList: {add() {},remove() {},toggle() {}},
    getAttribute(k) {return k === 'data-tool' ? 'english' : k === 'data-root' ? '../' : attrs[k];},
    setAttribute(k,v) {attrs[k]=v;},
    addEventListener(type,fn) {handlers[type]=fn;},
    dispatch(type,ev={}) {handlers[type]?.({target:this,stopPropagation() {},preventDefault() {},...ev});},
    click() {this.clickCount=(this.clickCount||0)+1;this.dispatch('click');},
    contains() {return false;},
  };
}
const ids=['tool-app','drop-zone','file-input','file-chosen','file-name','file-size',
  'file-clear','start-btn','status','progress-track','progress-bar','status-text',
  'result','download-btn','error-box'];
const elements=Object.fromEntries(ids.map(id=>[id,element(id)]));
const document={getElementById(id){return elements[id];},querySelectorAll(){return [];},querySelector(){return null;}};
const window={addEventListener() {}};
const location={protocol:'https:',origin:'https://stormwhip.com',href:'https://stormwhip.com/tools/english.html'};
vm.runInNewContext(script,{document,window,location,URL,Date,FormData:class {},fetch(){throw Error('Unexpected request');},
  setTimeout(){},isFinite,console});
const input=elements['file-input'];
input.files=[{name:'lesson.txt',size:100}];
input.dispatch('change');
assert.equal(elements['start-btn'].disabled,false);
assert.equal(elements['file-chosen'].hidden,false);
elements['file-clear'].click();
assert.equal(input.clickCount,1,'Reselect should open the file picker');
assert.equal(elements['file-chosen'].hidden,false,'Cancellation should retain the selected file');
assert.equal(elements['start-btn'].disabled,false);
input.files=[{name:'new.txt',size:200}];
input.dispatch('change');
assert.equal(elements['file-name'].textContent,'new.txt');
assert.equal(elements['file-chosen'].hidden,false);
console.log('Tool file-selection UI tests passed.');const pageTemplate = fs.readFileSync('工具/模板/page.html', 'utf8');
assert.match(pageTemplate, /contextmenu/);
assert.match(pageTemplate, /key === 'f12'/);
assert.match(pageTemplate, /Content-Security-Policy/);

