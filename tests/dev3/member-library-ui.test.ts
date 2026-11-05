import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mountMemberLibrary} from '../../src/features/builder/demo/community.js';
class Control {textContent='';value='';handlers:any={};addEventListener(k:string,fn:Function){this.handlers[k]=fn;}}
test('member sidebar clears recovery input, loads real data and discards a response after wallet changes',async()=>{
 const controls=new Map(['unlocked-status','creators-status','library-recovery','unlock-library-form','lock-library','refresh-member-library','refresh-creator-library'].map(id=>[id,new Control()]));
 let entries:any[]=[],creators:any[]=[],changed:Function=()=>{},resolve:Function=()=>{},delayed=false,seenCode:any,resets=0;
 const result={account:'wallet',locked:false,entries:[{name:'Private rules'}],creators:[{id:'creator',name:'Creator',expiresAt:Date.now()+100000}]};
 const ui=mountMemberLibrary({root:{querySelector:(id:string)=>controls.get(id.slice(1))},loadApi:async()=>({readPersonalLibrary:async(code:any)=>{seenCode=code;return delayed?new Promise(done=>{resolve=done;}):result;},subscribeLibraryWallet:(fn:Function)=>{changed=fn;return ()=>{};}}),onEntries:(v:any)=>{entries=v;},onCreators:(v:any)=>{creators=v;},onReset:()=>{resets++;}});
 await ui.refresh();assert.equal(creators[0].name,'Creator');assert.equal(entries[0].name,'Private rules');
 controls.get('library-recovery')!.value='private-code';controls.get('unlock-library-form')!.handlers.submit({preventDefault(){}});assert.equal(controls.get('library-recovery')!.value,'');await new Promise(done=>setImmediate(done));assert.equal(seenCode,'private-code');
 delayed=true;const pending=ui.refresh();await new Promise(done=>setImmediate(done));changed();resolve(result);await pending;assert.deepEqual(entries,[]);assert.deepEqual(creators,[]);assert.ok(resets);assert.match(controls.get('unlocked-status')!.textContent,/Wallet changed/);ui.stop();
});
