const assert=require('node:assert/strict'),N=require('./notifications.js');
const start=Date.parse('2026-10-17T06:00:00Z');
const contacts=[{id:'a',name:'Demo A',zip:'90002',channel:'sms',destination:'+12135550101',consent:true},
{id:'b',name:'Demo B',zip:'90002',channel:'email',destination:'demo@example.com',consent:false},
{id:'c',name:'Demo C',zip:'90008',channel:'sms',destination:'+19455550102',consent:true}];
let state={clock:start,contacts,alerts:[],outbox:[]};
const input={zip:'90002',level:'prepare',expected:start+6*3600000,expectedLabel:'demo time',evidence:'scenario'};
const alert=N.makeAlert(input,start);
state=N.dispatch(state,alert);
assert.equal(state.outbox.length,3);assert(state.outbox.every(m=>m.contactId==='a'));
assert.equal(state.outbox.filter(m=>m.status==='simulated sent').length,1);
assert(state.outbox[0].text.includes('not a confirmed utility shutoff'));
assert.equal(N.advance(state,299).outbox.filter(m=>m.status==='simulated sent').length,1);
state=N.advance(state,300);assert.equal(state.outbox.filter(m=>m.status==='simulated sent').length,2);
state.contacts[0].consent=false;state=N.advance(state,45);
assert(state.outbox.find(m=>m.kind==='EV / manual-load reminder').status.startsWith('cancelled'));
assert.throws(()=>N.dispatch(state,alert));
assert.throws(()=>N.makeAlert({...input,expected:start-1},start));
assert.throws(()=>N.validateContact({...contacts[0],destination:'945'}));
assert.equal(N.recipients(contacts,'90008')[0].id,'c'); // ZIP, not Dallas phone prefix.
let newer={clock:start,contacts:[{...contacts[0],consent:true}],alerts:[],outbox:[]};
newer=N.dispatch(newer,alert);newer=N.dispatch(newer,N.makeAlert({...input,expected:start+7*3600000},start+1));
assert.equal(newer.outbox.filter(m=>m.status==='superseded').length,2);
assert.equal(newer.outbox.filter(m=>m.status==='scheduled').length,2);
const monitor=N.makeAlert({zip:'90002',level:'monitor'},start);
assert.equal(N.dispatch({clock:start,contacts:[{...contacts[0],consent:true}],alerts:[],outbox:[]},monitor).outbox.length,1);
console.log('Notification model passed: ZIP targeting, opt-in, timing, no duplicates after advance, revocation, superseded schedules, monitoring mode and input validation.');
