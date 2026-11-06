import {readCreatorDirectory,mountCreatorDirectory} from './creator-directory.ts';
import {savePaperRun} from './performance.ts';
import {saveExecutionRun} from './order-history.ts';
import {paperPosition} from '../../../src/features/builder/demo/chart.js';
import {createPublicReadCache,browserStorage,cachedPublicLists} from './public-cache.ts';
import {compose} from './integration.ts';
import {createInjectedWallet} from './wallet.ts';
import {createCreatorMemberships,createMembershipReaders} from '../../../src/integrations/arkiv/community/index.ts';
import {createMemberContentClient} from './member-content.ts';
import {readMemberLibrary,readCommunityStrategies,readCommunityPost} from './builder-library.ts';
import { validateBuilderDocument } from './strategy-document.ts';
export { builderDocument, validateBuilderDocument } from './strategy-document.ts';
const integration=typeof window==='undefined'?{}:window.__COMMON_GROUND__;
const wallet=typeof window==='undefined'?undefined:integration?.wallet??createInjectedWallet();
const api=compose({...integration,...(wallet?{wallet}:{}),validateStrategyDocument:validateBuilderDocument});
export const publicStrategies=api.strategies;
export function mountTradeCreators(root:HTMLElement){
  return mountCreatorDirectory(root,()=>readCreatorDirectory(api.strategies,createCreatorMemberships(api.events,createMembershipReaders(integration?.accessKey)),api.community,api.events),true);
}
export const listCommunityStrategies=(input:Parameters<typeof readCommunityStrategies>[2])=>readCommunityStrategies(api.strategies,api.community,input);
export const readPublicPost=(communityKey:`0x${string}`,postKey:`0x${string}`)=>readCommunityPost(api.community,communityKey,postKey);
export const publicLists=cachedPublicLists(api.strategies,createPublicReadCache({storage:browserStorage(),onRefresh:(_key,changed)=>{if(changed&&typeof window!=='undefined')window.dispatchEvent(new Event('poros:public-data-updated'));}}));
export { MEMBER_STRATEGY_TYPE } from './member-strategy.ts';
import {readMemberStrategy as parseMemberStrategy} from './member-strategy.ts';
export async function assertMemberAccess(entry:{memberWallet?:string;expiresAt?:number|null}){
  if(entry.memberWallet&&(!wallet||(await wallet.getContext()).account.toLowerCase()!==entry.memberWallet))throw new Error('Wallet changed. Refresh your member messages.');
  if(entry.expiresAt!==undefined&&entry.expiresAt!==null&&entry.expiresAt<=Date.now())throw new Error('Membership expired. Refresh your member messages.');
}
export async function readMemberStrategy(raw:string){
  if(!wallet)throw new Error('Connect your membership wallet first.');
  const account=(await wallet.getContext()).account.toLowerCase();
  return parseMemberStrategy(raw,{wallet:account});
}
export async function readPersonalLibrary(){
  if(!wallet)throw new Error('Connect a browser wallet to read your memberships.');
  const account=(await wallet.getContext()).account.toLowerCase() as `0x${string}`;
  const readers=createMembershipReaders(integration?.accessKey);
  const result=await readMemberLibrary({account,events:api.events,service:createCreatorMemberships(api.events,readers),readers,getProfile:wallet=>api.community.getProfile({wallet}),readMessages:createMemberContentClient({wallet}).readMany});
  if((await wallet.getContext()).account.toLowerCase()!==account)throw new Error('Wallet account changed. Refresh your library.');
  return {...result,account};
}
export function subscribeLibraryWallet(listener:()=>void){return wallet?.subscribe(listener)??(()=>{});}

export function strategyReference(text: string, origin: string) {
  if (text.length > 2048) throw new Error('Drop a public strategy card.');
  const references=text.split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!line.startsWith('#'));
  if(references.length!==1)throw new Error('Drop one public strategy card.');
  const url = new URL(references[0]!, origin);
  const key = url.searchParams.get('strategy'),communityKey=url.searchParams.get('community'),postKey=url.searchParams.get('post');
  const valid=(value:string|null):value is `0x${string}`=>!!value&&/^0x[0-9a-f]{64}$/i.test(value);
  if(url.origin!==origin||url.pathname!=='/'||url.username||url.password)throw new Error('Drop a public strategy card from this application.');
  if(valid(key)&&!communityKey&&!postKey)return {kind:'public-strategy' as const,versionKey:key};
  if(!key&&valid(communityKey)&&valid(postKey))return {kind:'public-post' as const,communityKey,postKey};
  throw new Error('Drop a public strategy card.');
}

// A run stays associated with the wallet connected at its first snapshot.
const performanceOwners=new Map<string,Promise<string|undefined>>();
function ownerForRun(id:string, liveWallet?:string){
  if(!performanceOwners.has(id)){
    performanceOwners.set(id,liveWallet?Promise.resolve(liveWallet):wallet?.getContext().then(context=>context.account.toLowerCase()).catch(()=>undefined)??Promise.resolve(undefined));
    if(performanceOwners.size>100)performanceOwners.delete(performanceOwners.keys().next().value!);
  }
  return performanceOwners.get(id)!;
}
export async function recordPaperPerformance(run:import('./performance.ts').PaperRun){
  const owner=await ownerForRun(run.id);
  if(!owner || !wallet || (await wallet.getContext()).account.toLowerCase()!==owner)return;
  savePaperRun(localStorage,owner,run);
}
export async function recordExecutionSnapshot(snapshot:any, time:number){
  const owner=await ownerForRun(snapshot.id,snapshot.wallet);
  if(owner?.startsWith('0x') && (!wallet || (await wallet.getContext()).account.toLowerCase()!==owner.toLowerCase()))return;
  const save=()=>{
    saveExecutionRun(localStorage,owner,snapshot,time);
    const position=paperPosition(snapshot);
    if(position && owner?.startsWith('0x'))savePaperRun(localStorage,owner,{id:snapshot.id,pair:snapshot.pair.label,realizedPnl:position.realizedPnl,fills:snapshot.orders.length,updatedAt:time});
    window.dispatchEvent(new Event('poros:execution-updated'));
  };
  if(navigator.locks)await navigator.locks.request('poros.execution-history:'+(owner??'paper'),save);
  else save();
}
