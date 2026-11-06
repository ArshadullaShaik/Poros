import {address,entityKey,requestId} from '../../../integrations/arkiv/codec.ts';
import {membershipPaymentData,planChain,relayRequestId,RABDI_PAYMENT_CHAIN} from '../../../integrations/arkiv/community/membership-intent.ts';
import {verifyMembershipPayment} from '../../../integrations/arkiv/community/sepolia.ts';
import type {EventInput} from '../../../integrations/arkiv/community/contracts.ts';
import {memberFailure} from './member-content-state.ts';
import type {getMemberContentRuntime} from './member-content.ts';
import {createMembershipWriter} from '../../../integrations/arkiv/community/relay-writer.ts';
type Runtime=NonNullable<ReturnType<typeof getMemberContentRuntime>>;
type Hex=EventInput['actor'];
export function publicRelayJob(job:any){return job?{phase:job.phase,...job.result?{result:job.result}:{},...(job.error?{error:job.error}:{})}:null;}
export function relayReady(runtime:Runtime){if(!process.env.MEMBERSHIP_RELAY_PRIVATE_KEY||!runtime.relayActor||!runtime.state.healthy(Date.now(),runtime.relayActor))memberFailure('RELAY_UNAVAILABLE');}
export async function checkRelayPurchase(runtime:Runtime,input:any){
 const buyer=address(input.buyer),creator=address(input.creator),planKey=entityKey(input.planKey),hash=entityKey(input.hash);requestId(input.requestId);
 const plan=await runtime.memberships.readPlan(planKey);
 if(plan.actor!==creator||plan.data.priceWei!==input.priceWei||planChain(plan)!==RABDI_PAYMENT_CHAIN)memberFailure('INVALID_INPUT');
 const payment={buyer,creator,planKey,priceWei:input.priceWei,requestId:input.requestId};
 const paidAt=await verifyMembershipPayment(runtime.readers.rabdiPayments,{...payment,transactionHash:hash,chainId:RABDI_PAYMENT_CHAIN,input:membershipPaymentData(payment)});
 if(paidAt<await runtime.readers.blockTimestamp(BigInt(plan.createdAtBlock)))memberFailure('INVALID_INPUT');
 const evidence=await runtime.memberships.renewalEvidence(creator,buyer,await runtime.readers.now());
 await runtime.readers.assertRetention(await runtime.memberships.retentionEvidence([plan,...evidence.records]),Math.max(paidAt+30*86400000,evidence.expiresAt));
 return {...payment,hash};
}
export function createRelayWorker(runtime:Runtime,key:Hex,makeWriter= createMembershipWriter){
 let active:any;
 const owner=crypto.randomUUID();
 const writer=makeWriter(key,process.env.ARKIV_ACCESS_KEY,(raw,hash)=>{
  if(!active)throw new Error('No active relay job');
  runtime.state.signedJob(owner,Date.now(),active.kind,active.owner,active.id,raw,hash);
 });
 let recovered=false;
 return async function tick(){
  if(!runtime.state.lease(owner,Date.now()))return;
  if(!recovered){for(const job of runtime.state.jobs())if(job.kind==='publish')runtime.state.recoverUploads(job.owner,job.id);recovered=true;}
  if(await writer.client.getChainId()!==RABDI_PAYMENT_CHAIN)throw new Error('Wrong relay chain');
  const funded=await writer.client.getBalance({address:writer.address})>0n;
  const storageReady=await runtime.service.assertUploadReady().then(()=>true,()=>false);
  if(funded&&storageReady)runtime.state.heartbeat(Date.now(),writer.address);
  // Keep the lease alive during SDK receipt polling; a second process must never sign a competing nonce.
  const timer=setInterval(()=>{runtime.state.renewLease(owner,Date.now());},10000);
  try{
   for(const initial of runtime.state.jobs().filter(job=>job.raw||job.error!=='UPLOAD_UNCERTAIN'||job.payload.retryUncertain).sort((a,b)=>Number(!!b.raw)-Number(!!a.raw)||(a.attemptedAt??0)-(b.attemptedAt??0)).slice(0,10)){
    active=initial;
    const update=(patch:Record<string,unknown>)=>{if(!runtime.state.renewLease(owner,Date.now()))memberFailure('RELAY_UNAVAILABLE');return runtime.state.updateJob(active.kind,active.owner,active.id,patch);};
    try{
     update({attemptedAt:Date.now()});
     const id=relayRequestId(active.kind,active.owner,active.id);
     const matches=await writer.events.scan({actor:writer.address,requestId:id});
     if(matches.length>1)memberFailure('PUBLICATION_CONFLICT');
     if(matches[0]){update({phase:'done',result:matches[0],error:null});continue;}
     if(active.raw){
      let receipt;
      try{receipt=await writer.client.getTransactionReceipt({hash:active.hash});}catch(error){if(!/NotFound/.test((error as Error).name))throw error;}
      if(!receipt){await writer.client.sendRawTransaction({serializedTransaction:active.raw}).catch(()=>{});break;}
      const [head,block]=await Promise.all([writer.client.getBlockNumber(),writer.client.getBlock({blockNumber:receipt.blockNumber})]);
      if(block.hash!==receipt.blockHash||head<receipt.blockNumber+1n)break;
      if(receipt.status==='success')break; // Indexing may lag; never sign a replacement for an included transaction.
      update({raw:null,hash:null,phase:'queued'});active={...active,raw:null,hash:null};
     }
     if(!funded)break;
     let event:EventInput;
     if(active.kind==='purchase'){
      const payment=await checkRelayPurchase(runtime,active.payload);
      event={actor:writer.address,type:'subscription-relay',subject:payment.buyer,scope:payment.creator,requestId:id,data:{planKey:payment.planKey,transactionHash:payment.hash,purchaseId:payment.requestId}};
     }else{
      if(!storageReady)continue;
      const {content,authorization,retryUncertain}=active.payload;
      if(JSON.parse(authorization.message).relayActor!==writer.address)memberFailure('RELAY_UNAVAILABLE');
      if(retryUncertain)update({payload:{...active.payload,retryUncertain:false}});
      const pointer=await runtime.service.upload({creator:active.owner,publicationId:active.id,content,retryUncertain});
      event={actor:writer.address,type:'private-signal-relay',subject:active.owner,scope:'global',requestId:id,data:{...pointer,creator:active.owner,authorization}};
     }
     const result=await writer.events.append(event);update({phase:'done',result,error:null});
    }catch(error){const job=update({error:(error as any).code??'NETWORK_UNAVAILABLE'});if(job.raw)break;}
    finally{active=undefined;}
   }
  }finally{clearInterval(timer);}
 };
}
