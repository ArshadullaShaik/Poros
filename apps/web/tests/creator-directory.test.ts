import test from 'node:test';
import assert from 'node:assert/strict';
import {readCreatorDirectory,rankCreators,creatorCard,mountCreatorDirectory,type Creator,type CreatorResult} from '../src/creator-directory.ts';
const a='0x'+'a'.repeat(40),b='0x'+'b'.repeat(40),c='0x'+'c'.repeat(40);
const events={scan:async()=>[]};
const creator=(wallet=a,strategies=1):Creator=>({wallet:wallet as `0x${string}`,name:'Trader',posts:0,strategies});
const result=(wallet:string,profit:string|null,strategies=1):CreatorResult=>({creator:creator(wallet,strategies),complete:true,markets:[{marketId:'base:eth/usdc',market:'ETH / USDC',chain:'Base',currency:'USDC',realizedPnl:profit,sells:1}]});

test('profit ranking uses exact decimals, counts only completed sells, and breaks ties with strategy activity',()=>{
  assert.deepEqual(rankCreators([result(a,'1.000000000000000001'),result(b,'1.000000000000000002'),result(c,'-2')],'base:eth/usdc').map(row=>row.wallet),[b,a,c]);
  assert.deepEqual(rankCreators([result(a,'10',1),result(b,'10',3)],'base:eth/usdc').map(row=>row.wallet),[b,a]);
  const incomplete={...result(a,'999'),complete:false},unknown=result(b,null),noSells=result(c,'0');noSells.markets[0]!.sells=0;
  assert.equal(rankCreators([incomplete,unknown,noSells,{...result(a,'100'),error:'Unavailable'}],'base:eth/usdc').length,0);
  const other=result(c,'10000');other.markets[0]!.marketId='ethereum:eth/usdc';
  assert.equal(rankCreators([result(a,'1'),other],'base:eth/usdc').length,1);
  assert.throws(()=>rankCreators([result(a,'NaN')],'base:eth/usdc'));
});

test('discovery deduplicates public strategy roots and includes plans without a posting gate',async()=>{
  const calls:number[]=[];
  const data=await readCreatorDirectory({listStrategies:async({page}:any)=>{
    calls.push(page.offset);return {items:page.offset?[{rootVersionKey:'one',creator:a},{rootVersionKey:'two',creator:a}]:[{rootVersionKey:'one',creator:a}],nextOffset:page.offset?null:20,skipped:0} as any;
  }},{plans:async()=>[{actor:b,data:{priceWei:'100000000000000'}}] as any},{listThreads:async()=>[],getProfile:async({wallet})=>wallet===a?{displayName:'Alice',handle:'alice'} as any:null},events);
  assert.deepEqual(calls,[0,20]);assert.equal(data.partial,false);
  assert.equal(data.rows[0]?.strategies,2);assert.equal(data.rows[0]?.name,'Alice (@alice)');
  assert.equal(data.rows[1]?.strategies,0);assert.match(creatorCard(data.rows[1]!),/Subscribe \/ renew/);
  assert.doesNotMatch(creatorCard(data.rows[0]!),/Subscribe \/ renew/);
  assert.match(creatorCard({...creator(),name:'<script>evil</script>'}),/&lt;script&gt;/);
});

test('bounded discovery labels partial counts and refuses a non-advancing page',async()=>{
  const service={plans:async()=>[]},profiles={getProfile:async()=>null,listThreads:async()=>[]};
  const data=await readCreatorDirectory({listStrategies:async({page}:any)=>({items:[],nextOffset:page.offset+20,skipped:0}) as any},service,profiles,events);
  assert.equal(data.partial,true);
  await assert.rejects(readCreatorDirectory({listStrategies:async()=>({items:[],nextOffset:0,skipped:0}) as any},service,profiles,events),/advance/);
});

test('written post authors are discoverable but hidden posts are never counted',async()=>{
  const data=await readCreatorDirectory({listStrategies:async()=>({items:[],nextOffset:null,skipped:0}) as any},
    {plans:async()=>[]},{getProfile:async()=>null,listThreads:async()=>[{actor:a}] as any},
    {scan:async()=>[{scope:'room',actor:a},{scope:'room',actor:b}] as any});
  assert.equal(data.rows.length,1);assert.equal(data.rows[0]?.wallet,a);
  assert.equal(data.rows[0]?.posts,1);assert.equal(data.rows[0]?.strategies,0);
});

test('directory waits for an explicit profit request, then ranks verified history and aborts on disposal',async(t)=>{
  const nodes=new Map<string,any>();
  const root={innerHTML:'',querySelector:(selector:string)=>{
    if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',textContent:'',value:'base:eth/usdc',disabled:false,handlers:{},addEventListener(name:string,fn:Function){this.handlers[name]=fn;},removeEventListener(name:string){delete this.handlers[name];}});
    return nodes.get(selector);
  }};
  let calls=0,signal:AbortSignal|undefined;
  t.mock.method(globalThis,'fetch',async(_url:unknown,options:RequestInit)=>{assert.match(String(_url),/\/api\/trade-history\/report\?trader=/);calls++;signal=options.signal??undefined;return Response.json({ok:true,data:{...result(a,'5'),provenance:'arkiv'}});});
  const ui=mountCreatorDirectory(root as any,async()=>({rows:[creator()],partial:false}));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0);
  await nodes.get('[data-profit-load]').handlers.click();assert.equal(calls,1);
  assert.match(nodes.get('[data-profit-table]').innerHTML,/5 USDC/);
  ui.dispose();assert.equal(signal?.aborted,true);
});
