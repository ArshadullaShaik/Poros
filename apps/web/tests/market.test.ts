import test from 'node:test';
import assert from 'node:assert/strict';
import type {Hex} from 'viem';
import {MarketClient} from '../src/market.ts';
import type {WalletBridge} from '../src/integration.ts';
const wallet=('0x'+'a'.repeat(40)) as Hex;
test('HTTP client sends bearer in headers only, disables cache and clears rejected sessions',async()=>{
  let request:RequestInit|undefined;let url='';
  const client=new MarketClient((async(input,init)=>{url=String(input);request=init;return Response.json({error:'AUTH_REQUIRED'},{status:401});}) as typeof fetch);
  client.session.accept(0,{token:'a'.repeat(43),wallet,expiresAt:Date.now()+60000},wallet);
  await assert.rejects(()=>client.post('/orders/list',{},wallet));
  assert.equal(url,'/api/community-marketplace/orders/list');assert.equal(request!.cache,'no-store');
  assert.equal((request!.headers as Record<string,string>).Authorization,'Bearer '+'a'.repeat(43));assert.equal(client.session.token,undefined);
});
test('an account change during a sign-in response never installs the old session',async()=>{
  let current=wallet;const other=('0x'+'b'.repeat(40)) as Hex;
  const client=new MarketClient((async input=>String(input).endsWith('/auth/challenge')?Response.json({challengeId:'c'.repeat(43),message:'Test sign-in',expiresAt:Date.now()+60000}):(current=other,Response.json({token:'a'.repeat(43),wallet,expiresAt:Date.now()+60000}))) as typeof fetch);
  const bridge={getContext:async()=>({account:current}),signMessage:async()=>('0x'+'d'.repeat(130)) as Hex} as unknown as WalletBridge;
  await assert.rejects(()=>client.login(bridge));assert.equal(client.session.token,undefined);
});
test('a missing same-origin API is a dependency error, never fixture success',async()=>{
  const client=new MarketClient((async()=>new Response('<html>not an API</html>',{status:200,headers:{'Content-Type':'text/html'}})) as typeof fetch);
  await assert.rejects(()=>client.post('/auth/challenge',{wallet}),error=>(error as {code:string}).code==='DEPENDENCY_UNAVAILABLE');
});
