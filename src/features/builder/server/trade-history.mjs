import {Readable} from 'node:stream';
import {readBoundedJson} from '../ai/zero-g.ts';
import {getTradeRuntime} from './trade-runtime.ts';
import {verifyTradeProof} from '../../../integrations/arkiv/trade-proofs.ts';
import {sourceSchema,traderSchema,sourceKey} from '../../../integrations/arkiv/trade-contracts.ts';
import {buildTradeReport} from '../execution/trade-report.ts';
export function createTradeHistoryHandler({getRuntime=getTradeRuntime,now=Date.now}={}){
 const attempts=new Map();
 return async function handle(request,response){
  const json=(status,data)=>{response.setHeader('Content-Type','application/json; charset=utf-8');response.setHeader('Cache-Control','no-store');response.writeHead(status).end(JSON.stringify(data));};
  const url=new URL(request.url,'http://localhost'),action=url.pathname.split('/').at(-1);
  try{
   if(request.method==='POST'&&((request.headers.origin&&request.headers.origin!==`http://${request.headers.host}`&&request.headers.origin!==`https://${request.headers.host}`)||request.headers['sec-fetch-site']==='cross-site'))return json(403,{ok:false,error:{code:'FORBIDDEN',message:'Use the app to manage trading sources.'}});
   const runtime=getRuntime();
   if(action==='status'&&request.method==='GET'){
    const trader=url.searchParams.get('trader');if(trader)traderSchema.parse(trader);
    return json(200,{ok:true,data:{configured:Boolean(runtime),healthy:Boolean(runtime&&now()-Number(runtime.state.meta('heartbeat')??0)<120000),sources:runtime&&trader?runtime.state.sources(trader).map(s=>({source:s.binding.source,active:s.active,coverage:s.coverage,error:s.lastError})):[],pending:runtime&&trader?runtime.state.outbox().filter(j=>j.input.trader===trader).length:0,renewalHealthy:runtime?!runtime.state.meta('renewalError'):false}});
   }
   if(!runtime)return json(503,{ok:false,error:{code:'LEDGER_NOT_CONFIGURED',message:'Arkiv trade recording needs a configured funded writer and running worker.'}});
   if(action==='report'&&request.method==='GET'){
    let identity=url.searchParams.get('trader');
    if(!identity&&url.searchParams.has('wallet')){
     const wallet=url.searchParams.get('wallet');
     if(!/^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(wallet??''))throw new Error('Invalid history wallet');
     const normalized=wallet.startsWith('0x')?wallet.toLowerCase():wallet;
     const owners=[...new Set(runtime.state.sources().filter(s=>s.binding.source.wallet===normalized).map(s=>s.binding.trader))];
     if(owners.length>1)throw new Error('Ambiguous source attribution');
     identity=owners[0]??normalized;
    }
    const trader=traderSchema.parse(identity),entries=[];let afterKey;
    do{const page=await runtime.repository.list({trader,afterKey});entries.push(...page.items);afterKey=page.nextKey;if(entries.length>10000)throw new Error('HISTORY_TOO_LARGE');}while(afterKey);
    const pending=runtime.state.outbox().some(j=>j.input.trader===trader)||runtime.state.sources(trader).some(s=>Boolean(s.lastError));
    return json(200,{ok:true,data:buildTradeReport(entries,{now:now(),pending,renewalHealthy:!runtime.state.meta('renewalError')})});
   }
   if(request.method!=='POST'||!['challenge','link','unlink'].includes(action))return json(405,{ok:false,error:{code:'METHOD_NOT_ALLOWED',message:'Unsupported operation.'}});
   if(request.headers.origin!==runtime.origin)return json(403,{ok:false,error:{code:'FORBIDDEN',message:'Use the configured app origin.'}});
   if(!/^application\/json(?:\s*;.*)?$/i.test(request.headers['content-type']??''))throw new Error('INVALID_INPUT');
   const remote=request.socket?.remoteAddress??'local',last=attempts.get(remote)??{at:now(),count:0};if(now()-last.at>60000){last.at=now();last.count=0;}if(++last.count>30)throw new Error('RATE_LIMITED');attempts.set(remote,last);if(attempts.size>1000)attempts.delete(attempts.keys().next().value);
   const body=await readBoundedJson(new Response(Readable.toWeb(request)),8192,'INVALID_INPUT',AbortSignal.timeout(10000));
   if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('INVALID_INPUT');
   if(action==='challenge'){
    if(Object.keys(body).sort().join(',')!=='operation,source,trader')throw new Error('INVALID_INPUT');
    const trader=traderSchema.parse(body.trader),source=sourceSchema.parse(body.source);
    return json(200,{ok:true,data:runtime.state.challenge({trader,source,operation:body.operation,origin:runtime.origin},now())});
   }
   if(Object.keys(body).some(k=>!['nonce','signature','sourceSignature'].includes(k))||typeof body.signature!=='string'||body.signature.length>2048)throw new Error('INVALID_INPUT');
   const challenge=runtime.state.proof(body.nonce,now());if(challenge.operation!==action||challenge.origin!==runtime.origin)throw new Error('INVALID_PROOF');
   if(!await verifyTradeProof(challenge.trader,challenge.message,body.signature))throw new Error('INVALID_PROOF');
   if(challenge.source.kind==='flash'&&challenge.source.wallet!==challenge.trader&&(!body.sourceSignature||!await verifyTradeProof(challenge.source.wallet,challenge.message,body.sourceSignature)))throw new Error('INVALID_SOURCE_PROOF');
   const binding={trader:challenge.trader,source:challenge.source,linkedAt:now(),historicalFrom:null};
   await runtime.sourceAdapter.validateBinding(binding);
   runtime.state.consume(challenge.nonce,now());
   if(action==='link')runtime.state.link(binding);else runtime.state.unlink(challenge.source,challenge.trader,now());
   runtime.state.enqueue({schemaVersion:1,kind:action==='link'?'source-link':'source-unlink',trader:challenge.trader,source:challenge.source,observedAt:now(),data:action==='link'?binding:{unlinkedAt:now()}});
   return json(200,{ok:true,data:{state:'pending',message:'Source proof accepted. Arkiv publication is queued.'}});
  }catch(error){
   const code=['RATE_LIMITED','HISTORY_TOO_LARGE'].includes(error?.message)?error.message:'TRADE_HISTORY_UNAVAILABLE';
   return json(code==='RATE_LIMITED'?429:400,{ok:false,error:{code,message:code==='RATE_LIMITED'?'Too many requests. Try again shortly.':'Source verification or history retrieval could not finish. No unverifiable results are published.'}});
  }
 };
}
