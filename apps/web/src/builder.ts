import {savePaperRun} from './performance.ts';
import {createPublicReadCache,browserStorage,cachedPublicLists} from './public-cache.ts';
import {compose} from './integration.ts';
import {createInjectedWallet} from './wallet.ts';
import {createCreatorMemberships,createMembershipReaders} from '../../../src/integrations/arkiv/community/index.ts';
import {readMemberLibrary} from './builder-library.ts';
import { validateBuilderDocument } from './strategy-document.ts';
import { mountMembershipWorkspace } from './membership-workspace.ts';
import type { memberStrategy } from './member-strategy.ts';
export { builderDocument, validateBuilderDocument } from './strategy-document.ts';
const integration=typeof window==='undefined'?{}:window.__COMMON_GROUND__;
const wallet=typeof window==='undefined'?undefined:integration?.wallet??createInjectedWallet();
const api=compose({...integration,...(wallet?{wallet}:{}),validateStrategyDocument:validateBuilderDocument});
export const publicStrategies=api.strategies;
export const publicLists=cachedPublicLists(api.strategies,createPublicReadCache({storage:browserStorage(),onRefresh:(_key,changed)=>{if(changed&&typeof window!=='undefined')window.dispatchEvent(new Event('poros:public-data-updated'));}}));
export { MEMBER_STRATEGY_TYPE, readMemberStrategy } from './member-strategy.ts';
export async function readPersonalLibrary(recoveryCode?:string){
  if(!wallet)throw new Error('Connect a browser wallet to read your memberships.');
  const account=(await wallet.getContext()).account.toLowerCase() as `0x${string}`;
  const readers=createMembershipReaders(integration?.accessKey);
  const result=await readMemberLibrary({account,events:api.events,service:createCreatorMemberships(api.events,readers),readers,getProfile:wallet=>api.community.getProfile({wallet}),recoveryCode});
  if((await wallet.getContext()).account.toLowerCase()!==account)throw new Error('Wallet account changed. Refresh your library.');
  return {...result,account};
}
export function subscribeLibraryWallet(listener:()=>void){return wallet?.subscribe(listener)??(()=>{});}

export function mountBuilderMemberships(root: HTMLElement, options: {
  getDraft: () => unknown;
  openStrategy: (entry: ReturnType<typeof memberStrategy>) => Promise<void>;
  onCreators: (creators: {id:string;name:string}[]) => void;
}) {
  return mountMembershipWorkspace(root,{...options,wallet,events:api.events,community:api.community,accessKey:integration?.accessKey,
    creator:new URLSearchParams(location.search).get('creator') ?? undefined});
}

export function strategyReference(text: string, origin: string): `0x${string}` {
  if (text.length > 2048) throw new Error('Drop a public strategy card.');
  const url = new URL(text, origin);
  const key = url.searchParams.get('strategy');
  if (url.origin !== origin || url.pathname !== '/' || !key || !/^0x[0-9a-f]{64}$/.test(key)) throw new Error('Drop a public strategy card.');
  return key as `0x${string}`;
}

// A run stays associated with the wallet connected at its first snapshot.
const performanceOwners=new Map<string,Promise<string|undefined>>();
export async function recordPaperPerformance(run:import('./performance.ts').PaperRun){
  if(!performanceOwners.has(run.id)){
    performanceOwners.set(run.id,wallet?.getContext().then(context=>context.account.toLowerCase()).catch(()=>undefined)??Promise.resolve(undefined));
    if(performanceOwners.size>100)performanceOwners.delete(performanceOwners.keys().next().value!);
  }
  const owner=await performanceOwners.get(run.id);
  if(!owner || !wallet || (await wallet.getContext()).account.toLowerCase()!==owner)return;
  savePaperRun(localStorage,owner,run);
}
