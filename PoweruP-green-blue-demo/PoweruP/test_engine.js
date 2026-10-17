const assert=require('node:assert/strict'),P=require('./engine');
const cfg={duration:24,lead:6,headroom:8,floor:.2};
// Missing consent must not authorize any reduction.
let h=P.makeHome(1,'Test',3);let b=P.budget(h,{...cfg,duration:72},h.capacity);assert.equal(b.actions.length,0);assert.equal(b.plannedKw,P.total(h));
h.loads.find(l=>l.id==='other').consent='declined';b=P.budget(h,{...cfg,duration:72},h.capacity);assert(!b.actions.some(a=>a.id==='other'));
// Accepted reductions never include essential loads, and cannot produce energy.
h.loads.filter(l=>l.id!=='essential').forEach(l=>{l.consent='accepted';l.consentHours=168;});b=P.budget(h,{...cfg,duration:72},h.capacity);assert(!b.actions.some(a=>a.id==='essential'));assert(b.plannedKw>=h.loads[0].kw);assert(!b.targetMet);assert(b.shortfallKwh>0);
let cases=0;
for(const duration of [6,24,72])for(const lead of [.25,3,6])for(const headroom of [0,.5,8,30]){
 const hs=P.defaults();hs[1].online=false;hs[0].loads[3].consent='accepted';hs[0].loads[3].consentHours=168;
 const c={...cfg,duration,lead,headroom},r=P.prepare(hs,c);cases++;
 assert.equal(r.homes[1].energy,hs[1].energy);
 const gain=r.homes.reduce((s,h)=>s+h.addedKwh,0),input=r.trace.reduce((s,t)=>s+t.total*t.dt,0);assert(Math.abs(gain-input*P.ETA)<1e-7);
 for(const t of r.trace){assert(t.total<=headroom+1e-8);assert(!t.allocations[2]);for(const v of Object.values(t.allocations))assert(v<=3+1e-8);}
 for(const hh of r.homes){assert(hh.energy<=hh.capacity+1e-8);assert(hh.energy>=hh.start-1e-8);}
}
// Outage energy accounting and depletion.
const only=P.makeHome(1,'Tiny',2);only.energy=1;
let state=P.startOutage([only],{...cfg,duration:24});state=P.advance(state,1);assert.equal(state.devices[0].energy,0);assert(Math.abs(state.devices[0].unservedKwh-(2-.9))<1e-8);
// Loss of communications must not change the local simulator policy.
const original=P.startOutage([h],cfg),offline=P.clone(original);offline.devices[0].offline=true;
const a=P.advance(original,1),z=P.advance(offline,1);assert.equal(a.devices[0].energy,z.devices[0].energy);
// End-of-target advance cannot overshoot elapsed time.
let end=P.startOutage([h],{...cfg,duration:.5});end=P.advance(end,1);assert.equal(end.elapsed,.5);
// Everyday dispatch excludes unknown batteries and respects reserves/round-trip losses.
const full=P.makeHome(1,'Full',.5);full.energy=39.2;const off=P.clone(full);off.id=2;off.online=false;
const day=P.everyday([full,off],{...cfg,duration:6},{buy:.15,sell:.4,eventHours:2});assert.equal(day.homes[1].exportKwh,0);assert(day.homes[0].reserveKwh>=39.2*.2);assert(day.homes[0].exportKwh<39.2*.9);assert.equal(day.margin,day.homes[0].revenue-day.homes[0].rechargeCost);
const negative=P.everyday([full],{...cfg,duration:6},{buy:1,sell:.1,eventHours:2});assert(negative.margin<0);
assert.throws(()=>P.prepare([h],{...cfg,headroom:-1}));assert.throws(()=>P.budget({...h,energy:100},cfg));
console.log(`Passed ${cases} schedule scenarios, consent checks, essential-load protection, depletion, offline replay and economics.`);

const short=P.makeHome(1,'Short consent',3);short.loads[3].consent='accepted';short.loads[3].consentHours=6;assert.equal(P.budget(short,{...cfg,duration:24}).actions.length,0);console.log('Time-scoped consent regression passed.');
