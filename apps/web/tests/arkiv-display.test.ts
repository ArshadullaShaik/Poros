import test from 'node:test';
import assert from 'node:assert/strict';
import {transactionLink,remainingLifetime} from '../src/arkiv-display.ts';
import {createCommunityModeration} from '../src/moderation.ts';

test('transaction links validate hashes and preserve settlement network',()=>{
 const hash='0x'+'a'.repeat(64);
 assert.match(transactionLink(hash),new RegExp('https://rabdi.explorer.arkiv.network/tx/'+hash));
 assert.match(transactionLink(hash,'sepolia'),/sepolia.etherscan.io/);
 for(const bad of ['request-id','javascript:alert(1)','0x123',undefined])assert.equal(transactionLink(bad),'');
});
test('countdown uses chain time, clamps expiry and refuses stale timing',()=>{
 const clock={block:100n,timestamp:100000,duration:2,observed:100000};
 assert.equal(remainingLifetime('130',clock,110000),'~0d 0h 0m 50s remaining');
 assert.match(remainingLifetime('100',clock,110000),/^Expired/);
 assert.match(remainingLifetime('130',clock,230001),/unavailable/);
 assert.match(remainingLifetime('130',undefined),/unavailable/);
});
test('moderation serializes inference, caches decisions and never caches failures',async()=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 let key:string|null='sk-test-key',calls=0,active=0,peak=0,fail=false;
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>key}});
 try{
 const moderate=createCommunityModeration(async(_url,init)=>{
 calls++;active++;peak=Math.max(peak,active);assert.equal((init!.headers as any).Authorization,'Bearer '+key);
 await new Promise(resolve=>setTimeout(resolve,5));active--;
 return Response.json(fail?{ok:false}:{ok:true,data:{allowed:JSON.parse(String(init!.body)).text!=='blocked'}},{status:fail?503:200});
 });
 assert.deepEqual(await Promise.all([moderate('safe'),moderate('safe'),moderate('blocked')]),[true,true,false]);
 assert.equal(calls,2);assert.equal(peak,1);
 fail=true;await assert.rejects(moderate('retry'),{code:'MODERATION_UNAVAILABLE'});
 fail=false;assert.equal(await moderate('retry'),true);assert.equal(calls,4);
 key=null;await assert.rejects(moderate('new'),{code:'MODERATION_UNAVAILABLE'});
 }finally{if(original)Object.defineProperty(globalThis,'localStorage',original);else Reflect.deleteProperty(globalThis,'localStorage');}
});
