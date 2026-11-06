import {loadEnvFile} from 'node:process';
import {fileURLToPath} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
try{loadEnvFile(fileURLToPath(new URL('../../../.env.local',import.meta.url)));}catch(e){if(e.code!=='ENOENT')throw e;}
const {getTradeRuntime}=await import('../../../src/features/builder/server/trade-runtime.ts');
const runtime=getTradeRuntime();if(!runtime)throw new Error('Configure the Arkiv writer, origin, access key and persistent database path before starting the trade worker.');
await runtime.repository.ready();
const stop=new AbortController();for(const event of ['SIGINT','SIGTERM'])process.once(event,()=>stop.abort());
try{
 do{
  try{await runtime.ledger.runOnce(AbortSignal.any([stop.signal,AbortSignal.timeout(600000)]));}
  catch{if(!stop.signal.aborted)console.error('Trade sync delayed; inspect the source and recording status. No orders are resubmitted.');}
  if(process.argv.includes('--once')||stop.signal.aborted)break;
  await pause(10000,undefined,{signal:stop.signal}).catch(()=>{});
 }while(!stop.signal.aborted);
}finally{runtime.state.close();}
