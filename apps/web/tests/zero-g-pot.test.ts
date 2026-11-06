import test from 'node:test';
import assert from 'node:assert/strict';
import {freshPotDemo,updatePotDemo,zeroGPotPage} from '../src/zero-g-pot.ts';
const now=new Date('2026-11-06T12:00:00Z');
test('mock donations move exact credits from allowance into pot',()=>{
 const initial=freshPotDemo(now),next=updatePotDemo(initial,'donate','1.2710',now);
 assert.equal(next.own,0);assert.equal(next.available,initial.available+12710);
 assert.equal(next.donated,initial.donated+12710);assert.equal(initial.own,12710);
 for(const value of ['-1','0','2','NaN','0.00001','1e2'])assert.throws(()=>updatePotDemo(initial,'donate',value,now));
});
test('mock claims require exhaustion, respect pool balance and allow only one per UTC day',()=>{
 const initial=freshPotDemo(now);assert.throws(()=>updatePotDemo(initial,'claim','',now));
 const used=updatePotDemo(initial,'use','',now),claim=updatePotDemo(used,'claim','',now);
 assert.equal(claim.own,12771);assert.equal(claim.available,used.available-12771);
 assert.equal(claim.claimed,used.claimed+12771);
 assert.throws(()=>updatePotDemo({...claim,own:0},'claim','',now));
 assert.equal(updatePotDemo({...used,available:100},'claim','',now).own,100);
 assert.throws(()=>updatePotDemo({...used,available:0},'claim','',now));
 const nextDay=new Date('2026-11-07T00:00:00Z');
 const reset=updatePotDemo(claim,'use','',nextDay);
 assert.equal(reset.received,false);assert.equal(updatePotDemo(reset,'claim','',nextDay).own,12771);
});
test('Pot labels all funds as a mock demo and renders ASCII artwork',()=>{
 const page=zeroGPotPage();assert.match(page,/MOCK DEMO/);assert.match(page,/Simulated credits only/);
 assert.match(page,/once per UTC day/);assert.match(page,/No wallet transactions/);
 const art=page.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)![1]!;
 assert.ok([...art].every(c=>c.charCodeAt(0)<128));assert.ok(Math.max(...art.split('\n').map(l=>l.length))<=50);
});
