import {compose} from './integration.ts';
import {createInjectedWallet} from './wallet.ts';
import {createCreatorMemberships,createMembershipReaders} from '../../../src/integrations/arkiv/community/index.ts';
import {readMemberLibrary} from './builder-library.ts';
import { validateBuilderDocument } from './strategy-document.ts';
export { builderDocument, validateBuilderDocument } from './strategy-document.ts';
const integration=typeof window==='undefined'?{}:window.__COMMON_GROUND__;
const wallet=typeof window==='undefined'?undefined:integration?.wallet??createInjectedWallet();
const api=compose({...integration,...(wallet?{wallet}:{}),validateStrategyDocument:validateBuilderDocument});
export const publicStrategies=api.strategies;
export async function connectLibraryWallet(){if(!wallet)throw new Error('Install a browser wallet to read your memberships.');await wallet.connect();}
export async function readPersonalLibrary(recoveryCode?:string){
  if(!wallet)throw new Error('Connect a browser wallet to read your memberships.');
  const account=(await wallet.getContext()).account.toLowerCase() as `0x${string}`;
  const readers=createMembershipReaders(integration?.accessKey);
  const result=await readMemberLibrary({account,events:api.events,service:createCreatorMemberships(api.events,readers),readers,getProfile:wallet=>api.community.getProfile({wallet}),recoveryCode});
  if((await wallet.getContext()).account.toLowerCase()!==account)throw new Error('Wallet account changed. Refresh your library.');
  return {...result,account};
}
export function subscribeLibraryWallet(listener:()=>void){return wallet?.subscribe(listener)??(()=>{});}

export function strategyReference(text: string, origin: string): `0x${string}` {
  if (text.length > 2048) throw new Error('Drop a public strategy card.');
  const url = new URL(text, origin);
  const key = url.searchParams.get('strategy');
  if (url.origin !== origin || url.pathname !== '/' || !key || !/^0x[0-9a-f]{64}$/.test(key)) throw new Error('Drop a public strategy card.');
  return key as `0x${string}`;
}
