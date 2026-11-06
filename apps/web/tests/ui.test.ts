import test from 'node:test';
import assert from 'node:assert/strict';
import {threadRows,messageRows,strategyRows,field,sortThreads,communityCreation} from '../src/ui.ts';
import {publicStrategyDrag} from '../src/strategy-drag.ts';
import {strategyReference} from '../src/builder.ts';
import {preview} from '../src/preview.ts';
import type {VoteSummary} from '../../../src/integrations/arkiv/community/index.ts';
import type {Hex} from 'viem';

test('whole public cards and nested links produce references the canvas can load',()=>{
 const row=preview.events.find(row=>row.type==='thread')!;
 const html=threadRows([row],()=> 'Trader');
 assert.match(html,/<article class="thread-row" draggable="true" data-strategy-href=/);
 assert.match(html,/Prepare in builder/);
 const versionKey='0x'+'a'.repeat(64),origin='http://localhost:4325';
 assert.match(strategyRows([{rootVersionKey:versionKey,name:'Rules',creator:versionKey,category:'signal',executionChainId:8453} as any],()=> 'Trader'),/data-strategy-href="\/\?strategy=/);
 for(const [href,expected] of [[`/?strategy=${versionKey}`,{kind:'public-strategy',versionKey}],[`/?community=${row.scope}&post=${row.key}`,{kind:'public-post',communityKey:row.scope,postKey:row.key}]] as const){
   const data=new Map<string,string>();
   publicStrategyDrag({target:{closest:()=>({dataset:{strategyHref:href}})},dataTransfer:{setData:(type:string,value:string)=>data.set(type,value)}} as any,origin);
   assert.equal(data.get('text/plain'),data.get('text/uri-list'));
   assert.deepEqual(strategyReference(data.get('text/uri-list')!,origin),expected);
 }
});
test('community text and imported JSON cannot inject markup into templates',()=>{
  const row=structuredClone(preview.events.find(row=>row.type==='thread')!);
  row.data.title='<img src=x onerror=alert(1)>';row.data.body='</p><script>steal()</script>';
  const html=threadRows([row],()=>'<svg onload=alert(1)>');
  assert.doesNotMatch(html,/<script>|<img src=x|<svg onload/);assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(field('document','JSON',{area:true,value:'</textarea><script>steal()</script>'}),/<script>/);
});
test('community discussion sorts New or Top and renders signed vote controls',()=>{
  const a={...preview.events.find(row=>row.type==='thread')!,key:`0x${'a'.repeat(64)}` as Hex,createdAtBlock:'11',data:{title:'Older',body:'Body'}};
  const b={...a,key:`0x${'b'.repeat(64)}` as Hex,createdAtBlock:'12',data:{title:'Newer',body:'Body'}};
  const votes:Record<Hex,VoteSummary>={[a.key]:{score:5,up:6,down:1,viewerVote:1},[b.key]:{score:0,up:0,down:0,viewerVote:0}};
  assert.deepEqual(sortThreads([a,b],votes,'new').map(row=>row.key),[b.key,a.key]);
  assert.deepEqual(sortThreads([a,b],votes,'top').map(row=>row.key),[a.key,b.key]);
  const html=threadRows([a],()=>'<script>',false,votes,true);
  assert.match(html,/data-action="vote"/);assert.match(html,/aria-pressed="true"/);assert.match(html,/\b5\b/);
  assert.doesNotMatch(html,/<script>/);
});

test('community creation requires live mode and a wallet and explains public testnet storage', () => {
  const account = `0x${'a'.repeat(40)}` as Hex;
  const previewHtml = communityCreation(true, account, true);
  assert.match(previewHtml, /data-action="live"/);
  assert.doesNotMatch(previewHtml, /<form/);
  const disconnected = communityCreation(false, undefined, true);
  assert.match(disconnected, /Connect MetaMask/);
  assert.doesNotMatch(disconnected, /<form/);
  const unsupported = communityCreation(false, undefined, false);
  assert.match(unsupported, /Chrome with MetaMask/);
  assert.doesNotMatch(unsupported, /<form|data-action="connect"/);
  const connected = communityCreation(false, account, true);
  assert.match(connected, /data-form="community"/);
  assert.match(connected, /180 days/);
  assert.match(connected, /tGLM gas/);
  assert.match(connected, /role="alert"/);
});

test('messages, replies and threads link their verified entity to Arkiv explorer in a separate tab',()=>{
 const original=preview.events.find(row=>row.type==='thread')!;
 for(const type of ['message','reply','thread'] as const){
  const row={...original,type,source:'arkiv' as const,key:`0x${'a'.repeat(64)}` as Hex};
  const render=type==='thread'?threadRows:messageRows;
  const html=render([row],()=> 'Trader');
  assert.match(html,new RegExp(`href="https://rabdi\\.explorer\\.arkiv\\.network/entity/${row.key}"`));
  assert.match(html,/target="_blank" rel="noopener noreferrer"/);
  assert.match(html,/aria-label="View on Arkiv explorer \(opens in a new tab\)"/);
  assert.doesNotMatch(render([{...row,source:'mock'}],()=> 'Trader'),/arkiv-record-link/);
  assert.doesNotMatch(render([{...row,key:'javascript:alert(1)' as Hex}],()=> 'Trader'),/arkiv-record-link/);
 }
});

test('community messages and posts do not expose moderation controls even for an owner',()=>{
 const row={...preview.events.find(row=>row.type==='thread')!,source:'arkiv' as const};
 for(const render of [threadRows,messageRows]){
  const html=render([row],()=> 'Owner',true);
  assert.doesNotMatch(html,/data-action="(?:hide|moderate|ban|unhide)"|Hide message|Hide thread/);
  assert.match(html,/arkiv-record-link/);
 }
});
