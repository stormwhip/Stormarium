(function(){
  'use strict';
  var wrap=document.getElementById('pdf-frame-wrap');if(!wrap)return;
  var root=(window.SITE_CFG&&window.SITE_CFG.root)||'../',script=document.currentScript,version=script.src.split('?')[1]||'';
  var pdf=null,lib=null,started=false,slots=[],queue=new Set(),visible=new Set(),running=0,resizeTimer;
  function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
  function button(t,fn){var b=el('button','',t);b.type='button';b.onclick=fn;return b;}
  var toolbar=el('div','pdf-toolbar'),label=el('label','','页码 '),pageInput=el('input');pageInput.type='number';pageInput.min='1';pageInput.value='1';pageInput.setAttribute('aria-label','PDF 页码');label.append(pageInput);
  var total=el('span','',' / —');
  var jump=button('跳转',function(){var p=Number(pageInput.value);if(!pdf||!Number.isInteger(p)||p<1||p>pdf.numPages){status.textContent='请输入有效页码。';return;}slots[p-1].node.scrollIntoView({block:'start',behavior:'instant'});enqueue(slots[p-1]);});
  toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label','PDF 阅读控制');
  toolbar.append(label,total,jump);
  pageInput.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();jump.click();}});
  var status=el('p','pdf-status','正在准备 PDF…');status.setAttribute('role','status');
  var pages=el('div','pdf-pages');wrap.classList.add('pdf-inline');wrap.append(toolbar,status,pages);
  var observer=new IntersectionObserver(function(entries){entries.forEach(function(e){var slot=slots[Number(e.target.dataset.pdfPage)-1];if(e.isIntersecting){visible.add(slot);enqueue(slot);}else{visible.delete(slot);queue.delete(slot);}});prune();},{rootMargin:'1000px 0px'});
  var scrollFrame=0;
  window.addEventListener('scroll',function(){if(scrollFrame||!pdf||!shown())return;scrollFrame=requestAnimationFrame(function(){scrollFrame=0;if(document.activeElement===pageInput)return;var current=Array.from(visible).find(function(s){var r=s.node.getBoundingClientRect();return r.top<=180&&r.bottom>180;});if(current)pageInput.value=String(current.number);});},{passive:true});
  function shown(){return !!wrap.getClientRects().length;}
  function enqueue(slot){if(slot&&slot.state==='idle')queue.add(slot);pump();}
  function pump(){if(!shown())return;while(running<2&&queue.size){var slot=queue.values().next().value;queue.delete(slot);if(slot.state!=='idle')continue;running++;slot.state='busy';render(slot).finally(function(){running--;pump();});}}
  function prune(){
    var loaded=slots.filter(function(s){return s.state==='done';});if(loaded.length<=8)return;
    loaded.sort(function(a,b){return a.time-b.time;});var selection=getSelection(),count=loaded.length;
    loaded.forEach(function(s){if(count<=8||visible.has(s)||(selection&&!selection.isCollapsed&&(s.node.contains(selection.anchorNode)||s.node.contains(selection.focusNode))))return;
      s.canvas.width=0;s.canvas.height=0;s.canvas.remove();s.text.remove();s.canvas=s.text=null;s.state='idle';s.node.classList.remove('pdf-ready');count--;
    });
  }
  async function render(slot){
    var page,canvas,text;
    try{
      page=await pdf.getPage(slot.number);var base=page.getViewport({scale:1}),width=Math.max(200,wrap.clientWidth-2);
      var viewport=page.getViewport({scale:width/base.width});slot.ratio=base.width/base.height;
      slot.node.style.width=width+'px';slot.node.style.height=viewport.height+'px';slot.node.style.setProperty('--total-scale-factor',viewport.scale);
      canvas=el('canvas');canvas.setAttribute('aria-hidden','true');
      var ratio=Math.min(devicePixelRatio||1,2,Math.sqrt(3000000/(viewport.width*viewport.height)));
      canvas.width=Math.ceil(viewport.width*ratio);canvas.height=Math.ceil(viewport.height*ratio);canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';slot.node.append(canvas);
      await page.render({canvasContext:canvas.getContext('2d'),viewport:viewport,transform:ratio===1?null:[ratio,0,0,ratio,0,0]}).promise;
      text=el('div','textLayer');text.setAttribute('aria-label','第 '+slot.number+' 页正文');slot.node.append(text);
      var textLayer=new lib.TextLayer({textContentSource:page.streamTextContent(),container:text,viewport:viewport});await textLayer.render();
      slot.canvas=canvas;slot.text=text;slot.state='done';slot.time=Date.now();slot.node.classList.add('pdf-ready');
      if(!text.textContent.trim())slot.node.setAttribute('aria-label','第 '+slot.number+' 页，未检测到可选文字');
      status.textContent='';prune();
    }catch(e){if(canvas)canvas.remove();if(text)text.remove();slot.state='error';var error=el('p','pdf-page-error','此页显示失败。');var retry=button('重试此页',function(){error.remove();slot.state='idle';enqueue(slot);});error.append(retry);slot.node.append(error);}
    finally{if(page)page.cleanup();}
  }
  function resize(){if(!pdf||!shown())return;if(running){resizeTimer=setTimeout(resize,120);return;}
    var anchor=slots.find(function(s){var r=s.node.getBoundingClientRect();return r.bottom>160&&r.top<innerHeight;});var offset=anchor?anchor.node.getBoundingClientRect().top:0;
    queue.clear();slots.forEach(function(s){var w=Math.max(200,wrap.clientWidth-2);s.node.style.width=w+'px';s.node.style.height=(w/s.ratio)+'px';if(s.canvas){s.canvas.width=0;s.canvas.height=0;s.canvas.remove();s.text.remove();s.canvas=s.text=null;}s.node.querySelectorAll('.pdf-page-error').forEach(function(n){n.remove();});s.state='idle';s.node.classList.remove('pdf-ready');});
    if(anchor)window.scrollBy({top:anchor.node.getBoundingClientRect().top-offset,behavior:'instant'});
    visible.forEach(enqueue);
  }
  window.addEventListener('resize',function(){clearTimeout(resizeTimer);resizeTimer=setTimeout(resize,180);});
  async function start(){
    if(!shown())return;if(started){pump();return;}started=true;
    if(location.protocol==='file:'){status.textContent='直接打开本地文件时，请使用原生预览；网页连续阅读请通过「本地预览」或线上网站打开。';return;}
    try{
      lib=await import(new URL(root+'assets/pdfjs/build/pdf.min.js?'+version,location.href).href);
      lib.GlobalWorkerOptions.workerSrc=new URL(root+'assets/pdfjs/build/pdf.worker.min.js?'+version,location.href).href;
      var assets=new URL(root+'assets/pdfjs/',location.href).href;
      pdf=await lib.getDocument({url:wrap.dataset.pdfSrc,cMapUrl:assets+'cmaps/',cMapPacked:true,standardFontDataUrl:assets+'standard_fonts/',wasmUrl:assets+'wasm/',isEvalSupported:false,enableXfa:false,disableAutoFetch:true,disableStream:true}).promise;
      total.textContent=' / '+pdf.numPages;pageInput.max=String(pdf.numPages);
      var first=await pdf.getPage(1),v=first.getViewport({scale:1}),ratio=v.width/v.height;first.cleanup();
      for(var i=1;i<=pdf.numPages;i++){var node=el('section','pdf-page');node.dataset.pdfPage=String(i);node.setAttribute('aria-label','PDF 第 '+i+' 页');node.style.width=Math.max(200,wrap.clientWidth-2)+'px';node.style.height=(Math.max(200,wrap.clientWidth-2)/ratio)+'px';pages.append(node);var slot={node:node,number:i,ratio:ratio,state:'idle',time:0};slots.push(slot);observer.observe(node);}
      status.textContent='正在显示 PDF…';
    }catch(e){status.textContent='PDF 暂时无法直接显示，请重试或使用原生预览。';status.append(button('重试加载',function(){started=false;start();}));}
  }
  window.addEventListener('note:pdfview',start);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
