import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {openMemberContentState} from '../../../src/features/builder/server/member-content-state.ts';
const creator='0x'+'1'.repeat(40),publicationId=crypto.randomUUID(),hash='0x'+'a'.repeat(64);
test('custody persists encrypted content and references, fails closed on wrong key, and recovers uncertainty',()=>{
 const dir=mkdtempSync(join(tmpdir(),'member-state-')),path=join(dir,'state.sqlite'),key=new Uint8Array(32).fill(3);
 let state=openMemberContentState(path,key,true);
 try{
  state.prepare(creator,publicationId,hash,{title:'Secret title',body:'NEVER PLAIN',source:'manual'});
  assert.throws(()=>state.prepare(creator,publicationId,'other',{}),{code:'PUBLICATION_CONFLICT'});
  state.begin(creator,publicationId,false);
  state.close();state=openMemberContentState(path,key);
  assert.equal(state.publication(creator,publicationId)?.status,'uncertain');
  assert.throws(()=>state.begin(creator,publicationId,false),{code:'UPLOAD_UNCERTAIN'});
  state.begin(creator,publicationId,true);
  state.finish(creator,publicationId,'a'.repeat(128));
  assert.equal(state.publication(creator,publicationId)?.reference,'a'.repeat(128));
  state.close();
  assert.throws(()=>openMemberContentState(path,new Uint8Array(32).fill(8)));
  state=openMemberContentState(path,key);
  assert.equal(state.publication(creator,publicationId)?.reference,'a'.repeat(128));
  for(const name of ['state.sqlite','state.sqlite-wal']){try{const raw=readFileSync(join(dir,name)).toString();assert.ok(!raw.includes('NEVER PLAIN'));assert.ok(!raw.includes('a'.repeat(128)));}catch(error:any){if(error.code!=='ENOENT')throw error;}}
 }finally{state.close();rmSync(dir,{recursive:true,force:true});}
});
test('challenges expire and can be consumed exactly once',()=>{
 const state=openMemberContentState(':memory:',new Uint8Array(32).fill(5));
 try{
  const proof=state.challenge({wallet:creator,operation:'read',origin:'http://localhost',signalKey:hash},1000);
  assert.match(proof.message,/poros:member-content:1/);
  assert.equal(state.proof(proof.nonce,1001).wallet,creator);
  state.consume(proof.nonce,1001);
  assert.throws(()=>state.consume(proof.nonce,1001),{code:'INVALID_PROOF'});
  const expired=state.challenge({wallet:creator},1000);
  assert.throws(()=>state.proof(expired.nonce,301000),{code:'INVALID_PROOF'});
 }finally{state.close();}
});

test('normal startup rejects a missing custody file instead of replacing lost state',()=>{
 const dir=mkdtempSync(join(tmpdir(),'member-missing-'));let accidental:any;
 try{assert.throws(()=>{accidental=openMemberContentState(join(dir,'missing.sqlite'),new Uint8Array(32).fill(1));},{code:'CUSTODY_MISSING'});}
 finally{accidental?.close();rmSync(dir,{recursive:true,force:true});}
});

test('explicit initialization command creates once and refuses to overwrite custody',()=>{
 const dir=mkdtempSync(join(tmpdir(),'member-init-')),path=join(dir,'custody.sqlite');
 const secret=Buffer.alloc(32,4).toString('base64');
 const script=fileURLToPath(new URL('../tooling/member-content-init.mjs',import.meta.url));
 const run=()=>spawnSync(process.execPath,[script],{env:{...process.env,MEMBERSHIP_DB_PATH:path,MEMBERSHIP_MASTER_KEY:secret},encoding:'utf8'});
 try{
  const first=run();assert.equal(first.status,0,first.stderr);assert.match(first.stdout,/Initialized/);assert.ok(!first.stdout.includes(secret));
  const saved=readFileSync(path);const again=run();assert.notEqual(again.status,0);assert.deepEqual(readFileSync(path),saved);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
