/* Presentation only: themes and progressive disclosure. No dispatch/data mutations. */
(function(root){
'use strict';
const key='powerup-theme', doc=document, html=doc.documentElement;
let saved=null;try{saved=localStorage.getItem(key);}catch(_){}
const media=root.matchMedia?root.matchMedia('(prefers-color-scheme: dark)'):null;
function theme(name,persist=false){
 name=name==='dark'?'dark':'light';html.dataset.theme=name;
 if(persist){saved=name;try{localStorage.setItem(key,name);}catch(_){}}
 doc.querySelectorAll('[data-theme-choice]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.themeChoice===name)));
 const meta=doc.querySelector('meta[name="theme-color"]');if(meta)meta.content=name==='dark'?'#0c1520':'#f3f7fa';
 root.PowerupScene?.setTheme?.(name);
}
doc.querySelectorAll('[data-theme-choice]').forEach(b=>b.addEventListener('click',()=>theme(b.dataset.themeChoice,true)));
theme(saved==='light'||saved==='dark'?saved:(media?.matches?'dark':'light'));
media?.addEventListener?.('change',e=>{if(!saved)theme(e.matches?'dark':'light');});

// Keep native details state when the existing planner redraws controls.
const states=new Map();
function fold(id,title,nodes,forceOpen=false){
 const box=doc.createElement('details');box.className='profile-section';box.dataset.uiSection=id;
 box.open=forceOpen||(states.get(id)??false);
 const summary=doc.createElement('summary');summary.textContent=title;box.appendChild(summary);
 const body=doc.createElement('div');body.className='section-body';nodes.forEach(n=>body.appendChild(n));box.appendChild(body);
 box.addEventListener('toggle',()=>states.set(id,box.open));return box;
}
function decorate(){
 const target=doc.getElementById('detail'), first=target?.firstElementChild;
 if(!first||first.dataset.uiDecorated||!doc.getElementById('soc'))return;
 first.dataset.uiDecorated='true';first.classList.add('profile-summary');
 const source=first.firstElementChild;
 if(source?.classList.contains('insight'))first.appendChild(fold('source','Source & model assumptions',[source]));
 const fields=doc.getElementById('soc').closest('.fields');
 const priority=doc.getElementById('priority').closest('label'),disconnect=doc.getElementById('disconnect');
 first.appendChild(fold('battery','Battery scenario settings',[fields,priority,disconnect]));
 const flex=Array.from(target.children).find(n=>n!==first&&!n.classList.contains('extra-detail')&&n.querySelector('#requestFlex'));
 if(flex){const box=fold('permissions','Resident permissions & load estimates',[flex]);target.appendChild(box);}
 const extra=target.querySelector('.extra-detail');
 if(extra){
  const groups=[];let current=null;
  Array.from(extra.childNodes).forEach(n=>{
   if(n.nodeType===1&&n.tagName==='H3'){current={title:n.textContent,nodes:[]};groups.push(current);n.remove();}
   else if(current)current.nodes.push(n);
  });
  groups.forEach((g,i)=>target.appendChild(fold('extra-'+i,g.title,g.nodes,i===2&&doc.getElementById('selectedStatus').textContent==='UNKNOWN')));
  extra.remove();
 }
}
const detail=doc.getElementById('detail');if(detail)new MutationObserver(decorate).observe(detail,{childList:true,subtree:true});
decorate();
root.PowerupUI={setTheme:name=>theme(name,true),decorate};
})(globalThis);
