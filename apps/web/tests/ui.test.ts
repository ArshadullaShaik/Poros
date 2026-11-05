import test from 'node:test';
import assert from 'node:assert/strict';
import {threadRows,field,sortThreads} from '../src/ui.ts';
import {preview} from '../src/preview.ts';
import type {VoteSummary} from '../../../src/integrations/arkiv/community/index.ts';
import type {Hex} from 'viem';
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
