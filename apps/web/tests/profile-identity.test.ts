import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeHandle,resolveProfileReference,profileIdentityPanel,publicProfilePage} from '../src/profile-identity.ts';
import type {Profile} from '../../../src/integrations/arkiv/community/contracts.ts';
const wallet=('0x'+'a'.repeat(40)) as `0x${string}`;
const profile:Profile={wallet,handle:'arshad',displayName:'Arshad',bio:'Trader',userId:'eip155:7794095:'+wallet,key:('0x'+'1'.repeat(64)) as `0x${string}`,source:'arkiv'};
test('username lookup normalizes @names and resolves their Arkiv wallet record',async()=>{
 assert.equal(normalizeHandle(' @Arshad '),'arshad');assert.throws(()=>normalizeHandle('../admin'));
 const result=await resolveProfileReference('@Arshad',{getProfile:async()=>null,searchProfiles:async({handle})=>{assert.equal(handle,'arshad');return [profile];}});
 assert.equal(result.wallet,wallet);assert.equal(result.profile?.handle,'arshad');
});
test('shared handles return wallet choices, never silently select somebody else',async()=>{
 const other={...profile,wallet:('0x'+'b'.repeat(40)) as `0x${string}`};
 const result=await resolveProfileReference('@arshad',{getProfile:async()=>null,searchProfiles:async()=>[profile,other]});
 assert.equal(result.wallet,undefined);assert.equal(result.matches?.length,2);
 const direct=await resolveProfileReference(wallet,{getProfile:async()=>profile,searchProfiles:async()=>{throw new Error('Must use wallet lookup');}});assert.equal(direct.wallet,wallet);
});
test('Profile exposes username editing and search without embedded community chat',()=>{
 const panel=profileIdentityPanel(profile,wallet,true);assert.match(panel,/@arshad/);assert.match(panel,/data-action="edit-profile"/);assert.match(panel,new RegExp(wallet));
 const page=publicProfilePage(wallet,profile,true);assert.match(page,/profile-search/);assert.match(page,/creator-report/);assert.doesNotMatch(page,/Community chat|creator-room|creator-chat|Open room/);
 assert.doesNotMatch(publicProfilePage(wallet,profile,false),/data-action="edit-profile"/);
 assert.doesNotMatch(profileIdentityPanel({...profile,displayName:'<script>bad()</script>'},wallet,true),/<script>/);
});
