import type {Hex} from 'viem';
import type {Profile} from '../../../src/integrations/arkiv/community/contracts.ts';
import {escape as e} from './core.ts';
import {avatar,button,field,heading,notice,tag} from './ui.ts';

export function normalizeHandle(value:string){
 const handle=value.trim().replace(/^@/,'').toLowerCase();
 if(!/^[a-z0-9_]{3,32}$/.test(handle))throw new Error('Use 3–32 letters, numbers or underscores for your username.');
 return handle;
}
type ProfileReaders={getProfile(input:{wallet:Hex}):Promise<Profile|null>;searchProfiles(input:{handle:string}):Promise<Profile[]>};
type Resolution={wallet:Hex;profile:Profile|null;handle?:undefined;matches?:undefined}|{wallet?:undefined;profile?:undefined;handle:string;matches:Profile[]};
export async function resolveProfileReference(reference:string,readers:ProfileReaders):Promise<Resolution>{
 const value=decodeURIComponent(reference);
 if(/^0x[0-9a-f]{40}$/i.test(value)){const wallet=value.toLowerCase() as Hex;return {wallet,profile:await readers.getProfile({wallet})};}
 const handle=normalizeHandle(value),matches=await readers.searchProfiles({handle});
 if(matches.length===1)return {wallet:matches[0]!.wallet,profile:matches[0]!};
 return {handle,matches};
}
export function profileSearchForm(){
 return `<section class="paper-panel"><h2>Find a profile by username</h2><form data-form="profile-search" class="inline-form">${field('handle','Username',{placeholder:'@username',required:true,pattern:'@?[A-Za-z0-9_]{3,32}'})}<button class="button secondary">Find profile</button></form><div id="profile-results"></div></section>`;
}
export function profileMatches(handle:string,matches:Profile[]){
 return heading('USERNAME LOOKUP','@'+handle,matches.length?'This username matches multiple wallets. Choose the profile by its wallet address.':'No current Arkiv profile was found for this username.')+
  matches.map(profile=>`<a class="profile-panel" href="/profile#/profile/${e(profile.wallet)}">${avatar(profile.wallet)}<div><strong>${e(profile.displayName)}</strong><p>@${e(profile.handle)}</p><code>${e(profile.wallet)}</code></div></a>`).join('')+profileSearchForm();
}
export function profileIdentityPanel(profile:Profile|null,wallet:Hex,owned:boolean){
 return `<div class="profile-panel">${avatar(wallet)}<div><strong>${profile?e(profile.displayName):'Wallet profile'}</strong><p>${profile?`<a href="/profile#/profile/@${e(profile.handle)}">@${e(profile.handle)}</a>`:'Username not set'}</p><code>${e(wallet)}</code></div>${owned?button('edit-profile',profile?'Edit username':'Set username','secondary'):''}</div>`;
}
export function profileEditor(profile:Profile|null){
 return `<form data-form="profile" data-previous="${profile?.key??''}">${field('handle','Username',{value:profile?.handle,required:true,pattern:'[A-Za-z0-9_]{3,32}',hint:'3–32 letters, numbers or underscores. Stored in lowercase and linked to your wallet. Shared usernames show wallet choices.'})}${field('displayName','Display name (optional)',{value:profile?.displayName})}${field('bio','About you',{value:profile?.bio,area:true})}${notice('Your username and profile are public on Arkiv. Saving requires approval from your connected wallet.')}<button class="button primary">Save profile</button></form>`;
}
export function publicProfilePage(wallet:Hex,profile:Profile|null,owned:boolean){
 return heading('WALLET-OWNED IDENTITY',profile?.displayName??'An unwritten profile.',profile?.bio??'This wallet has not created a public profile yet.')+
  profileIdentityPanel(profile,wallet,owned)+tag('Wallet owned','green')+notice('Usernames link to wallet-owned profiles. A shared username can return multiple wallets; check the address.')+
  `<section class="paper-panel"><div class="section-title"><h2>Live trading report</h2>${button('creator-report-refresh','Refresh report','secondary')}</div><div id="creator-report" role="status">Reading verified Arkiv fills…</div></section><section class="paper-panel"><h2>Published strategies and versions</h2><p class="muted">Public Arkiv documents only. Private membership strategies are excluded. Expired records may be absent; this is not lifetime history.</p><div id="creator-strategies" data-wallet="${e(wallet)}" role="status">Reading public publications…</div></section><section id="creator-membership" class="paper-panel"></section>`+
  profileSearchForm();
}
