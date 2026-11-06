import {escape as e} from './core.ts';
import type {WalletBridge} from './integration.ts';
import {sourceSchema} from '../../../src/integrations/arkiv/trade-contracts.ts';
import type {TradeSourceRef} from '../../../src/integrations/arkiv/trade-contracts.ts';
import type {TradeReport} from '../../../src/features/builder/execution/trade-report.ts';
import {connectSolanaWallet,base58Encode} from '../../../src/features/builder/demo/solana-wallet.js';
async function request(path:string,body?:unknown,signal?:AbortSignal,fetcher:typeof fetch=fetch){
 const response=await fetcher('/api/trade-history/'+path,{method:body?'POST':'GET',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{}),signal:signal??AbortSignal.timeout(30000)});
 const payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error?.message??'Trade history is unavailable');return payload.data;
}
export async function readTradeReport(trader:string,signal?:AbortSignal,fetcher:typeof fetch=fetcherDefault):Promise<TradeReport>{
 const data=await request('report?trader='+encodeURIComponent(trader),undefined,signal,fetcher);
 if(data?.provenance!=='arkiv'||typeof data.complete!=='boolean'||!Number.isSafeInteger(data.fills)||data.fills<0||!Array.isArray(data.transactions)||data.transactions.length!==data.fills||!Array.isArray(data.markets)||!Array.isArray(data.coverage))throw new Error('Unverified trade history response');
 return data;
}
const fetcherDefault:typeof fetch=(...args)=>fetch(...args);
export function mountTradeSources(root:HTMLElement,wallet:WalletBridge,trader:`0x${string}`){
 const controller=new AbortController();let disposed=false,busy=false,sources:{source:TradeSourceRef;active:boolean}[]=[];
 async function refresh(){
  const status=await request('status?trader='+encodeURIComponent(trader),undefined,controller.signal);if(disposed)return;
  sources=status.sources;
  root.innerHTML=`<h2>Verified trading history</h2><p>${!status.configured?'Trade recording is not configured yet.':status.healthy?'Recording worker is online.':'Recording worker is offline; tracked live orders cannot be submitted.'}</p><p>Linked executions become public on Arkiv, including losses. Unlinking stops new imports and retains earlier records.</p><div>${sources.map((s,i)=>`<p><code>${e(s.source.wallet)}</code> · ${e(s.source.kind)} · ${s.active?'Linked':'Historical source'} ${s.active?`<button class="button secondary" type="button" data-trade-unlink="${i}">Unlink</button>`:''}</p>`).join('')}</div>${status.configured?`<form data-trade-link><label class="field"><span>Trading source</span><select name="kind"><option value="flash">Connected EVM wallet · Flash</option><option value="solana">Solana wallet · Flash</option><option value="portfolio">Definitive portfolio</option></select></label><label class="field"><span>Portfolio ID (portfolio only)</span><input name="portfolio" maxlength="128"></label><label class="field"><span>Trading vault address (portfolio only)</span><input name="vault" maxlength="64"></label><button class="button primary" type="submit">Link and record trades</button></form>`:''}<p data-trade-message role="status">${status.pending?`${status.pending} record(s) awaiting Arkiv inclusion.`:''}</p>`;
 }
 async function manage(source:TradeSourceRef,operation:'link'|'unlink',connection?:Awaited<ReturnType<typeof connectSolanaWallet>>){
  if((await wallet.getContext()).account.toLowerCase()!==trader)throw new Error('Wallet changed. Refresh your profile.');
  const challenge=await request('challenge',{source,trader,operation},controller.signal);
  if(typeof challenge.message!=='string'||challenge.message.length>4096||!challenge.message.startsWith('Poros trade history\nOrigin: '+location.origin+'\nOperation: '+operation+'\nProfile: '+trader+'\n'))throw new Error('Invalid source ownership challenge');
  const signature=await wallet.signMessage(challenge.message,trader);
  let sourceSignature:string|undefined;
  if(source.kind==='flash'&&source.wallet!==trader){
   if(!connection||connection.address!==source.wallet)throw new Error('Connect the linked Solana wallet to prove ownership');
   const bytes=new TextEncoder().encode(challenge.message);
   const [result]=await connection.wallet.features['solana:signMessage'].signMessage({account:connection.account,message:bytes});
   if(!(result?.signature instanceof Uint8Array)||result.signature.length!==64||!(result.signedMessage instanceof Uint8Array)||result.signedMessage.length!==bytes.length||!bytes.every((b,i)=>result.signedMessage[i]===b)||!connection.wallet.accounts?.some((a:any)=>a.address===source.wallet))throw new Error('Source wallet changed or signed a different message');
   sourceSignature=base58Encode(result.signature);
  }
  if((await wallet.getContext()).account.toLowerCase()!==trader)throw new Error('Profile wallet changed.');
  await request(operation,{nonce:challenge.nonce,signature,...sourceSignature?{sourceSignature}:{}},controller.signal);await refresh();
 }
 async function run(task:()=>Promise<void>){if(busy||disposed)return;busy=true;try{await task();if(!disposed)root.querySelector('[data-trade-message]')!.textContent='Source update queued. Refresh shortly to check Arkiv recording.';}catch(error){if(!disposed){const target=root.querySelector('[data-trade-message]');if(target)target.textContent=error instanceof Error?error.message:'Source verification failed.';}}finally{busy=false;}}
 const submit=(event:Event)=>{
  const form=event.target as HTMLFormElement;if(!form.matches('[data-trade-link]'))return;event.preventDefault();event.stopPropagation();
  void run(async()=>{const values=new FormData(form),kind=values.get('kind');let connection;
   if(kind==='solana')connection=await connectSolanaWallet();
   const vault=String(values.get('vault')).trim(),evmVault=vault.startsWith('0x');
   const source=sourceSchema.parse(kind==='portfolio'?{kind:'portfolio',sourceId:String(values.get('portfolio')).trim(),wallet:evmVault?vault.toLowerCase():vault,chainFamily:evmVault?'evm':'solana'}:{kind:'flash',sourceId:'flash:'+(connection?.address??trader),wallet:connection?.address??trader,chainFamily:connection?'solana':'evm'});
   await manage(source,'link',connection);
  });
 };
 const click=(event:Event)=>{const button=(event.target as Element).closest<HTMLElement>('[data-trade-unlink]');if(!button)return;void run(async()=>{const source=sources[Number(button.dataset.tradeUnlink)]?.source;if(!source)throw new Error('Refresh sources');await manage(source,'unlink',source.chainFamily==='solana'&&source.kind==='flash'?await connectSolanaWallet():undefined);});};
 root.addEventListener('submit',submit);root.addEventListener('click',click);
 void refresh().catch(()=>{if(!disposed)root.textContent='Trade recording status could not load. Refresh to try again.';});
 return {dispose(){disposed=true;controller.abort();root.removeEventListener('submit',submit);root.removeEventListener('click',click);}};
}
