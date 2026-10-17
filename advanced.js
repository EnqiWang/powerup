/* Additional PoweruP scenario models. No physical or messaging controls. */
(function(root){'use strict';const P=root.Powerup??require('./engine');
function energyNeed(base,actions,start,end){return Math.max(0,base*(end-start)-actions.reduce((s,a)=>s+a.savedKw*Math.max(0,Math.min(end,a.untilHours)-start),0));}
function atPower(base,actions,t){return Math.max(0,base-actions.reduce((s,a)=>s+(t<a.untilHours-1e-9?a.savedKw:0),0));}
function runtime(base,actions,energy,offset=0){let delivered=energy*P.ETA,t=offset;const stops=[...new Set(actions.map(a=>a.untilHours).filter(x=>x>offset))].sort((a,b)=>a-b);for(const stop of stops){const need=energyNeed(base,actions,t,stop);if(delivered<need-1e-9){const kw=atPower(base,actions,t);return kw? t-offset+delivered/kw:null;}delivered-=need;t=stop;}return base>0?t-offset+delivered/base:null;}
function budget(h,c,energy=h.energy){P._originalBudget(h,c,energy);const base=P.total(h),allow=energy*P.ETA/c.duration,actions=[];let need=base*c.duration;
 for(const l of h.loads.filter(l=>l.id!=='essential'&&l.consent==='accepted'&&l.reduction>0&&(l.consentHours||0)>0).sort((a,b)=>a.rank-b.rank)){
  if(need<=energy*P.ETA+1e-9)break;const saved=l.kw*l.reduction;if(saved<=0)continue;const until=Math.min(l.consentHours,c.duration);actions.push({id:l.id,name:l.name,savedKw:saved,reduction:l.reduction,untilHours:until});need-=saved*until;}
 return {baseKw:base,budgetKw:allow,plannedKw:atPower(base,actions,0),averageKw:need/c.duration,actions,runtime:runtime(base,actions,energy),baselineRuntime:base?energy*P.ETA/base:null,targetMet:need<=energy*P.ETA+1e-8,shortfallKwh:Math.max(0,need/P.ETA-energy),requiredKwh:need/P.ETA,unknown:!h.online};}
function prepare(homes,c){
 // Run the original validator before the extended, consent-window scheduler.
 P._originalPrepare(homes,c);
 const hs=homes.map(h=>{const b=budget(h,c,h.capacity),required=Math.max(h.capacity*c.floor,b.requiredKwh);return {...P.clone(h),start:h.energy,target:Math.min(h.capacity,required),required,projection:b,tasks:(h.prepTasks||[]).filter(t=>t.enabled&&t.accepted).map(t=>({...t,remaining:t.kwh,delivered:0}))};});
 const trace=[];for(let time=0;time<c.lead-1e-9;time+=.25){const dt=Math.min(.25,c.lead-time);let remaining=c.headroom;const allocations={},taskAllocations={};
 const queue=hs.filter(h=>h.online&&h.energy<h.target-1e-9).sort((a,b)=>b.priority-a.priority||(a.energy*P.ETA/Math.max(.001,a.projection.averageKw))-(b.energy*P.ETA/Math.max(.001,b.projection.averageKw)));
 for(const h of queue){const kw=Math.max(0,Math.min(h.rate,remaining,(h.target-h.energy)/(P.ETA*dt)));h.energy=Math.min(h.capacity,h.energy+kw*P.ETA*dt);remaining-=kw;allocations[h.id]=kw;}
 // Optional EV/thermal tasks use remaining headroom after battery preparation.
 for(const h of hs.filter(h=>h.online).sort((a,b)=>b.priority-a.priority))for(const task of h.tasks){const kw=Math.max(0,Math.min(task.rate,remaining,task.remaining/dt));task.remaining-=kw*dt;task.delivered+=kw*dt;remaining-=kw;taskAllocations[h.id+':'+task.id]=kw;}
 trace.push({hour:time,dt,total:c.headroom-remaining,allocations,taskAllocations});}
 return {homes:hs.map(h=>({...h,budget:budget(h,c,h.energy),addedKwh:h.energy-h.start,shortfallKwh:Math.max(0,h.required-h.energy)})),trace};}
function startOutage(homes,c,prep=null){return {elapsed:0,duration:c.duration,devices:homes.map(h=>{const projected=prep?.homes.find(x=>x.id===h.id),energy=projected&&h.online?projected.energy:h.energy,b=budget(h,c,energy);return {id:h.id,energy,initialEnergy:energy,baseKw:b.baseKw,plannedKw:b.plannedKw,actions:b.actions,offline:!h.online,unservedKwh:0,policy:'Use only accepted reductions until their consent windows expire; retain required loads'};})};}
function advance(state,hours){if(!Number.isFinite(hours)||hours<=0||hours>24)throw Error('Advance must be >0 and <=24 hours.');const out=P.clone(state),start=out.elapsed,dt=Math.max(0,Math.min(hours,out.duration-start));out.elapsed+=dt;
 for(const d of out.devices){const wanted=energyNeed(d.baseKw,d.actions,start,out.elapsed),supplied=Math.min(wanted,d.energy*P.ETA);d.unservedKwh+=Math.max(0,wanted-supplied);d.energy=Math.max(0,d.energy-supplied/P.ETA);d.plannedKw=atPower(d.baseKw,d.actions,out.elapsed);}return out;}
function outageBudget(d,elapsed,duration){const remaining=Math.max(.000001,duration-elapsed),need=energyNeed(d.baseKw,d.actions,elapsed,duration);return {runtime:runtime(d.baseKw,d.actions,d.energy,elapsed),baselineRuntime:d.baseKw?d.initialEnergy*P.ETA/d.baseKw:null,plannedKw:atPower(d.baseKw,d.actions,elapsed),baseKw:d.baseKw,budgetKw:d.energy*P.ETA/remaining,actions:d.actions,targetMet:need<=d.energy*P.ETA+1e-8&&d.unservedKwh<1e-8,shortfallKwh:Math.max(0,need/P.ETA-d.energy),requiredKwh:need/P.ETA};}
function relief(homes,c,options){const duration=options.hours;if(!Number.isFinite(duration)||duration<=0||!Number.isFinite(options.capacity)||options.capacity<0)throw Error('Invalid relief event.');const neighbors=options.neighbors,external=neighbors.reduce((s,n)=>s+n.kw,0),baseline=homes.reduce((s,h)=>s+P.total(h),0)+external,needed=Math.max(0,baseline-options.capacity);let left=needed;const actions=[];
 // Defer accepted residential loads first. Neighbors are observed constraints,
 // not controllable loads. No port-control or power-flow claim.
 for(const h of homes.filter(h=>h.online))for(const l of h.loads.filter(l=>l.id!=='essential'&&l.consent==='accepted'&&l.gridAccepted&&l.reduction>0&&(l.consentHours||0)>=duration).sort((a,b)=>a.rank-b.rank)){
  const reduction=Math.min(left,l.kw*l.reduction);if(reduction>0){actions.push({home:h.id,kind:'Voluntary demand reduction',name:l.name,kw:reduction});left-=reduction;}}
 for(const h of homes.filter(h=>h.online&&h.gridParticipation).sort((a,b)=>a.priority-b.priority)){const b=budget(h,c,h.capacity),reserve=Math.min(h.capacity,Math.max(h.capacity*c.floor,b.requiredKwh)),available=Math.max(0,h.energy-reserve)*P.ETA/duration,kw=Math.min(left,h.exportCap||3,available);if(kw>0){actions.push({home:h.id,kind:'Battery support above reserve',name:'Grid-connected energy support',kw});left-=kw;}}
 return {baselineKw:baseline,externalKw:external,neededKw:needed,providedKw:needed-left,unresolvedKw:left,actions,unknown:homes.filter(h=>!h.online).length,energyReliefKwh:(needed-left)*duration,
 urgentNeighbors:neighbors.filter(n=>n.graceHours<duration).map(n=>n.name)};}
function diagnose(h,homes){if(h.online)return {label:'Communicating',confidence:'Observed in simulator',next:'Continue monitoring; online status alone does not verify battery health.'};const e=h.evidence||{};
 if(e.fresh&&e.fault)return {label:'Fault report received',confidence:'Additional simulated evidence',next:'Hand to an operator for equipment-specific troubleshooting. No remote reset.'};
 if(e.fresh&&e.breaker==='tripped')return {label:'Breaker trip suspected',confidence:'Fresh auxiliary status in scenario',next:'Request qualified inspection; confirm before changing equipment state.'};
 if(e.fresh&&e.voltage===0)return {label:'Grid loss suspected',confidence:'Fresh auxiliary meter evidence in scenario',next:'Check utility status and independent device telemetry. Battery operation remains unverified.'};
 const peers=homes.filter(x=>x.id!==h.id&&!x.online&&x.provider===h.provider);
 if(peers.length)return {label:'Shared communications fault suspected',confidence:'Correlated missing heartbeats, not proof',next:`${peers.length+1} devices share the scenario network provider. Request alternate-channel checks; exclude capacity until verified.`};
 return {label:'Cause unknown',confidence:'Missing heartbeat only',next:'Cannot distinguish hardware fault, breaker trip and communication loss. Request fresh independent evidence.'};}
P._originalEveryday=P.everyday;P._originalBudget=P.budget;P._originalPrepare=P.prepare;Object.assign(P,{budget,prepare,startOutage,advance,outageBudget,relief,diagnose,energyNeed,atPower});
// Replace everyday reserve calculations with the consent-window budget too.
P.everyday=(homes,c,p)=>{P._originalEveryday(homes,c,p);const hs=homes.map(h=>{const b=budget(h,c,h.capacity),reserve=Math.min(h.capacity,Math.max(h.capacity*c.floor,b.requiredKwh)),available=h.online&&h.gridParticipation?Math.max(0,h.energy-reserve):0,delivered=available*P.ETA,revenue=delivered*p.sell,cost=available/P.ETA*p.buy;return {id:h.id,online:h.online,reserveKwh:reserve,availableStoredKwh:available,exportKwh:delivered,averageKw:delivered/p.eventHours,revenue,rechargeCost:cost,margin:revenue-cost};});return {homes:hs,exportKwh:hs.reduce((s,h)=>s+h.exportKwh,0),margin:hs.reduce((s,h)=>s+h.margin,0)};};
if(typeof module!=='undefined')module.exports=P;
})(typeof globalThis!=='undefined'?globalThis:this);
