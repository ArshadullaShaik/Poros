import test from 'node:test';
import assert from 'node:assert/strict';
import {readPaperRuns,savePaperRun} from '../src/performance.ts';
const wallet='0x'+'a'.repeat(40),other='0x'+'b'.repeat(40);
const store=()=>{const data=new Map<string,string>();return {getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}};};
const run={id:'run-1',pair:'ETH / USDC',realizedPnl:12.5,fills:2,updatedAt:1000};
test('paper performance replaces snapshots of a run and isolates wallets',()=>{
 const storage=store();savePaperRun(storage,wallet,run);savePaperRun(storage,wallet,{...run,realizedPnl:15});
 assert.equal(readPaperRuns(storage,wallet).length,1);assert.equal(readPaperRuns(storage,wallet)[0]?.realizedPnl,15);
 assert.deepEqual(readPaperRuns(storage,other),[]);
 assert.throws(()=>savePaperRun(storage,wallet,{...run,realizedPnl:NaN}));
});
test('paper performance keeps only 100 recent runs and rejects corrupt storage',()=>{
 const storage=store();for(let i=0;i<110;i++)savePaperRun(storage,wallet,{...run,id:'run-'+i,updatedAt:i});
 assert.equal(readPaperRuns(storage,wallet).length,100);
 assert.equal(readPaperRuns(storage,wallet)[0]?.id,'run-109');
 assert.throws(()=>readPaperRuns({getItem:()=>'{bad'},wallet));
});
test('a delayed paper snapshot cannot replace a newer result',()=>{
 const storage=store();savePaperRun(storage,wallet,{...run,updatedAt:2000,realizedPnl:20});
 savePaperRun(storage,wallet,run);
 assert.equal(readPaperRuns(storage,wallet)[0]?.realizedPnl,20);
});
