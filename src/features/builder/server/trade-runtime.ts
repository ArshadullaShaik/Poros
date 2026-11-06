import {readFileSync,statSync,mkdirSync,chmodSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {serverTradeRepository} from '../../../integrations/arkiv/trade-writer.ts';
import {createTradeSource} from '../execution/trade-source.ts';
import {openTradeState} from './trade-state.ts';
import {createTradeLedger} from './trade-ledger.ts';
let current:ReturnType<typeof createRuntime>|null|undefined;
function createRuntime(){
 const key=process.env.ARKIV_TRADE_WRITER_PRIVATE_KEY,trusted=process.env.ARKIV_TRADE_TRUSTED_WRITER,path=process.env.TRADE_LEDGER_DB_PATH,origin=process.env.TRADE_LEDGER_ORIGIN;
 if(!key||!trusted||!path||!origin||!process.env.ARKIV_ACCESS_KEY)return null;
 if(new URL(origin).origin!==origin)throw new Error('Configure a canonical trade ledger origin');
 const dbPath=resolve(path);mkdirSync(dirname(dbPath),{recursive:true,mode:0o700});
 const repository=serverTradeRepository(key,trusted,process.env.ARKIV_ACCESS_KEY);
 const state=openTradeState(dbPath);chmodSync(dbPath,0o600);
 const sourceAdapter=createTradeSource({credentials:source=>{
  if(source.kind==='flash'){if(!process.env.FLASH_API_KEY)throw new Error('SOURCE_NOT_CONFIGURED');return {key:process.env.FLASH_API_KEY};}
  const file=process.env.DEFINITIVE_PORTFOLIO_CREDENTIALS_FILE;if(!file)throw new Error('SOURCE_NOT_CONFIGURED');
  if(statSync(file).mode&0o077)throw new Error('Portfolio credentials file must be operator-only');
  const entries=JSON.parse(readFileSync(file,'utf8')),entry=entries[source.sourceId];
  if(!entry||typeof entry.key!=='string'||typeof entry.secret!=='string')throw new Error('SOURCE_NOT_CONFIGURED');return {key:entry.key,secret:entry.secret};
 }});
 return {origin,state,repository,sourceAdapter,ledger:createTradeLedger({state,repository,sourceAdapter})};
}
export function getTradeRuntime(){if(current===undefined)current=createRuntime();return current;}
export type TradeRuntime=NonNullable<ReturnType<typeof getTradeRuntime>>;
