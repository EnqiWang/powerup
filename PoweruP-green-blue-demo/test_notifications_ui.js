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
vm.runInContext(fs.readFileSync(__dirname+'/notifications.js','utf8'),context);
assert(nodes.notifyClock.textContent.includes('DEMO CLOCK'));
nodes.seedContacts.onclick();assert(nodes.notifyContacts.innerHTML.includes('Demo resident 6'));
assert(nodes.notifyAudience.textContent.startsWith('2 opted-in'));
nodes.notifyLevel.value='prepare';nodes.notifyEvidence.value='scenario';nodes.reviewNotify.onclick();assert(nodes.notifyReview.open);assert(nodes.notifyReviewBody.textContent.includes('DEMO ONLY'));
nodes.confirmNotify.onclick();assert(!nodes.notifyReview.open);assert(nodes.notifyCounts.textContent.startsWith('2 simulated messages · 4 scheduled'));
nodes.nextNotify.onclick();assert(nodes.notifyCounts.textContent.startsWith('4 simulated messages · 2 scheduled'));
nodes.nextNotify.onclick();assert(nodes.notifyCounts.textContent.startsWith('6 simulated messages · 0 scheduled'));
nodes.nextNotify.onclick();assert(nodes.notifyStatus.textContent.includes('No pending reminders'));
nodes.notifyZip.value='90008';nodes.notifyZip.oninput();assert(nodes.notifyAudience.textContent.startsWith('2 opted-in'));
// Enrollment uses the resident's ZIP independently from phone prefix.
nodes.contactName.value='<script>Resident</script>';nodes.contactZip.value='90002';nodes.contactChannel.value='sms';nodes.contactDestination.value='+19455550101';nodes.contactOptin.checked=true;nodes.addNotifyContact.onclick();
assert(nodes.notifyContacts.innerHTML.includes('&lt;script&gt;Resident&lt;/script&gt;'));assert(!nodes.notifyContacts.innerHTML.includes('<script>Resident'));
nodes.notifyZip.value='90002';nodes.notifyZip.oninput();assert(nodes.notifyAudience.textContent.startsWith('3 opted-in'));
nodes.notifyLevel.value='monitor';nodes.reviewNotify.onclick();assert(nodes.notifyReview.open);nodes.cancelNotify.onclick();assert(!nodes.notifyReview.open);
console.log('Notification DOM flow passed: enrollment, review/cancel, simulated send, two scheduled reminders, outbox and safe names.');
