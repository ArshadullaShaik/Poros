import {randomUUID} from 'node:crypto';
import {buildTradeRecord,sourceKey} from '../../../integrations/arkiv/trade-contracts.ts';
import type {LedgerInput,LedgerCoverage,SourceBinding,LedgerEntry,VerifiedOrder} from '../../../integrations/arkiv/trade-contracts.ts';
import type {TradeRepository} from '../../../integrations/arkiv/trades.ts';
import type {TradeSource} from '../execution/trade-source.ts';
import type {TradeState,StoredSource} from './trade-state.ts';
export function createTradeLedger({state,repository,sourceAdapter,now=Date.now}:{state:TradeState;repository:TradeRepository;sourceAdapter:TradeSource;now?:()=>number}){
 const worker=randomUUID();
 function queue(source:StoredSource,order:VerifiedOrder){
  const common={schemaVersion:1 as const,trader:source.binding.trader,source:source.binding.source,observedAt:now()};
  const {orderId,status,market,chain,currency,side}=order;
  state.enqueue({...common,kind:'order',data:{orderId,status,...market?{market}:{},...chain?{chain}:{},...currency?{currency}:{},...side?{side}:{}}});
  if(['ORDER_STATUS_PENDING','ORDER_STATUS_ACCEPTED','ORDER_STATUS_PARTIALLY_FILLED'].includes(status))state.trackOrder({source:source.binding.source,trader:source.binding.trader,runId:'source-discovery',actionId:orderId,quoteId:'provider-observed',orderId,createdAt:now()});
  for(const prior of state.receipts().filter((r):r is LedgerEntry&{kind:'fill'}=>r.kind==='fill'&&r.data.orderId===order.orderId&&sourceKey(r.source)===source.id)){
   if(!order.fills.some(f=>f.fillId===prior.data.fillId)){
    state.enqueue({...common,kind:'dispute',data:{identity:prior.identity,evidenceHashes:[prior.recordHash,order.evidenceHash]}});state.conflict(prior.identity);
   }
  }
  for(const fill of order.fills){try{state.enqueue({...common,kind:'fill',data:fill});}catch(error){
   const input={...common,kind:'fill' as const,data:fill},record=buildTradeRecord(input);
   const prior=state.outbox().find(j=>j.identity===record.identity)?.input??state.receipts().find(j=>j.identity===record.identity);
   if(!prior)throw error;
   const old=prior as LedgerInput;const oldRecord=buildTradeRecord({schemaVersion:1,kind:old.kind,trader:old.trader,source:old.source,observedAt:old.observedAt,data:old.data} as LedgerInput);
   state.enqueue({...common,kind:'dispute',data:{identity:record.identity,evidenceHashes:[oldRecord.recordHash,record.recordHash]}});state.conflict(record.identity);
  }}
 }
 async function flush(signal:AbortSignal){
  for(const job of state.outbox()){
   signal.throwIfAborted();if(!state.lease(worker,now()))throw new Error('Worker lease lost');
   if(job.state==='conflict')continue;
   const expected=buildTradeRecord(job.input),found=await repository.find(expected.identity);
   if(found.length){
    if(found.some(e=>e.recordHash!==expected.recordHash)){state.conflict(job.identity);state.enqueue({schemaVersion:1,kind:'dispute',trader:job.input.trader,source:job.input.source,observedAt:now(),data:{identity:expected.identity,evidenceHashes:[expected.recordHash,found.find(e=>e.recordHash!==expected.recordHash)!.recordHash]}});}
    else state.confirm(job.identity,found[0]!);
    continue;
   }
   // A lost submission response is reconciled by identity; never blindly create again.
   if(job.state==='uncertain')continue;
   await repository.ready?.();
   state.markAttempt(job.identity,now());
   try{const entry=await repository.append(job.input);if(entry.recordHash!==expected.recordHash)throw new Error('Read-back mismatch');state.confirm(job.identity,entry);}
   catch{state.meta('writeError','Arkiv inclusion uncertain; checking before retrying');}
  }
 }
 function hasPending(source:StoredSource){return state.outbox().some(job=>sourceKey(job.input.source)===source.id);}
 async function syncSource(id:string,signal:AbortSignal){
  const source=state.sources().find(s=>s.id===id);if(!source)throw new Error('Unknown source');
  try{
   await sourceAdapter.validateBinding(source.binding);
   state.enqueue({schemaVersion:1,kind:'source-link',trader:source.binding.trader,source:source.binding.source,observedAt:source.binding.linkedAt,data:source.binding});
   const page=await sourceAdapter.page(source.binding.source,source.cursor,signal);
   const seenKey='cursors:'+id,seen=source.cursor?JSON.parse(state.meta(seenKey)??'[]') as string[]:[];
   if(page.nextCursor&&seen.includes(page.nextCursor))throw new Error('Source pagination loop');
   if(page.nextCursor)seen.push(page.nextCursor);state.meta(seenKey,JSON.stringify(seen));
   for(const order of page.orders)queue(source,order);
   await flush(signal);
   const previous=source.cursor?source.coverage?.from??null:null;
   const times=page.orders.flatMap(o=>o.fills.map(f=>f.filledAt));if(previous)times.push(previous);
   const pending=hasPending(source);
   const through=source.cursor?Math.min(source.coverage?.through??page.observedAt,page.observedAt):page.observedAt;
   const coverage:LedgerCoverage={from:times.length?Math.min(...times):null,through,lastSyncedAt:now(),sourceExhausted:page.nextCursor===null,gaps:pending?['Trade records are awaiting verified Arkiv inclusion']:[],disputed:state.outbox().some(j=>j.state==='conflict'&&sourceKey(j.input.source)===id),renewalHealthy:!state.meta('renewalError')};
   if(!pending){state.enqueue({schemaVersion:1,kind:'coverage',trader:source.binding.trader,source:source.binding.source,observedAt:now(),data:coverage});await flush(signal);}
   state.checkpoint(id,coverage,page.nextCursor,page.nextCursor?now():now()+30000,pending?'Recording delayed':null);state.meta('failures:'+id,'0');
  }catch(error){const attempts=Number(state.meta('failures:'+id)??0)+1;state.meta('failures:'+id,String(attempts));const backoff=Math.min(300000,10000*2**Math.min(attempts,5));const retryAt=error&&typeof error==='object'&&'retryAt'in error?Number(error.retryAt):0;state.checkpoint(id,source.coverage,source.cursor,Math.max(now()+backoff,Number.isFinite(retryAt)?retryAt:0),'Source verification or synchronization unavailable');}
 }
 async function reconcileOrder(source:StoredSource,orderId:string,signal:AbortSignal){
  await sourceAdapter.validateBinding(source.binding);queue(source,await sourceAdapter.order(source.binding.source,orderId,signal));await flush(signal);
 }
 async function renewDue(signal:AbortSignal){
  try{
   for(const receipt of state.receipts()){signal.throwIfAborted();const current=await repository.read(receipt.entityKey);if(!current||current.recordHash!==receipt.recordHash)throw new Error('Previously confirmed entity is missing');state.confirm(receipt.identity,current);}
   for(const entry of await repository.due?.()??[]){signal.throwIfAborted();state.confirm(entry.identity,await repository.renew(entry.entityKey));}
   state.meta('renewalError','');state.meta('lastRenewed',String(now()));}
  catch{state.meta('renewalError','Record renewal failed; history may expire');}
 }
 return {syncSource,reconcileOrder,renewDue,
  trackSubmission(input:{wallet:string;chainFamily:'evm'|'solana';runId:string;actionId:string;quoteId:string;orderId?:string;createdAt:number}){
   const wallet=input.chainFamily==='evm'?input.wallet.toLowerCase():input.wallet;
   const source=state.sources().find(s=>s.active&&s.binding.source.kind==='flash'&&s.binding.source.wallet===wallet);
   if(!source)throw new Error('This wallet needs a verified Flash source registration before trading');
   if(source.lastError)throw new Error('This source has a recording delay. Recording must resume before another tracked trade is submitted.');
   if(now()-Number(state.meta('heartbeat')??0)>120000)throw new Error('Trade recording worker is offline');
   return state.trackOrder({source:source.binding.source,trader:source.binding.trader,runId:input.runId,actionId:input.actionId,quoteId:input.quoteId,...input.orderId?{orderId:input.orderId}:{},createdAt:input.createdAt});
  },
  async runOnce(signal:AbortSignal){
   if(!state.lease(worker,now()))return;
   const heartbeat=setInterval(()=>{if(state.lease(worker,now()))state.meta('heartbeat',String(now()));},20000);heartbeat.unref();
   try{
    await flush(signal);
    for(const source of state.sources()){
     signal.throwIfAborted();
     if(source.active&&source.nextAt<=now())await syncSource(source.id,signal);
     if((source.active&&!state.sources().find(s=>s.id===source.id)?.lastError)||(!source.active&&source.nextAt<=now())){let failed=false;for(const intent of state.intents().filter(i=>sourceKey(i.source)===source.id&&i.orderId)){
      const terminal=state.receipts().some(r=>r.kind==='order'&&sourceKey(r.source)===source.id&&r.data.orderId===intent.orderId&&['ORDER_STATUS_FILLED','ORDER_STATUS_CANCELLED','ORDER_STATUS_REJECTED','ORDER_STATUS_TERMINATED'].includes(r.data.status));if(terminal)continue;
      try{await reconcileOrder(source,intent.orderId,signal);}catch{failed=true;state.checkpoint(source.id,source.coverage,source.cursor,now()+60000,'Submitted order reconciliation delayed');}
     }if(!source.active&&!failed)state.checkpoint(source.id,source.coverage,source.cursor,now()+30000,null);}
    }
    if(now()-Number(state.meta('lastRenewed')??'0')>86400000)await renewDue(signal);
    state.meta('heartbeat',String(now()));
   }finally{clearInterval(heartbeat);state.release(worker);}
  },
  trackOrder(input:Parameters<TradeState['trackOrder']>[0]){
   const registered=state.sources().find(s=>s.active&&sourceKey(input.source)===s.id&&s.binding.trader===input.trader);
   if(!registered)throw new Error('Link this trading source before submitting a tracked trade');
   const heartbeat=Number(state.meta('heartbeat')??0);if(now()-heartbeat>120000)throw new Error('Trade recording worker is offline');
   return state.trackOrder(input);
  },
  recordingState(intentId:string){
   const intent=state.intents().find(i=>i.id===intentId);if(!intent)return {state:'incomplete' as const,message:'No durable submission record'};
   const recorded=state.receipts().find(r=>r.kind==='order'&&r.data.orderId===intent.orderId&&sourceKey(r.source)===sourceKey(intent.source));
   return recorded?{state:'recorded' as const,orderId:intent.orderId,entityKey:recorded.entityKey,message:'Order state recorded; fills are reconciled separately'}:{state:'pending' as const,orderId:intent.orderId??undefined,message:'Awaiting provider evidence and Arkiv inclusion'};
  },
 };
}
