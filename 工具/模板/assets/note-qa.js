(function () {
  'use strict';
  var body=document.getElementById('note-root');if(!body)return;
  var root=(window.SITE_CFG&&window.SITE_CFG.root)||'../', version=document.currentScript.src.split('?')[1]||'';
  var picked=null,active=null,history=[],busy=false,requestId=0,controller=null,loader=null,opener=null;
  function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
  function btn(text,fn){var n=el('button','',text);n.type='button';n.onclick=fn;return n;}
  function mathText(node){
    var clone=node.cloneNode(true);
    clone.querySelectorAll('.katex').forEach(function(k){var a=k.querySelector('annotation[encoding="application/x-tex"]');k.replaceWith(document.createTextNode(a?' $'+a.textContent+'$ ':' '+k.textContent+' '));});
    clone.querySelectorAll('script,style,.anchor').forEach(function(n){n.remove();});
    clone.querySelectorAll('p,li,div,tr,h1,h2,h3,h4,h5,h6,br').forEach(function(n){n.appendChild(document.createTextNode('\n'));});
    return (clone.textContent||'').trim();
  }
  function readSelection(){
    var s=window.getSelection();if(!s||s.isCollapsed||!s.rangeCount)return null;
    var range=s.getRangeAt(0);
    function source(n){return (n.nodeType===1?n:n.parentElement).closest('#note-body,.pdf-page .textLayer');}
    var sourceStart=source(range.startContainer),sourceEnd=source(range.endContainer);
    if(!sourceStart||!sourceEnd||!body.contains(sourceStart)||!body.contains(sourceEnd)||!sourceStart.getClientRects().length)return null;
    if((sourceStart.id==='note-body')!==(sourceEnd.id==='note-body'))return null;
    // 若端点位于公式内部，扩展到整个公式，避免重复读取视觉层/MathML。
    function formula(n){return (n.nodeType===1?n:n.parentElement).closest('.katex');}
    var start=formula(range.startContainer),end=formula(range.endContainer);range=range.cloneRange();
    if(start)range.setStartBefore(start);if(end)range.setEndAfter(end);
    var wrapper=el('div');wrapper.appendChild(range.cloneContents());var text=mathText(wrapper);
    if(!text)return null;
    var anchor=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
    var block=anchor.closest('p,li,blockquote,table,.panel');
    var headings=body.querySelectorAll('#note-body h1,#note-body h2,#note-body h3,#note-body h4,#note-body h5,#note-body h6'),section='';
    headings.forEach(function(h){if(h===anchor||(h.compareDocumentPosition(anchor)&Node.DOCUMENT_POSITION_FOLLOWING))section=mathText(h);});
    if(sourceStart.id!=='note-body'){var first=sourceStart.closest('.pdf-page'),last=sourceEnd.closest('.pdf-page');section='PDF 第 '+first.dataset.pdfPage+(first===last?'':'–'+last.dataset.pdfPage)+' 页';block=sourceStart;}
    return {selection:text,context:block?mathText(block).slice(0,4000):'',title:document.querySelector('.note-title').textContent.slice(0,200),section:section.slice(0,200),rect:range.getBoundingClientRect()};
  }
  var trigger=el('button','qa-trigger','向 AI 提问');trigger.type='button';trigger.hidden=true;document.body.appendChild(trigger);
  var menu=el('div','qa-menu');menu.hidden=true;menu.setAttribute('role','menu');menu.setAttribute('aria-label','选中文字操作');
  var ask=btn('向 AI 提问',open),copy=btn('复制选中文字',function(){
    if(!picked)return;var value=picked.selection;
    if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(value).then(hide).catch(function(){copy.textContent='复制失败，请用 Ctrl+C';});
    else {document.execCommand('copy');hide();}
  });[ask,copy].forEach(function(n){n.setAttribute('role','menuitem');menu.appendChild(n);});document.body.appendChild(menu);
  function hide(){trigger.hidden=true;menu.hidden=true;}
  function place(n,x,y){n.hidden=false;var r=n.getBoundingClientRect();n.style.left=Math.max(8,Math.min(x,innerWidth-r.width-8))+'px';n.style.top=Math.max(8,Math.min(y,innerHeight-r.height-8))+'px';}
  trigger.addEventListener('pointerdown',function(e){e.preventDefault();});trigger.onclick=open;
  body.addEventListener('contextmenu',function(e){var value=readSelection();if(!value)return;e.preventDefault();picked=value;trigger.hidden=true;place(menu,e.clientX,e.clientY);ask.focus({preventScroll:true});});
  document.addEventListener('pointerdown',function(e){if(!menu.contains(e.target)&&e.target!==trigger)hide();});
  document.addEventListener('pointerup',function(e){if(menu.contains(e.target)||e.target===trigger||dialog.contains(e.target))return;
    setTimeout(function(){var value=readSelection();if(!value){trigger.hidden=true;return;}picked=value;place(trigger,value.rect.right,value.rect.bottom+8);},30);
  });
  var selectionTimer;
  document.addEventListener('selectionchange',function(){clearTimeout(selectionTimer);selectionTimer=setTimeout(function(){if(dialog.open||!menu.hidden)return;var value=readSelection();if(!value){trigger.hidden=true;return;}picked=value;place(trigger,value.rect.right,value.rect.bottom+8);},220);});
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'){hide();return;}
    if(!menu.hidden&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();(document.activeElement===ask?copy:ask).focus();}
    if(e.altKey&&e.key.toLowerCase()==='a'){var value=readSelection();if(value){e.preventDefault();picked=value;open();}}
  });
  window.addEventListener('scroll',function(){trigger.hidden=true;},{passive:true});window.addEventListener('wheel',hide,{passive:true});window.addEventListener('touchmove',hide,{passive:true});window.addEventListener('resize',hide);
  var dialog=el('dialog','qa-dialog');dialog.setAttribute('aria-labelledby','qa-title');
  var head=el('div','qa-head'),title=el('h2','','笔记答疑');title.id='qa-title';head.append(title,btn('关闭 · Esc',function(){dialog.close();}));
  var source=el('p','qa-source'),quote=el('details','qa-quote'),quoteText=el('pre');quote.append(el('summary','','查看选中文字'),quoteText);
  var notice=el('p','qa-notice','发送时会将选中文字、所在段落及本轮对话交给 AI。回答仅供参考，请核对原文。');
  var quick=el('div','qa-quick');['解释这段内容','分步骤说明推导','举一个具体例子'].forEach(function(t){quick.appendChild(btn(t,function(){input.value=t;input.focus();}));});
  var form=el('form'),label=el('label','','你的问题'),input=el('textarea');input.id='qa-question';input.maxLength=2000;input.required=true;input.placeholder='这一步为什么成立？';label.htmlFor=input.id;
  var actions=el('div','qa-actions'),send=el('button','qa-send','发送问题');send.type='submit';var stop=btn('停止等待',cancel);stop.hidden=true;actions.append(send,stop);
  var status=el('p','qa-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  var turns=el('div','qa-turns');form.append(label,input,actions);dialog.append(head,source,quote,notice,turns,quick,form,status);document.body.appendChild(dialog);
  function say(t,error){status.textContent=t;status.dataset.error=error?'true':'false';}
  function setBusy(value){busy=value;send.disabled=value;stop.hidden=!value;quick.querySelectorAll('button').forEach(function(b){b.disabled=value;});}
  function cancel(){if(!busy)return;requestId++;if(controller)controller.abort();setBusy(false);say('已停止等待。服务器可能仍在完成本次回答，稍后可重试。');}
  dialog.addEventListener('close',function(){cancel();document.body.classList.remove('qa-open');if(opener&&opener.isConnected)opener.focus({preventScroll:true});});
  function open(){
    if(!picked)return;opener=document.activeElement;hide();
    if(picked.selection.length>6000){alert('选中文字超过 6000 字，请缩小选区后提问。');return;}
    if(!active||active.selection!==picked.selection||active.section!==picked.section){cancel();active={selection:picked.selection,context:picked.context,title:picked.title,section:picked.section};history=[];turns.replaceChildren();input.value='';say('');}
    source.textContent=active.title+(active.section?' · '+active.section:'');quoteText.textContent=active.selection;
    if(!dialog.open)dialog.showModal();document.body.classList.add('qa-open');input.focus();
  }
  function loadScript(url){return new Promise(function(resolve,reject){var s=el('script');s.src=url;s.onload=resolve;s.onerror=reject;document.head.appendChild(s);});}
  function dependencies(){if(!loader)loader=Promise.all([window.marked?Promise.resolve():loadScript(root+'assets/marked.min.js?'+version),window.katex?Promise.resolve():loadScript(root+'assets/katex/katex.min.js?'+version)]).catch(function(e){loader=null;throw e;});return loader;}
  function renderAnswer(host,text){
    // 先分离公式，避免 Markdown 把下划线/反斜杠改写；围栏/行内代码原样处理。
    var math=[],prefix='QAMATH'+Math.random().toString(36).slice(2)+'TOKEN';
    var safeText=text.replace(/```[\s\S]*?```|`[^`\n]*`|\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|\$([^$\n]+)\$/g,function(all,a,b,c,d){if(all[0]==='`')return all;var id=math.length;math.push({tex:a||b||c||d,display:a!==undefined||b!==undefined});return prefix+id+'END';});
    var template=el('template');template.innerHTML=window.marked.parse(safeText,{gfm:true,breaks:false});
    var allowed=new Set(['P','BR','STRONG','EM','DEL','CODE','PRE','UL','OL','LI','BLOCKQUOTE','H1','H2','H3','H4','H5','H6','TABLE','THEAD','TBODY','TR','TH','TD','HR','A']);
    function clean(parent){Array.from(parent.children).forEach(function(n){
      if(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','SVG','MATH'].includes(n.tagName)){n.remove();return;}
      if(!allowed.has(n.tagName)){n.replaceWith(document.createTextNode(n.textContent||''));return;}
      var href=n.tagName==='A'?n.getAttribute('href'):null;Array.from(n.attributes).forEach(function(a){n.removeAttribute(a.name);});
      if(href){try{var u=new URL(href,location.href);if(['https:','http:'].includes(u.protocol)){n.href=u.href;n.target='_blank';n.rel='noopener noreferrer';}}catch(e){}}
      clean(n);
    });}clean(template.content);host.replaceChildren(template.content);
    var walker=document.createTreeWalker(host,NodeFilter.SHOW_TEXT),nodes=[],n;while((n=walker.nextNode()))if(n.textContent.includes(prefix))nodes.push(n);
    nodes.forEach(function(node){var parts=node.textContent.split(new RegExp('('+prefix+'\\d+END)')),fragment=document.createDocumentFragment();parts.forEach(function(p){var m=p.match(new RegExp('^'+prefix+'(\\d+)END$'));if(!m){fragment.appendChild(document.createTextNode(p));return;}var value=math[Number(m[1])],span=el('span');window.katex.render(value.tex,span,{displayMode:value.display,throwOnError:false,trust:false,strict:'ignore',maxExpand:1000});fragment.appendChild(span);});node.replaceWith(fragment);});
  }
  form.addEventListener('submit',async function(e){
    e.preventDefault();if(busy||!active)return;var question=input.value.trim();if(!question){input.focus();return;}
    if(location.protocol==='file:'){say('AI 提问需要联网，请从已部署的网站打开笔记。',true);return;}
    var id=++requestId;controller=new AbortController();var currentController=controller;setBusy(true);say('AI 正在思考…');
    var timer=setTimeout(function(){currentController.abort();},135000);
    try{
      var response=await fetch(root+'api/note-qa',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(Object.assign({},active,{question:question,history:history})),signal:currentController.signal});
      var data;try{data=await response.json();}catch(err){throw new Error(response.status===404?'AI 问答接口尚未部署，请联系站长。':'服务暂时不可用，请稍后重试。');}
      if(!response.ok)throw new Error(data.error||'提问失败，请稍后重试。');if(typeof data.answer!=='string'||!data.answer.trim())throw new Error('AI 未返回回答，请重试。');
      if(id!==requestId)return;
      var turn=el('section','qa-turn'),q=el('p','qa-question',question),answer=el('div','qa-answer');answer.textContent=data.answer;turn.append(q,answer);turns.appendChild(turn);
      try{await dependencies();if(id===requestId)renderAnswer(answer,data.answer);}catch(err){/* 依赖失败保留可读纯文本，不丢失回答。 */}
      if(id!==requestId)return;
      history.push({role:'user',content:question},{role:'assistant',content:data.answer.slice(0,12000)});
      while(history.length>6||history.reduce(function(sum,h){return sum+h.content.length;},0)>24000)history.splice(0,2);
      input.value='';say('已回答，可继续追问。');turn.scrollIntoView({block:'start',behavior:'auto'});
    }catch(err){if(id===requestId)say(err.name==='AbortError'?'等待超时，可稍后重试。':err.message,true);}
    finally{clearTimeout(timer);if(id===requestId)setBusy(false);}
  });
})();
