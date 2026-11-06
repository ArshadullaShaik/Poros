import test from 'node:test';
import assert from 'node:assert/strict';
import {memberContentHash} from '../../../src/integrations/arkiv/community/member-content.ts';
import {StorageError} from '../../../src/integrations/arkiv/errors.ts';
import {tradeMarkup} from '../components/trade-markup.ts';
import {CreatorMembershipPanel} from '../src/creator-membership.ts';
const owner=('0x'+'1'.repeat(40)) as `0x${string}`,buyer=('0x'+'2'.repeat(40)) as `0x${string}`;
test('creator can publish with no members and subscriber can renew without key onboarding',async()=>{
 const previous=globalThis.window,previousStorage=globalThis.localStorage;
 Object.defineProperty(globalThis,'window',{value:new EventTarget(),configurable:true});
 Object.defineProperty(globalThis,'localStorage',{value:{getItem:()=>null},configurable:true});
 const panel=new CreatorMembershipPanel({getContext:async()=>({account:owner})} as any,{} as any);
 const root:any={isConnected:true,innerHTML:'',addEventListener(){},replaceChildren(){this.innerHTML='';},querySelector(){return {innerHTML:'',textContent:''};}};
 panel.service.getPlan=async()=>({key:'0x'+'a'.repeat(64),data:{priceWei:'100'}} as any);
 panel.service.members=async()=>[];panel.service.signals=async()=>[];panel.readers.now=async()=>1000;
 try{
  await panel.mount(root,owner,owner,false);assert.match(root.innerHTML,/data-member-form="signal"/);assert.match(root.innerHTML,/data-private-feed/);
  panel.service.members=async()=>[{wallet:buyer,expiresAt:100000,lastClaim:('0x'+'b'.repeat(64)) as `0x${string}`}];
  await panel.mount(root,owner,buyer,false);assert.match(root.innerHTML,/Renew/);assert.doesNotMatch(root.innerHTML,/recovery code|Register encrypted|Complete delivery/);
 }finally{panel.dispose();Object.defineProperty(globalThis,'window',{value:previous,configurable:true});Object.defineProperty(globalThis,'localStorage',{value:previousStorage,configurable:true});}
});

test('member library has no obsolete recovery-code onboarding',()=>{
 assert.doesNotMatch(tradeMarkup,/Community recovery code|unlock-library-form|Unlock strategies/);
});
test('invalid drafts never enter the publication journal and uncertain Arkiv recovery never resubmits',async()=>{
 const previous=globalThis.window,storage=globalThis.localStorage;const entries=new Map<string,string>();
 Object.defineProperty(globalThis,'window',{value:new EventTarget(),configurable:true});
 Object.defineProperty(globalThis,'localStorage',{value:{getItem:(key:string)=>entries.get(key)??null,setItem:(key:string,value:string)=>entries.set(key,value),removeItem:(key:string)=>entries.delete(key)},configurable:true});
 const pointer={format:'swarm-message/1',publicationId:crypto.randomUUID(),swarmAddress:'a'.repeat(64),payloadHash:'0x'+'b'.repeat(64),source:'manual'};
 let rows:any[]=[],writes=0;
 const panel=new CreatorMembershipPanel({getContext:async()=>({account:owner})} as any,{scan:async()=>rows} as any);
 Object.assign(panel,{account:owner,creator:owner});
 try{
  await assert.rejects((panel as any).publishSignal({title:'a'.repeat(101),body:'Rules',source:'manual'}));
  assert.equal(entries.size,0,'invalid local draft must not block future messages');
  panel.readers.isFailedWrite=async()=>false;
  panel.service.publishSignal=async()=>{writes++;throw new StorageError('WRITE_STATUS_UNKNOWN','pending',{txHash:('0x'+'c'.repeat(64)) as any});};
  const action={actor:owner,requestId:pointer.publicationId,kind:'signal',pointer};
  await assert.rejects((panel as any).write(action));
  const pending=()=>JSON.parse([...entries.values()][0]!);
  assert.equal(pending().txHash,'0x'+'c'.repeat(64));
  await assert.rejects((panel as any).write(pending(),true));assert.equal(writes,1);
  rows=[{key:'0x'+'d'.repeat(64),actor:owner,subject:owner,type:'private-signal',scope:'global',source:'arkiv',data:pointer,requestId:pointer.publicationId}];
  await (panel as any).write(pending(),true);assert.equal(writes,1);assert.equal(entries.size,0);
  rows=[];writes=0;
  panel.service.publishSignal=async()=>{writes++;throw new StorageError('WRITE_STATUS_UNKNOWN','pending',writes===1?{txHash:('0x'+'c'.repeat(64)) as any}:{});};
  panel.readers.isFailedWrite=async()=>true;
  await assert.rejects((panel as any).write(action));
  await assert.rejects((panel as any).write(pending(),true));assert.equal(writes,2);assert.equal(pending().txHash,undefined);
  await assert.rejects((panel as any).write(pending(),true));assert.equal(writes,2);
 }finally{panel.dispose();Object.defineProperty(globalThis,'window',{value:previous,configurable:true});Object.defineProperty(globalThis,'localStorage',{value:storage,configurable:true});}
});

