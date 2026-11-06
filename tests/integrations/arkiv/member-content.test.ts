import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEvent,decodeEvent} from '../../../src/integrations/arkiv/community/events.ts';
import {validateMemberContent,memberContentHash} from '../../../src/integrations/arkiv/community/member-content.ts';
const actor=('0x'+'1'.repeat(40)) as `0x${string}`,key='0x'+'a'.repeat(64);
const requestId=crypto.randomUUID();
const base={actor,subject:actor,scope:'global',requestId};
test('new claims and public Swarm pointers validate without publishing plaintext or keys',()=>{
  buildEvent({...base,type:'subscription',data:{planKey:key,transactionHash:key}});
  const content=validateMemberContent({title:'Paid post',body:'Private rules',source:'manual'});
  const data={format:'swarm-message/1',publicationId:requestId,swarmAddress:'a'.repeat(64),payloadHash:memberContentHash(content),source:'manual'};
  const record=buildEvent({...base,type:'private-signal',data});
  assert.deepEqual(decodeEvent(record,actor,actor,true,false),record);
  assert.throws(()=>buildEvent({...base,type:'private-signal',data:{...data,body:'leak'}}));
  assert.throws(()=>buildEvent({...base,type:'private-signal',data:{...data,swarmAddress:'a'.repeat(128)}}));
  assert.throws(()=>buildEvent({...base,type:'private-signal',data:{...data,publicationId:crypto.randomUUID()}}));
  assert.throws(()=>validateMemberContent({...content,source:'invalid'}));
  assert.throws(()=>validateMemberContent({...content,body:'💰'.repeat(1025)}));
});
test('legacy encrypted record and subscription hashes remain unchanged on decoding',()=>{
  const box={publicKey:'a'.repeat(43),salt:'b'.repeat(43),iv:'a'.repeat(16),ciphertext:'b'.repeat(64)};
  for(const [type,data] of [
    ['subscription',{planKey:key,transactionHash:key,keyRecord:key}],
    ['private-signal',{iv:'a'.repeat(16),ciphertext:'b'.repeat(80),creatorKey:key,creatorBox:box,source:'manual'}],
  ] as const){
    const record=buildEvent({...base,type,data});
    assert.equal(decodeEvent(record,actor,actor,true,false).hash,record.hash);
  }
});
