(function () {
  'use strict';
  var script=document.querySelector('script[data-search-app]');
  if(!script)return;
  var root=script.dataset.root || '', version=script.dataset.version;
  var loader=null, prepared=null, data=null, dialog=null, modalApp=null, opener=null, mathLoader=null;
  var examples=['费马原理','等价无穷小','氢氧化铝','précis'];
  function el(tag,cls,text) { var n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n; }
  function loadScript(url) {
    return new Promise(function(resolve,reject){var s=document.createElement('script');s.src=url;
      var timer=setTimeout(function(){s.remove();reject(new Error('加载超时'));},15000);
      s.onload=function(){clearTimeout(timer);resolve();};s.onerror=function(){clearTimeout(timer);s.remove();reject(new Error('资源加载失败'));};document.head.appendChild(s);});
  }
  function load() {
    if(loader)return loader;
    loader=Promise.all([window.SiteSearch?Promise.resolve():loadScript(root+'assets/search-core.js?v='+version),
      window.SITE_SEARCH_INDEX&&window.SITE_SEARCH_INDEX.version===version?Promise.resolve():loadScript(root+'assets/search-index.'+version+'.js')])
      .then(function(){data=window.SITE_SEARCH_INDEX;if(!data||data.version!==version||data.schema!==1)throw new Error('索引版本不匹配');prepared=window.SiteSearch.prepare(data);})
      .catch(function(e){loader=null;throw e;});
    return loader;
  }
  function loadMath() {
    if(window.katex)return Promise.resolve();
    if(mathLoader)return mathLoader;
    if(!document.querySelector('link[href*="katex.min.css"]')) {
      var css=el('link');css.rel='stylesheet';css.href=root+'assets/katex/katex.min.css?v='+version;document.head.appendChild(css);
    }
    mathLoader=loadScript(root+'assets/katex/katex.min.js?v='+version).catch(function(e){mathLoader=null;throw e;});
    return mathLoader;
  }
  function excerptMarkup(host,html,text,q) {
    if(!html){highlight(host,window.SiteSearch.excerpt(text,q),q);return;}
    var template=el('template');template.innerHTML=html;
    var safe=document.createDocumentFragment(),allowed=['STRONG','B','EM','I','CODE','DEL','S','SUB','SUP','BR'];
    function clean(source,parent) {
      Array.from(source.childNodes).forEach(function(node){
        if(node.nodeType===3){parent.appendChild(document.createTextNode(node.textContent));return;}
        if(node.nodeType!==1||/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|IMG|SVG|MATH|TEMPLATE)$/.test(node.tagName))return;
        if(node.tagName==='SPAN'&&node.hasAttribute('data-search-tex')){
          var formula=el('span','search-math',node.getAttribute('data-search-tex'));
          formula.dataset.tex=node.getAttribute('data-search-tex');parent.appendChild(formula);return;
        }
        var target=allowed.indexOf(node.tagName)>=0?el(node.tagName.toLowerCase()):null;
        if(target){parent.appendChild(target);clean(node,target);}else{clean(node,parent);if(/^(TD|TH|P|LI)$/.test(node.tagName))parent.appendChild(document.createTextNode(' '));}
      });
    }
    clean(template.content,safe);
    var all=safe.textContent,at=-1;
    String(q).trim().split(/\s+/).filter(Boolean).forEach(function(term){var n=all.toLowerCase().indexOf(term.toLowerCase());if(n>=0&&(at<0||n<at))at=n;});
    var start=Math.max(0,(at<0?0:at)-35),end=start+180,offset=0;
    function crop(source,parent){Array.from(source.childNodes).forEach(function(node){
      var len=node.textContent.length,from=offset;offset+=len;
      if(offset<=start||from>=end)return;
      if(node.nodeType===3){var part=el('span');highlight(part,node.textContent.slice(Math.max(0,start-from),Math.min(len,end-from)),q);while(part.firstChild)parent.appendChild(part.firstChild);}
      else if(node.classList.contains('search-math'))parent.appendChild(node.cloneNode(true));
      else {offset=from;var copy=node.cloneNode(false);crop(node,copy);parent.appendChild(copy);}
    });}
    if(start)host.appendChild(document.createTextNode('…'));crop(safe,host);if(all.length>end)host.appendChild(document.createTextNode('…'));
    var formulas=Array.from(host.querySelectorAll('.search-math'));
    if(formulas.length)loadMath().then(function(){formulas.forEach(function(n){if(n.isConnected)window.katex.render(n.dataset.tex,n,{displayMode:false,throwOnError:false,trust:false,strict:'ignore',maxExpand:1000,maxSize:10});});}).catch(function(){/* TeX remains readable if the optional renderer fails. */});
  }
  function searchURL(q,subject) { var p=new URLSearchParams();if(q)p.set('q',q);if(subject)p.set('subject',subject);return root+'search.html'+(p.toString()?'?'+p:''); }
  function params() {var p=new URLSearchParams(location.search);return {q:(p.get('q')||'').slice(0,160),subject:p.get('subject')||''};}
  function pretty(s) {
    var subs={'0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉','+':'₊','-':'₋'};
    var supers={'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','+':'⁺','-':'⁻'};
    var symbols={rightleftharpoons:'⇌',rightarrow:'→',to:'→',infty:'∞',pi:'π',theta:'θ',lambda:'λ',Delta:'Δ',delta:'δ',geq:'≥',leq:'≤',cdot:'·',times:'×',in:'∈',notin:'∉',backslash:'∖',setminus:'∖',dots:'…',ldots:'…',cdots:'⋯',forall:'∀',exists:'∃'};
    var sets={R:'ℝ',N:'ℕ',C:'ℂ',Z:'ℤ',Q:'ℚ'};
    return s.replace(/\\mathbb\{([RNCZQ])\}/g,function(_,n){return sets[n];})
      .replace(/\\(?:text|mathrm|operatorname|mathbf|mathcal)\{([^{}]*)\}/g,'$1').replace(/\$+/g,'')
      .replace(/\\(?:left|right|displaystyle)\b/g,'').replace(/\\(?:qquad|quad|,|;|!)/g,' ')
      .replace(/_\{([0-9+-]+)\}|_([0-9+-])/g,function(_,a,b){return (a||b).split('').map(function(c){return subs[c];}).join('');})
      .replace(/\^\{([0-9+-]+)\}|\^([0-9+-])/g,function(_,a,b){return (a||b).split('').map(function(c){return supers[c];}).join('');})
      .replace(/\\([a-zA-Z]+)/g,function(_,name){return symbols[name]||name;}).replace(/\\([{}])/g,'$1');
  }
  function highlight(node,text,q) {
    var terms=String(q).trim().split(/\s+/).filter(Boolean);
    var groups=window.SiteSearch.groups(q);groups.forEach(function(g){g.forEach(function(t){if(t.length>1)terms.push(t);});});
    terms=Array.from(new Set(terms)).sort(function(a,b){return b.length-a.length;});
    if(!terms.length){node.textContent=text;return;}
    var re=new RegExp('('+terms.map(function(t){return t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}).join('|')+')','gi');
    var at=0,m;while((m=re.exec(text))){node.appendChild(document.createTextNode(text.slice(at,m.index)));node.appendChild(el('mark','',m[0]));at=re.lastIndex;}
    node.appendChild(document.createTextNode(text.slice(at)));
  }
  function remember(q,subject,link) {
    try {sessionStorage.setItem('siteSearchReturn',JSON.stringify({q:q,subject:subject,y:window.scrollY,href:link}));}catch(e){}
  }
  function createApp(host,isModal) {
    var state={q:'',subject:'',limit:isModal?8:20,seq:0,composing:false,ready:false};
    var workspace=el('div','search-workspace');host.appendChild(workspace);
    var form=el('form','search-input-row');form.setAttribute('role','search');
    var input=el('input');input.type='search';input.maxLength=160;input.placeholder='搜索知识点、章节或资料';input.autocomplete='off';input.setAttribute('aria-label','搜索知识点、章节或资料');
    var submit=el('button','search-submit','搜索');submit.type='submit';form.append(input,submit);workspace.appendChild(form);
    var filters=el('div','search-filters');filters.setAttribute('role','group');filters.setAttribute('aria-label','按学科筛选');workspace.appendChild(filters);
    var status=el('p','search-summary');status.setAttribute('role','status');status.setAttribute('aria-live','polite');workspace.appendChild(status);
    var list=el('ul','search-result-list');list.setAttribute('aria-label','搜索结果');workspace.appendChild(list);
    var tail=el('div');workspace.appendChild(tail);
    function syncURL() {if(isModal)return;try{history.replaceState(null,'',searchURL(state.q,state.subject));}catch(e){/* Some file:// browsers restrict History API; form and result links still work. */}}
    function buildFilters() {
      filters.replaceChildren();[''].concat(data.subjects).forEach(function(subject){
        var b=el('button','search-chip',subject||'全部学科');b.type='button';b.setAttribute('aria-pressed',String(subject===state.subject));
        b.addEventListener('click',function(){state.subject=subject;state.limit=isModal?8:20;buildFilters();render();});filters.appendChild(b);
      });
    }
    function empty(title,description,suggestions) {
      var box=el('li','search-empty');box.append(el('h2','',title),el('p','',description));
      if(suggestions){var chips=el('div','search-examples');examples.forEach(function(q){var b=el('button','search-chip',q);b.type='button';b.onclick=function(){state.q=q;state.subject='';input.value=q;state.limit=isModal?8:20;buildFilters();render();};chips.appendChild(b);});box.appendChild(chips);}
      list.appendChild(box);
    }
    function restoreScroll() {
      if(isModal)return;
      try {var r=JSON.parse(sessionStorage.getItem('siteSearchReturn')||'null');
        if(r&&r.q===state.q&&r.subject===state.subject){
          // Restore additional result pages before restoring the viewport.
          var links=Array.from(list.querySelectorAll('.search-result'));
          var link=links.find(function(a){return a.getAttribute('href')===r.href;});
          if(link)link.focus({preventScroll:true});
          requestAnimationFrame(function(){window.scrollTo(0,r.y);});
        }
      }catch(e){}
    }
    function render(restore) {
      var ticket=++state.seq;state.q=input.value.trim().slice(0,160);syncURL();
      status.textContent=state.ready?'正在搜索…':'正在加载学习索引…';workspace.setAttribute('aria-busy','true');
      load().then(function(){
        if(ticket!==state.seq)return;
        if(!state.ready){state.ready=true;if(data.subjects.indexOf(state.subject)<0)state.subject='';buildFilters();syncURL();}
        workspace.setAttribute('aria-busy','false');list.replaceChildren();tail.replaceChildren();
        if(!state.q){status.textContent='选一个知识点，开始探索。';empty('你想查找什么？','输入知识点、章节或资料名称，可用空格组合多个关键词。',true);return;}
        var results=window.SiteSearch.search(prepared,state.q,state.subject),full=results.filter(function(r){return r.matched===r.total;}).length;
        status.textContent=results.length?'找到 '+results.length+' 个位置'+(full<results.length?' · '+full+' 个完整匹配，其余为部分匹配':'')+' · 每份资料最多显示 3 个位置':'没有找到“'+state.q+'”';
        if(!results.length){empty('换一种说法，再找找','可以缩短关键词、用空格拆分，或取消学科筛选。扫描 PDF 的正文尚未纳入搜索。',false);
          if(state.subject){var reset=el('button','search-more','取消学科筛选');reset.onclick=function(){state.subject='';buildFilters();render();};tail.appendChild(reset);}return;}
        results.slice(0,state.limit).forEach(function(r){
          var li=el('li'),a=el('a','search-result'),p=new URLSearchParams();p.set('search',state.q);if(state.subject)p.set('subject',state.subject);p.set('sv',version);if(r.fallback)p.set('section',r.fallback);
          a.href=root+r.doc.url+'?'+p+(r.target?'#'+encodeURIComponent(r.target):'');
          a.onclick=function(){if(!isModal)remember(state.q,state.subject,a.getAttribute('href'));try{sessionStorage.setItem('siteSearchLimit',String(state.limit));}catch(e){}};
          var top=el('div','search-result-top'),title=el('h2','search-result-title');highlight(title,pretty(r.section?r.section.title:r.doc.title),state.q);
          top.append(title,el('span','search-result-type',r.type));a.appendChild(top);
          var path=[r.doc.subject,r.doc.title];if(r.section)path=path.concat(r.section.path.slice(0,-1));
          a.appendChild(el('p','search-result-path',pretty(path.filter(function(x,i,xs){return i===0||x!==xs[i-1];}).join(' › '))));
          var snippet=el('div','search-result-excerpt');excerptMarkup(snippet,r.preview,r.text,state.q);a.appendChild(snippet);
          var foot=el('p','search-result-foot');foot.appendChild(el('span','',r.doc.kind==='pdf'?'PDF · 仅资料信息':'网页笔记'));
          if(r.matched<r.total)foot.appendChild(el('span','','部分匹配 '+r.matched+'/'+r.total));foot.appendChild(el('span','','查看原文 →'));a.appendChild(foot);li.appendChild(a);list.appendChild(li);
        });
        if(isModal){var all=el('a','search-more','打开完整搜索结果 →');all.href=searchURL(state.q,state.subject);tail.appendChild(all);}
        else if(results.length>state.limit){var more=el('button','search-more','再显示 '+Math.min(20,results.length-state.limit)+' 个位置');more.onclick=function(){var old=state.limit;state.limit+=20;render();requestAnimationFrame(function(){var links=list.querySelectorAll('.search-result');if(links[old])links[old].focus({preventScroll:true});});};tail.appendChild(more);}
        if(restore)restoreScroll();
      }).catch(function(){if(ticket!==state.seq)return;workspace.setAttribute('aria-busy','false');status.textContent='学习索引暂时无法加载。';list.replaceChildren();tail.replaceChildren();empty('暂时无法搜索','请检查连接后重试。如果刚刚更新过网站，可以刷新页面，加载最新版本。',false);
        var retry=el('button','search-more','重新加载索引');retry.onclick=function(){render();};tail.appendChild(retry);});
    }
    var timer;
    input.addEventListener('compositionstart',function(){state.composing=true;clearTimeout(timer);});
    input.addEventListener('compositionend',function(){state.composing=false;changed();});
    function changed(){if(state.composing)return;clearTimeout(timer);state.limit=isModal?8:20;timer=setTimeout(render,100);}
    input.addEventListener('input',changed);
    form.addEventListener('submit',function(e){e.preventDefault();if(state.composing)return;clearTimeout(timer);render();});
    workspace.addEventListener('keydown',function(e){
      if(state.composing||e.isComposing||e.keyCode===229)return;
      if(e.key!=='ArrowDown'&&e.key!=='ArrowUp')return;
      var links=Array.from(list.querySelectorAll('.search-result')),at=links.indexOf(document.activeElement);
      if(document.activeElement!==input&&at<0)return;
      if(!links.length)return;e.preventDefault();
      if(e.key==='ArrowDown')links[Math.min(links.length-1,at+1)].focus();else if(at<=0)input.focus();else links[at-1].focus();
    });
    return {input:input,open:function(q,subject,restore){if(q!==undefined)input.value=q||'';if(subject!==undefined)state.subject=subject||'';state.limit=isModal?8:20;
      if(restore)try{state.limit=Math.max(20,Math.min(500,Number(sessionStorage.getItem('siteSearchLimit'))||20));}catch(e){}
      render(restore);},refresh:function(){var p=params();this.open(p.q,p.subject,false);}};
  }
  function openSearch(trigger) {
    if(document.getElementById('search-page-app')){pageApp.input.focus();return;}
    if(!window.HTMLDialogElement){location.href=searchURL('','');return;}
    opener=trigger||document.activeElement;
    if(!dialog){dialog=el('dialog','search-dialog');dialog.setAttribute('aria-labelledby','search-dialog-title');
      var inner=el('div','search-dialog-inner'),head=el('div','search-dialog-head'),title=el('h2','','知识点搜索');title.id='search-dialog-title';
      var close=el('button','search-close','关闭 · Esc');close.type='button';close.onclick=function(){dialog.close();};head.append(title,close);inner.appendChild(head);dialog.appendChild(inner);document.body.appendChild(dialog);modalApp=createApp(inner,true);
      dialog.addEventListener('close',function(){document.body.classList.remove('search-modal-open');if(opener&&opener.isConnected)opener.focus();});
      dialog.addEventListener('click',function(e){if(e.target===dialog){var r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
    }
    dialog.showModal();document.body.classList.add('search-modal-open');modalApp.open(undefined,undefined,false);modalApp.input.focus();
  }
  document.querySelectorAll('[data-search-open]').forEach(function(a){a.addEventListener('click',function(e){if(e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();openSearch(a);});});
  document.addEventListener('keydown',function(e){if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&!e.isComposing){e.preventDefault();if(!dialog||!dialog.open)openSearch();}});
  var pageHost=document.getElementById('search-page-app'),pageApp=null;
  if(pageHost){pageApp=createApp(pageHost,false);var p=params();pageApp.open(p.q,p.subject,true);window.addEventListener('popstate',function(){pageApp.refresh();});}

  // Search deep links: select the right view, expand ancestors, and focus the actual passage.
  var incoming=new URLSearchParams(location.search),q=(incoming.get('search')||'').slice(0,160),note=document.getElementById('note-root');
  if(q&&note){
    var bar=el('aside','search-return');bar.setAttribute('aria-label','搜索来源');
    var label=el('span','','来自搜索：'+q),back=el('a','','返回搜索结果 →');back.href=searchURL(q,incoming.get('subject')||'');bar.append(label,back);note.prepend(bar);
    var highlightTimer;
    function locateSearch(){
      var body=document.getElementById('note-body');if(!body||!window.NoteNavigation)return;
      clearTimeout(highlightTimer);body.querySelectorAll('.search-target').forEach(function(n){n.classList.remove('search-target');});label.textContent='来自搜索：'+q;
      var md=document.querySelector('[data-view-btn="markdown"]');if(md)md.click();
      var id='';try{id=decodeURIComponent(location.hash.slice(1));}catch(e){}
      var target=id?document.getElementById(id):null;
      if(target&&!body.contains(target))target=null;
      if(!target&&id){var section=incoming.get('section');target=section?document.getElementById(section):null;if(target&&!body.contains(target))target=null;
        label.textContent+=' · 内容已更新，已定位到'+(target?'相关章节':'资料开头');}
      if(incoming.get('sv')&&incoming.get('sv')!==version&&target)label.textContent+=' · 资料已更新';
      if(target){target.classList.add('search-target');highlightTimer=setTimeout(function(){target.classList.remove('search-target');},7000);}
      window.NoteNavigation.navigate(target||note);
    }
    if(window.NoteNavigation)locateSearch();else window.addEventListener('note:ready',locateSearch,{once:true});
    window.addEventListener('hashchange',locateSearch);
  }
})();
