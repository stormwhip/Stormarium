/* Shared by the browser and offline regression checks. No network or model calls. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports=factory();
  else root.SiteSearch=factory();
})(typeof globalThis!=='undefined'?globalThis:this, function () {
  'use strict';
  var aliases=[['夹逼定理','夹挤定理','两边夹定理'],['precis','précis'],['洛必达','洛医院'],['氢氧化铝','al(oh)3'],['费马原理','Fermat原理','费马（Fermat）原理']];
  function normalize(s) {
    return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
      .replace(/\\(?:text|mathrm|operatorname)\s*\{([^{}]*)\}/g,'$1')
      .replace(/\\(?:left|right|displaystyle|quad|qquad)\b|\\[,;!]/g,'')
      .replace(/\\([a-z]+)/g,'$1').replace(/[{}$\s_^]/g,'');
  }
  function groups(q) {
    return String(q || '').trim().split(/\s+/).filter(Boolean).slice(0,12).map(function(t){
      var n=normalize(t), result=[n];
      aliases.forEach(function(a){if(a.some(function(x){return normalize(x)===n;})) result=result.concat(a.map(normalize));});
      return Array.from(new Set(result)).filter(Boolean);
    }).filter(function(a){return a.length;});
  }
  function hit(value, group) { return group.some(function(t){return value.indexOf(t)!==-1;}); }
  function prepare(data) {
    return data.docs.map(function(d,di){
      var base={doc:d,di:di, title:normalize(d.title), meta:normalize([d.subject].concat(d.tags,d.keywords,[d.summary]).join(' '))};
      return {base:base, sections:d.sections.map(function(s,si){return {s:s,order:si,title:normalize(s.title),path:normalize(s.path.join(' ')),
        blocks:s.blocks.map(function(b){return {id:b.id,text:b.text,html:b.html,n:normalize(b.text)};})};})};
    });
  }
  function search(prepared,q,subject) {
    var gs=groups(q); if(!gs.length)return [];
    var phrase=normalize(q), rows=[];
    prepared.forEach(function(entry){
      var b=entry.base,d=b.doc;if(subject && d.subject!==subject)return;
      var metaMatches=gs.filter(function(g){return hit(b.title+b.meta,g);}).length;
      if(metaMatches)rows.push({doc:d,section:null,target:'',text:d.summary || (d.kind==='pdf'?'仅检索资料名称、标签及人工关键词，尚未检索 PDF 正文。':'网页正文可检索，点击打开资料。'),
        preview:d.summaryHtml,order:-1,matched:metaMatches,total:gs.length,score:(b.title===phrase?240:0)+gs.reduce(function(n,g){return n+(hit(b.title,g)?65:hit(b.meta,g)?16:0);},0),type:'资料信息'});
      entry.sections.forEach(function(s){
        var own=s.title+' '+s.path+' '+s.blocks.map(function(x){return x.n;}).join(' ');
        if(!gs.some(function(g){return hit(own,g);}))return;
        var matches=gs.filter(function(g){return hit(own+b.title+b.meta,g);}).length;
        var best=null,bestScore=0;
        s.blocks.forEach(function(block){var score=gs.reduce(function(n,g){return n+(hit(block.n,g)?1:0);},0);if(score>bestScore){best=block;bestScore=score;}});
        var titleHit=gs.some(function(g){return hit(s.title,g);});
        var excerpt=best || s.s.blocks[0];
        rows.push({doc:d,section:s.s,order:s.order,target:excerpt?excerpt.id:s.s.id,fallback:s.s.id,
          text:excerpt?excerpt.text:s.s.title,
          preview:excerpt?excerpt.html:s.s.html,matched:matches,total:gs.length,
          score:(s.title===phrase?280:0)+gs.reduce(function(n,g){return n+(hit(s.title,g)?85:hit(s.path,g)?35:hit(own,g)?20:8);},0),type:titleHit?'章节命中':'正文命中'});
      });
    });
    rows.sort(function(a,b){return (b.matched===b.total)-(a.matched===a.total)||b.matched-a.matched||b.score-a.score||a.doc.url.localeCompare(b.doc.url)||a.order-b.order||a.target.localeCompare(b.target);});
    // Keep at most three useful locations per note. A title-only query shows the note once.
    var counts={},seen={};
    return rows.filter(function(r){var key=r.doc.url;if(seen[key+'#'+r.target])return false;seen[key+'#'+r.target]=true;
      if((counts[key]||0)>=3)return false;counts[key]=(counts[key]||0)+1;return true;});
  }
  function excerpt(text,q) {
    var terms=String(q||'').trim().split(/\s+/).filter(Boolean), lower=text.toLowerCase(),at=-1;
    terms.forEach(function(t){var i=lower.indexOf(t.toLowerCase());if(i>=0&&(at<0||i<at))at=i;});
    if(at<0)groups(q).some(function(g){return g.some(function(t){var i=normalize(text).indexOf(t);if(i<0)return false;at=0;return true;});});
    var start=Math.max(0,(at<0?0:at)-35),end=Math.min(text.length,start+155);
    return (start?'…':'')+text.slice(start,end)+(end<text.length?'…':'');
  }
  return {normalize:normalize,groups:groups,prepare:prepare,search:search,excerpt:excerpt};
});