test('creator feed pages older posts without disabling the newest messages',async()=>{
 const previous=globalThis.window,storage=globalThis.localStorage,fetcher=globalThis.fetch;
 Object.defineProperty(globalThis,'window',{value:new EventTarget(),configurable:true});
 Object.defineProperty(globalThis,'localStorage',{value:{getItem:()=>null},configurable:true});
 globalThis.fetch=async(_url:any,init:any)=>{
  const body=JSON.parse(init.body);
  if(String(_url).endsWith('challenge'))return Response.json({ok:true,data:{nonce:'nonce',message:JSON.stringify({domain:'poros:member-content:1',wallet:owner,operation:'read',target:body.target,nonce:'nonce',expiresAt:Date.now()+300000})}});
  return Response.json({ok:true,data:{messages:keys.map(signalKey=>({signalKey,expiresAt:null,content:{title:signalKey,body:'Rules',source:'manual'}}))}});
 };
 let keys:string[]=[];
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(url:any,init:any)=>{const body=JSON.parse(init.body);if(String(url).endsWith('challenge'))keys=body.target.signalKeys;return originalFetch(url,init);};
 const panel=new CreatorMembershipPanel({getContext:async()=>({account:owner}),signMessage:async()=> '0x1234'} as any,{} as any);
 const feed={innerHTML:''},status={textContent:''};
 const root:any={isConnected:true,innerHTML:'',addEventListener(){},replaceChildren(){},querySelector:(selector:string)=>selector==='[data-private-feed]'?feed:status};
 panel.service.getPlan=async()=>null as any;panel.service.members=async()=>[];panel.readers.now=async()=>Date.now();panel.readers.blockTimestamp=async()=>1000;
 panel.service.signals=async()=>Array.from({length:25},(_,i)=>({key:'0x'+(25-i).toString(16).padStart(64,'0'),createdAtBlock:'1',data:{format:'swarm-message/1'}})) as any;
 try{
  await panel.mount(root,owner,owner,false);assert.equal(keys.length,20);assert.match(feed.innerHTML,/Older messages/);assert.doesNotMatch(feed.innerHTML,/Newer messages/);
  await (panel as any).action('older-messages');assert.equal(keys.length,5);assert.match(feed.innerHTML,/Newer messages/);assert.doesNotMatch(feed.innerHTML,/Older messages/);
 }finally{panel.dispose();globalThis.fetch=fetcher;Object.defineProperty(globalThis,'window',{value:previous,configurable:true});Object.defineProperty(globalThis,'localStorage',{value:storage,configurable:true});}
});

test('retrying the same encrypted draft resumes its saved request and other drafts stay blocked',async()=>{
 const previous=globalThis.window,storage=globalThis.localStorage;
 const key='poros.membership-write.'+owner;
 const content={title:'Saved strategy',body:'Original rules',source:'manual' as const};
 let pending:any={actor:owner,kind:'signal',requestId:crypto.randomUUID(),content};
 const originalId=pending.requestId;
 Object.defineProperty(globalThis,'window',{value:new EventTarget(),configurable:true});
 Object.defineProperty(globalThis,'localStorage',{value:{getItem:(name:string)=>name===key&&pending?JSON.stringify(pending):null},configurable:true});
 const panel=new CreatorMembershipPanel({getContext:async()=>({account:owner})} as any,{} as any);
 Object.assign(panel,{account:owner,creator:owner});
 const calls:any[]=[];
 (panel as any).write=async(action:any,recovery:boolean)=>{calls.push({action,recovery});};
 try{
  await (panel as any).publishSignal(content);
  assert.equal(calls[0].action.requestId,originalId);assert.equal(calls[0].recovery,true);
  pending={actor:owner,kind:'signal',requestId:originalId,pointer:{payloadHash:'0x'+'a'.repeat(64)},arkivAttempted:true};
  await assert.rejects((panel as any).publishSignal({...content,body:'Different rules'}),/Recover signal write/);
  assert.equal(calls.length,1);assert.equal(pending.requestId,originalId);
  pending={actor:owner,kind:'signal',requestId:originalId,pointer:{payloadHash:memberContentHash(content)},arkivAttempted:true};
  await (panel as any).publishSignal(content);assert.equal(calls.length,2);assert.equal(calls[1].recovery,true);assert.equal(calls[1].action.arkivAttempted,true);
  pending={actor:owner,kind:'signal',requestId:originalId,content,uploadUncertain:true};
  await assert.rejects((panel as any).publishSignal(content),/Retry upload/);
  assert.equal(calls.length,2);
 }finally{panel.dispose();Object.defineProperty(globalThis,'window',{value:previous,configurable:true});Object.defineProperty(globalThis,'localStorage',{value:storage,configurable:true});}
});

test('private composer mounting and successful publishing never open the signed read feed',async()=>{
 const previous=globalThis.window,storage=globalThis.localStorage;
 Object.defineProperty(globalThis,'window',{value:new EventTarget(),configurable:true});
 Object.defineProperty(globalThis,'localStorage',{value:{getItem:()=>null},configurable:true});
 const panel=new CreatorMembershipPanel({getContext:async()=>({account:owner})} as any,{} as any);let feeds=0;
 const root:any={isConnected:true,innerHTML:'',addEventListener(){},replaceChildren(){},querySelector:()=>({textContent:''})};
 panel.service.getPlan=async()=>undefined;panel.service.members=async()=>[];panel.readers.now=async()=>1000;
 (panel as any).feed=async()=>{feeds++;};(panel as any).publishSignal=async()=>{};
 try{await panel.mount(root,owner,owner,false,false);await panel.publishPost({title:'Private',body:'Rules',source:'manual'});assert.equal(feeds,0);}
 finally{panel.dispose();Object.defineProperty(globalThis,'window',{value:previous,configurable:true});Object.defineProperty(globalThis,'localStorage',{value:storage,configurable:true});}
});
