import {checkRelayPurchase,relayReady,publicRelayJob} from './membership-relay.ts';
import {Readable} from 'node:stream';
import {readBoundedJson} from '../ai/zero-g.ts';
import {canonical,address,entityKey,requestId} from '../../../integrations/arkiv/codec.ts';
import {memberContentHash} from '../../../integrations/arkiv/community/member-content.ts';
import {verifyTradeProof} from '../../../integrations/arkiv/trade-proofs.ts';
import {checkedMemberContent,getMemberContentRuntime} from './member-content.ts';
import {memberFailure} from './member-content-state.ts';
const messages={
 RELAY_UNAVAILABLE:[503,'Automatic membership processing is unavailable. The app operator must start and fund the membership worker on Rabdi.'],
 PAYMENT_UNVERIFIED:[409,'Waiting for two payment confirmations. Your original payment is saved; check activation shortly.'],
 SWARM_NOT_CONFIGURED:[503,'Member messages are not configured yet.'],
 SWARM_UNAVAILABLE:[503,'Message storage is unavailable. Please try again.'],
 CONTENT_UNAVAILABLE:[503,'This message could not be verified or retrieved.'],
 MEMBERSHIP_EXPIRED:[403,'An eligible active membership is required to open this message.'],
 LEGACY_MESSAGE:[409,'This older encrypted message requires the previous recovery flow.'],
 UPLOAD_UNCERTAIN:[409,'The upload could not be confirmed. Retry only if you accept another storage upload.'],
 UPLOAD_BUSY:[409,'This message is already uploading. Try again shortly.'],
 PUBLICATION_CONFLICT:[409,'The original message changed. Recover the original publication first.'],
 INVALID_PROOF:[401,'Confirm your wallet to open member messages.'],
 INVALID_INPUT:[400,'Check the message and try again.'],
 RATE_LIMITED:[429,'Too many requests. Try again shortly.'],
 FORBIDDEN:[403,'Open messages from the configured application.'],
};
function keys(value,expected){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==expected.split(',').sort().join(','))memberFailure('INVALID_INPUT');}
/** @param {{getRuntime?:()=>any,now?:()=>number}} options */
export function createMemberContentHandler({getRuntime=getMemberContentRuntime,now=Date.now}={}){
 const limits=new Map();
 function limit(id,max){const time=now();for(const [key,row]of limits)if(time-row.at>=60000)limits.delete(key);let row=limits.get(id);if(!row){if(limits.size>=2000)memberFailure('RATE_LIMITED');row={at:time,n:0};limits.set(id,row);}if(++row.n>max)memberFailure('RATE_LIMITED');}
 return async(request,response)=>{
  const json=(status,data)=>{response.setHeader('Content-Type','application/json; charset=utf-8');response.setHeader('Cache-Control','no-store');response.writeHead(status).end(JSON.stringify(data));};
  try{
   const runtime=getRuntime();if(!runtime)memberFailure('SWARM_NOT_CONFIGURED');
   const configured=new URL(runtime.origin);
   if(request.headers.origin!==runtime.origin||request.headers.host!==configured.host||request.headers['sec-fetch-site']==='cross-site')memberFailure('FORBIDDEN');
   const action=new URL(request.url,runtime.origin).pathname.split('/').at(-1);
   if(request.method!=='POST'||!['challenge','upload','read','publish','activate','status'].includes(action)){response.setHeader('Allow','POST');return json(405,{ok:false,error:{code:'METHOD_NOT_ALLOWED',message:'Send a POST request.'}});}
   if(!/^application\/json(?:\s*;.*)?$/i.test(request.headers['content-type']??''))return json(415,{ok:false,error:{code:'INVALID_INPUT',message:'Send application/json.'}});
   if(Number(request.headers['content-length'])>65536)return json(413,{ok:false,error:{code:'INVALID_INPUT',message:'Message request is too large.'}});
   limit('ip:'+(request.porosClientIp??request.socket?.remoteAddress??'unknown'),120);
   const body=await readBoundedJson(new Response(Readable.toWeb(request)),65536,'INVALID_INPUT',AbortSignal.timeout(10000));
   if(action==='status'){
    if(body.ready===true){keys(body,'ready');relayReady(runtime);return json(200,{ok:true,data:{ready:true}});}
    keys(body,'kind,owner,id');if(!['publish','purchase'].includes(body.kind))memberFailure('INVALID_INPUT');address(body.owner);requestId(body.id);
    return json(200,{ok:true,data:publicRelayJob(runtime.state.job(body.kind,body.owner,body.id))});
   }
   if(action==='activate'){
    keys(body,'buyer,creator,planKey,priceWei,requestId,hash');relayReady(runtime);
    const payment=await checkRelayPurchase(runtime,body);
    const job=runtime.state.enqueue({kind:'purchase',owner:payment.buyer,id:payment.requestId,payload:payment});
    return json(200,{ok:true,data:publicRelayJob(job)});
   }
   if(action==='challenge'){
    limit('challenge:'+(request.porosClientIp??request.socket?.remoteAddress??'unknown'),30);
    keys(body,'wallet,operation,target');const wallet=address(body.wallet);if(!['upload','read','publish'].includes(body.operation))memberFailure('INVALID_INPUT');
    if(body.operation==='read'){
     if(Object.hasOwn(body.target??{},'signalKeys')){keys(body.target,'signalKeys');if(!Array.isArray(body.target.signalKeys)||!body.target.signalKeys.length||body.target.signalKeys.length>20||new Set(body.target.signalKeys).size!==body.target.signalKeys.length)memberFailure('INVALID_INPUT');body.target.signalKeys.forEach(entityKey);}
     else{keys(body.target,'signalKey');entityKey(body.target.signalKey);}
    }
    else{keys(body.target,'publicationId,payloadHash,retryUncertain');requestId(body.target.publicationId);entityKey(body.target.payloadHash);if(typeof body.target.retryUncertain!=='boolean')memberFailure('INVALID_INPUT');}
    if(body.operation==='publish')relayReady(runtime);
    return json(200,{ok:true,data:runtime.state.challenge({wallet,operation:body.operation,target:body.target,origin:runtime.origin,...body.operation==='publish'?{chainId:7794095,relayActor:runtime.relayActor,purpose:'Publish this exact encrypted strategy to my members on Arkiv Rabdi.'}:{}},now())});
   }
   keys(body,['upload','publish'].includes(action)?'nonce,signature,content':'nonce,signature');
   if(typeof body.nonce!=='string'||body.nonce.length>64||typeof body.signature!=='string'||body.signature.length>2048)memberFailure('INVALID_PROOF');
   const proof=runtime.state.proof(body.nonce,now());
   if(proof.origin!==runtime.origin||proof.operation!==action||!await verifyTradeProof(proof.wallet,proof.message,body.signature))memberFailure('INVALID_PROOF');
   const content=['upload','publish'].includes(action)?checkedMemberContent(body.content):undefined;
   if(content&&memberContentHash(content)!==proof.target.payloadHash)memberFailure('INVALID_PROOF');
   if(action==='publish')relayReady(runtime);
   runtime.state.consume(body.nonce,now());limit(action+':'+proof.wallet,action==='read'?60:10);
   if(action==='publish'){
    const input={kind:'publish',owner:proof.wallet,id:proof.target.publicationId,payload:{content,authorization:{message:proof.message,signature:body.signature},retryUncertain:proof.target.retryUncertain}};
    const prior=runtime.state.job(input.kind,input.owner,input.id);
    let job;
    if(prior&&proof.target.retryUncertain&&prior.error==='UPLOAD_UNCERTAIN'&&!prior.raw&&canonical(prior.payload.content)===canonical(content))job=runtime.state.updateJob(input.kind,input.owner,input.id,{payload:input.payload,error:null});
    else job=runtime.state.enqueue(input);
    return json(200,{ok:true,data:publicRelayJob(job)});
   }
   let data;
   if(action==='read'&&proof.target.signalKeys){
    const messages=[];
    for(let index=0;index<proof.target.signalKeys.length;index+=4){messages.push(...await Promise.all(proof.target.signalKeys.slice(index,index+4).map(async signalKey=>({signalKey,...await runtime.service.read({wallet:proof.wallet,signalKey})}))));}
    data={messages};
   }else data=action==='read'?await runtime.service.read({wallet:proof.wallet,signalKey:proof.target.signalKey}):await runtime.service.upload({creator:proof.wallet,publicationId:proof.target.publicationId,content,retryUncertain:proof.target.retryUncertain});
   return json(200,{ok:true,data});
  }catch(error){const code=Object.hasOwn(messages,error?.code)?error.code:'CONTENT_UNAVAILABLE';const [status,message]=messages[code];return json(status,{ok:false,error:{code,message}});}
 };
}
