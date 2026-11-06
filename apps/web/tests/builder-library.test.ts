import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readMemberLibrary,readCommunityStrategies,readCommunityPost} from '../src/builder-library.ts';
import {createEncryptionIdentity,encryptSignal,sealContentKey} from '../src/creator-crypto.ts';
const account='0x1111111111111111111111111111111111111111',creator='0x2222222222222222222222222222222222222222';

test('community library merges visible shared versions with original publications and paginates without duplicates',async()=>{
 const communityKey=('0x'+'1'.repeat(64)) as `0x${string}`,shared=('0x'+'2'.repeat(64)) as `0x${string}`,root=('0x'+'3'.repeat(64)) as `0x${string}`;
 const community:any={listThreads:async()=>[{data:{title:'Old share',strategyVersionKey:shared}},{data:{title:'Latest share',strategyVersionKey:shared}}]};
 const strategies:any={listStrategies:async({communityKey:key,page}:any)=>{assert.equal(key,communityKey);const all=[{name:'Original',rootVersionKey:root,communityKey},{name:'Duplicate',rootVersionKey:shared,communityKey}];return {items:all.slice(page.offset,page.offset+page.limit),nextOffset:page.offset+page.limit<all.length?page.offset+page.limit:null};}};
 const first=await readCommunityStrategies(strategies,community,{communityKey,page:{limit:1}});assert.equal(first.items[0]!.rootVersionKey,shared);assert.equal(first.items[0]!.name,'Latest share');
 const second=await readCommunityStrategies(strategies,community,{communityKey,page:{limit:1,offset:first.nextOffset!}});assert.equal(second.items[0]!.rootVersionKey,root);
 const third=await readCommunityStrategies(strategies,community,{communityKey,page:{limit:1,offset:second.nextOffset!}});assert.deepEqual(third.items,[]);assert.equal(third.nextOffset,null);
 community.listThreads=async()=>{throw new Error('Community read failed');};await assert.rejects(readCommunityStrategies(strategies,community,{communityKey}),/Community read failed/);
 await assert.rejects(readCommunityStrategies(strategies,community,{communityKey,page:{offset:-1}}),/Invalid community page/);
});

test('written community posts are draggable candidates and are rechecked for visibility before interpretation',async()=>{
 const communityKey=('0x'+'1'.repeat(64)) as `0x${string}`,postKey=('0x'+'2'.repeat(64)) as `0x${string}`;
 let visible=true;
 const community:any={listThreads:async()=>visible?[{key:postKey,data:{title:'testing u',body:'buy eth at 2109 $ and sell at 3000$'}}]:[]};
 const strategies:any={listStrategies:async()=>({items:[],nextOffset:null})};
 const page=await readCommunityStrategies(strategies,community,{communityKey});assert.deepEqual(page.items,[{name:'testing u',postKey,communityKey}]);
 const entry=await readCommunityPost(community,communityKey,postKey);assert.equal(entry.text,'buy eth at 2109 $ and sell at 3000$');assert.equal(entry.versionId,postKey);
 visible=false;await assert.rejects(readCommunityPost(community,communityKey,postKey),/no longer available/);
});
test('personal library uses verified active memberships and decrypts only envelopes for the current key',async()=>{
 const identity=await createEncryptionIdentity(account),now=Date.now(),context=creator+':publication';
 const encrypted=await encryptSignal({title:'Creator price rules',body:'Buy $20 of WETH using USDC on Base between $2000 and $2100 USD.'},context);
 const box=await sealContentKey(encrypted.key,identity.identity.publicKey,context+':'+account);
 let signals=0,active=true,delivered=true,time=now;
 const options:any={account,events:{scan:async(input:any)=>{assert.equal(input.actor,account);return [{subject:creator},{subject:creator}];}},readers:{now:async()=>time},getProfile:async()=>({displayName:'Creator'}),service:{members:async()=>[{wallet:account,expiresAt:active?now+100000:now-1}],getKey:async()=>({key:'key',data:identity.identity}),signals:async()=>{signals++;return [{key:'0x'+'a'.repeat(64),actor:creator,requestId:'publication',data:encrypted}];},getEnvelope:async()=>delivered?{data:{keyRecord:'key',box}}:undefined}};
 const locked=await readMemberLibrary(options);assert.equal(locked.creators.length,1);assert.equal(locked.locked,true);assert.equal(signals,0);
 const unlocked=await readMemberLibrary({...options,recoveryCode:identity.recoveryCode});assert.equal(unlocked.entries[0]!.text,'Buy $20 of WETH using USDC on Base between $2000 and $2100 USD.');assert.equal(unlocked.locked,false);
 await assert.rejects(readMemberLibrary({...options,recoveryCode:'wrong-code'}));
 delivered=false;assert.equal((await readMemberLibrary({...options,recoveryCode:identity.recoveryCode})).entries.length,0);
 active=false;assert.equal((await readMemberLibrary(options)).creators.length,0);
 active=true;let reads=0;options.readers.now=async()=>++reads===1?now:now+100001;await assert.rejects(readMemberLibrary({...options,recoveryCode:identity.recoveryCode}),/expired/);
});
