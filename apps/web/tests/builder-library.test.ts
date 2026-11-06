import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readMemberLibrary,readCommunityStrategies,readCommunityPost} from '../src/builder-library.ts';
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
test('personal library uses verified active memberships and loads member signals through authenticated retrieval',async()=>{
  const now=Date.now();
  let active=true;
  const signalData={title:'Creator price rules',body:'Buy $20 of WETH using USDC on Base between $2000 and $2100 USD.',source:'manual' as const};
  const options:any={
    account,
    events:{scan:async()=>[{subject:creator},{subject:creator}]},
    readers:{now:async()=>now},
    getProfile:async()=>({displayName:'Creator'}),
    readMessages:async(keys:string[])=>keys.map(signalKey=>({signalKey,content:signalData,expiresAt:now+100000})),
    service:{
      subscriptions:async()=>[{creator},{creator}],
      canReadSignal:async()=>true,
      members:async()=>[{wallet:account,expiresAt:active?now+100000:now-1}],
      signals:async()=>[{key:'0x'+'a'.repeat(64),actor:creator,requestId:'publication',createdAtBlock:'0',data:{format:"swarm-message/1"}}],
    },
  };
  const result=await readMemberLibrary(options);
  assert.equal(result.creators.length,1);
  assert.equal(result.entries.length,1);
  assert.equal(result.entries[0]!.text,'Buy $20 of WETH using USDC on Base between $2000 and $2100 USD.');
  active=false;
  assert.equal((await readMemberLibrary(options)).creators.length,0);
  active=true;
  let reads=0;
  options.readers.now=async()=>++reads===1?now:now+100001;
  await assert.rejects(readMemberLibrary(options),/expired/);
});

test('more than 20 member messages keeps the newest 20 available',async()=>{
 const expiresAt=Date.now()+100000;
 const result=await readMemberLibrary({account,events:{scan:async()=>[{subject:creator}] as any},readers:{now:async()=>Date.now()},getProfile:async()=>({displayName:'Creator'}),
 service:{subscriptions:async()=>[{creator}],members:async()=>[{wallet:account,expiresAt}],canReadSignal:async()=>true,signals:async()=>Array.from({length:25},(_,i)=>({key:('0x'+(i+1).toString(16).padStart(64,'0')),createdAtBlock:String(i+1),data:{format:'swarm-message/1'}}))} as any,
 readMessages:async keys=>keys.map(signalKey=>({signalKey,content:{title:signalKey,body:'Rules',source:'manual'},expiresAt}))});
 assert.equal(result.entries.length,20);assert.equal(result.entries[0]!.versionId,'0x'+(25).toString(16).padStart(64,'0'));
});
