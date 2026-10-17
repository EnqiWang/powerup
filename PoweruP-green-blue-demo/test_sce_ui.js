/* Lightweight DOM smoke test. This is not a real-browser rendering test. */
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/index.html','utf8'),nodes={},dynamic={};
function makeNode(key){return nodes[key]??=( {value:'',checked:false,disabled:false,hidden:false,dataset:{},classList:{toggle(){}},open:false,reportValidity(){return true},showModal(){this.open=true},close(){this.open=false},click(){return this.onclick?.()},appendChild(child){this.innerHTML+=child.innerHTML||''},closest(){return this},replaceChildren(){this.innerHTML=''},querySelectorAll(selector){return query(selector)},querySelector(){return null},set innerHTML(s){dynamic[key]=s},get innerHTML(){return dynamic[key]||''},textContent:''});}
function register(markup){for(const m of markup.matchAll(/<([a-z][a-z0-9]*)\b([^>]+)>/g)){const attrs={};for(const a of m[2].matchAll(/([a-zA-Z-]+)="([^"]*)"/g))attrs[a[1]]=a[2];if(attrs.id){const n=makeNode(attrs.id);if(attrs.value!==undefined)n.value=attrs.value;}for(const attr of Object.keys(attrs).filter(a=>a.startsWith('data-'))){const key=attr+':'+attrs[attr],n=makeNode(key);n.dataset[attr.slice(5)]=attrs[attr];}}}
register(html);
function query(selector){const attr=selector.match(/^\[(data-[\w-]+)\]$/)?.[1];if(!attr)return[];register(Object.values(dynamic).join(''));return Object.entries(nodes).filter(([key])=>key.startsWith(attr+':')).map(([,n])=>n);}
const document={head:{appendChild(){}},getElementById(id){if(id==='profileCardStyles')return null;register(Object.values(dynamic).join(''));if(!nodes[id])throw Error('Missing DOM element '+id);return nodes[id]},querySelectorAll:query,createElement:()=>makeNode('created')};
const context={document,console,Date,setTimeout,location:{protocol:'http:',reload(){}},AbortSignal,Blob,URL,fetch:async()=>{throw Error('No fixture response configured')}};vm.createContext(context);vm.runInContext(fs.readFileSync(__dirname+'/engine.js','utf8'),context);vm.runInContext(fs.readFileSync(__dirname+'/advanced.js','utf8'),context);vm.runInContext(fs.readFileSync(__dirname+'/app.js','utf8'),context);vm.runInContext(fs.readFileSync(__dirname+'/experience.js','utf8'),context);
vm.runInContext(fs.readFileSync(__dirname+'/sce.js','utf8'),context);
const run=s=>vm.runInContext(s,context);
(async()=>{
 const reply=zip=>({kind:'zip-benchmark',zip,source:'TEST FIXTURE ONLY',fetchedAt:'2026-10-17T00:00:00Z',apiUrl:'https://example.test',records:[],latest:{year:2024,month:6,averagekwh:360,totalaccounts:100,combined:'N',dailyKwh:12,meanKw:.5,usable:true}});
 context.fetch=async url=>({ok:true,json:async()=>reply(url.split('=')[1])});
 nodes.sceZips.value='90002,90008';await nodes.loadSce.onclick();assert(!nodes.applySce.disabled);assert.equal(run('homes.length'),2);assert(nodes.map.innerHTML.includes('ZIP 90002'));assert(nodes.map.innerHTML.includes('360.0 kWh/account/month'));assert(!nodes.map.innerHTML.includes('House'));
 assert.equal(run('homes.length'),2);assert.equal(run('source.kind'),'zip-benchmark');assert.equal(run('homes[0].meanKw'),.5);
 assert(nodes.detail.innerHTML.includes('Representative scenario from ZIP monthly average'));
 assert(!nodes.dataBadge.textContent.includes('MEASURED LOAD PROXIES'));
 nodes.guided.onclick();assert(!nodes.tour.hidden);for(let i=0;i<5;i++)nodes.tourNext.onclick();assert.equal(run('mode'),'everyday');
 const snapshot=run('({version:4,source,weatherSnapshot:null,cfg,prices,homes})');
 await nodes.snapshotFile.onchange({target:{files:[{size:1000,text:async()=>JSON.stringify(snapshot)}],value:''}});
 assert(nodes.dataBadge.textContent.includes('REAL ZIP AGGREGATES'));assert(nodes.sceStatus.textContent.includes('Saved historical'));
 context.fetch=async()=>{throw Error('offline')};await nodes.loadSce.onclick();assert(nodes.applySce.disabled);assert.equal(run('homes.length'),2);assert(nodes.sceStatus.textContent.includes('Failed requests'));
 nodes.sceZips.value='bad';await nodes.loadSce.onclick();assert(nodes.sceStatus.textContent.includes('five-digit'));
 console.log('SCE DOM flow passed: fetch, explicit application, truthful labels, guide, offline snapshot, failed request preserves fleet.');
})().catch(e=>{console.error(e);process.exitCode=1});
