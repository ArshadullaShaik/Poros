import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readMemberLibrary} from '../src/builder-library.ts';
import {createEncryptionIdentity,encryptSignal,sealContentKey} from '../src/creator-crypto.ts';
const account='0x1111111111111111111111111111111111111111',creator='0x2222222222222222222222222222222222222222';
test('personal library uses verified active memberships and decrypts only envelopes for the current key',async()=>{
 const identity=await createEncryptionIdentity(account),now=Date.now(),context=creator+':publication';
 const encrypted=await encryptSignal({title:'Creator price rules',body:'Buy $20 of WETH using USDC on Base between $2000 and $2100 USD.'},context);
 const box=await sealContentKey(encrypted.key,identity.identity.publicKey,context+':'+account);
 let signals=0,active=true,delivered=true,time=now;
 const options:any={account,events:{scan:async(input:any)=>{assert.equal(input.actor,account);return [{subject:creator},{subject:creator}];}},readers:{now:async()=>time},getProfile:async()=>({displayName:'Creator'}),service:{members:async()=>[{wallet:account,expiresAt:active?now+100000:now-1}],getKey:async()=>({key:'key',data:identity.identity}),signals:async()=>{signals++;return [{key:'signal',actor:creator,requestId:'publication',data:encrypted}];},getEnvelope:async()=>delivered?{data:{keyRecord:'key',box}}:undefined}};
 const locked=await readMemberLibrary(options);assert.equal(locked.creators.length,1);assert.equal(locked.locked,true);assert.equal(signals,0);
 const unlocked=await readMemberLibrary({...options,recoveryCode:identity.recoveryCode});assert.equal(unlocked.entries[0]!.text,'Buy $20 of WETH using USDC on Base between $2000 and $2100 USD.');assert.equal(unlocked.locked,false);
 await assert.rejects(readMemberLibrary({...options,recoveryCode:'wrong-code'}));
 delivered=false;assert.equal((await readMemberLibrary({...options,recoveryCode:identity.recoveryCode})).entries.length,0);
 active=false;assert.equal((await readMemberLibrary(options)).creators.length,0);
 active=true;let reads=0;options.readers.now=async()=>++reads===1?now:now+100001;await assert.rejects(readMemberLibrary({...options,recoveryCode:identity.recoveryCode}),/expired/);
});
