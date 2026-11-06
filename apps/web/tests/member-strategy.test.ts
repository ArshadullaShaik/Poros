import test from 'node:test';
import assert from 'node:assert/strict';
import { readMemberStrategy } from '../src/member-strategy.ts';
import { encryptSignal, decryptSignal } from '../src/creator-crypto.ts';
import { priceStrategy } from '../../../src/features/builder/market/config.ts';
import type { Json } from '../../../src/integrations/arkiv/contracts.ts';

test('encrypted member strategies round trip into validated canvas drafts and retain text-only posts',async()=>{
  const versionId='0x'+'a'.repeat(64);
  const content={communityKey:('0x'+'b'.repeat(64)) as `0x${string}`,title:'Member rules',body:'Reviewed price range',source:'manual' as const,strategy:priceStrategy as unknown as Json};
  const encrypted=await encryptSignal(content,'creator:post');
  const restored=await decryptSignal(encrypted,encrypted.key,'creator:post');
  assert.equal(restored.communityKey,content.communityKey);
  await assert.rejects(encryptSignal({...content,communityKey:'invalid' as `0x${string}`},'creator:post'));
  assert.deepEqual(readMemberStrategy(JSON.stringify({versionId,content:restored})).strategy,priceStrategy);
  assert.equal(readMemberStrategy(JSON.stringify({versionId,content:{title:'Signal',body:'Review these rules',source:'manual' as const}})).text,'Review these rules');
  const live={...content,strategy:{...priceStrategy,riskPolicy:{...priceStrategy.riskPolicy,paperTradingOnly:false}}};
  assert.throws(()=>readMemberStrategy(JSON.stringify({versionId,content:live})));
  await assert.rejects(encryptSignal(live as unknown as typeof content,'creator:post'));
  assert.throws(()=>readMemberStrategy(JSON.stringify({versionId:'bad',content})));
});

test('member drag context rejects expiry and a different receiving wallet',()=>{
 const wallet='0x'+'1'.repeat(40),versionId='0x'+'a'.repeat(64),content={title:'Private',body:'Rules',source:'manual'};
 const raw=JSON.stringify({versionId,content,memberWallet:wallet,expiresAt:2000});
 assert.throws(()=>readMemberStrategy(raw,{wallet,now:2000}));
 assert.throws(()=>readMemberStrategy(raw,{wallet:'0x'+'2'.repeat(40),now:1000}));
 assert.equal(readMemberStrategy(raw,{wallet,now:1000}).expiresAt,2000);
});
