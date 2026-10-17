const assert=require('node:assert/strict'),P=require('./advanced');
const cfg={duration:24,lead:6,headroom:8,floor:.2};
// A six-hour permission must save only six hours of energy in a 24h budget.
const h=P.makeHome(1,'House',2);h.loads[3].consent='accepted';h.loads[3].consentHours=6;h.energy=2;
const b=P.budget(h,cfg);assert.equal(b.actions.length,1);assert(Math.abs(b.requiredKwh-(2*24-.2*6)/.9)<1e-8);assert.equal(b.actions[0].untilHours,6);
let state=P.startOutage([h],cfg);state.devices[0].energy=39.2;state=P.advance(state,7);assert(Math.abs(state.devices[0].energy-(39.2-(2*7-.2*6)/.9))<1e-7);assert.equal(state.devices[0].plannedKw,2);
// Optional task energy plus battery input stays within shared power headroom.
const t=P.makeHome(1,'Task house',.2);t.energy=35;t.prepTasks=[{id:'ev',name:'EV',kwh:2,rate:1,enabled:true,accepted:true}];
let plan=P.prepare([t],{...cfg,duration:1,lead:3,headroom:1});assert(Math.abs(plan.homes[0].tasks[0].delivered-2)<1e-8);assert(plan.trace.every(x=>x.total<=1+1e-8));
t.prepTasks[0].accepted=false;plan=P.prepare([t],{...cfg,duration:1});assert.equal(plan.homes[0].tasks.length,0);
for(const headroom of [0,.5,8,50])for(const duration of [6,24,72]){
 const hs=P.defaults();hs[0].prepTasks=[{id:'ev',name:'EV',kwh:2,rate:1,enabled:true,accepted:true}];hs[1].online=false;
 const r=P.prepare(hs,{...cfg,headroom,duration}),battery=r.homes.reduce((s,h)=>s+h.addedKwh,0)/P.ETA,tasks=r.homes.reduce((s,h)=>s+h.tasks.reduce((n,t)=>n+t.delivered,0),0),input=r.trace.reduce((s,t)=>s+t.total*t.dt,0);
 assert(Math.abs(battery+tasks-input)<1e-7);assert(r.trace.every(t=>t.total<=headroom+1e-7));assert.equal(r.homes[1].addedKwh,0);
}
// No diagnosis beyond evidence; correlated providers merely raise suspicion.
const peers=P.defaults().map((h,i)=>({...h,provider:'A',online:i>1,evidence:{fresh:false}}));assert.match(P.diagnose(peers[0],peers).label,/suspected/);peers[1].online=true;assert.equal(P.diagnose(peers[0],peers).label,'Cause unknown');peers[0].evidence={fresh:true,breaker:'tripped'};assert.match(P.diagnose(peers[0],peers).label,/Breaker/);
// No neighbor is switched off; insufficient resources leave a visible deficit.
const empty=P.makeHome(1,'Empty',2);empty.energy=0;const r=P.relief([empty],cfg,{capacity:0,hours:2,neighbors:[{name:'Comms',kw:3,graceHours:0}]});assert.equal(r.unresolvedKw,5);assert.equal(r.actions.length,0);
console.log('Advanced model checks passed: consent expiry, exact outage integration, optional task accounting, unknown exclusions, evidence triage and unresolved neighborhood relief.');
