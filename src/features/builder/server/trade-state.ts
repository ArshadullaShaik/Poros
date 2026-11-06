import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {domainHash,canonical} from '../../../integrations/arkiv/codec.ts';
import {sourceSchema,bindingSchema,traderSchema,buildTradeRecord,sourceKey} from '../../../integrations/arkiv/trade-contracts.ts';
import type {TradeSourceRef,SourceBinding,LedgerInput,LedgerEntry,LedgerCoverage} from '../../../integrations/arkiv/trade-contracts.ts';
export type StoredSource={id:string;binding:SourceBinding;active:boolean;coverage:LedgerCoverage|null;lastError:string|null;nextAt:number;cursor:string|null;unlinkedAt:number|null};
export type Outbox={identity:string;input:LedgerInput;state:string;entry:LedgerEntry|null;attemptedAt:number|null};
export function openTradeState(path:string){
 const db=new DatabaseSync(path);db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
 const version=(db.prepare('PRAGMA user_version').get() as any).user_version;if(version!==0&&version!==1){db.close();throw new Error('Unsupported trade database version');}
 db.exec(`CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,trader TEXT NOT NULL,binding TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,coverage TEXT,cursor TEXT,lastError TEXT,nextAt INTEGER NOT NULL DEFAULT 0,unlinkedAt INTEGER);
 CREATE TABLE IF NOT EXISTS challenges(nonce TEXT PRIMARY KEY,payload TEXT NOT NULL,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS outbox(identity TEXT PRIMARY KEY,hash TEXT NOT NULL,input TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',entry TEXT,attemptedAt INTEGER);
 CREATE TABLE IF NOT EXISTS intents(id TEXT PRIMARY KEY,payload TEXT NOT NULL,orderId TEXT);
 CREATE TABLE IF NOT EXISTS lease(id INTEGER PRIMARY KEY,owner TEXT NOT NULL,untilAt INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 PRAGMA user_version=1;`);
 function transaction<T>(run:()=>T):T{db.exec('BEGIN IMMEDIATE');try{const result=run();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
 const decode=(r:any):StoredSource=>({id:r.id,binding:JSON.parse(r.binding),active:Boolean(r.active),coverage:r.coverage?JSON.parse(r.coverage):null,lastError:r.lastError,nextAt:Number(r.nextAt),cursor:r.cursor,unlinkedAt:r.unlinkedAt});
 const api={
  sources(trader?:string):StoredSource[]{if(trader)traderSchema.parse(trader);return (trader?db.prepare('SELECT * FROM sources WHERE trader=?').all(trader):db.prepare('SELECT * FROM sources').all()).map(decode);},
  link(binding:SourceBinding){binding=bindingSchema.parse(binding);transaction(()=>{
   const id=sourceKey(binding.source),old=db.prepare('SELECT * FROM sources WHERE id=?').get(id) as any;
   if(old&&old.trader!==binding.trader)throw new Error('Source already attributed to another profile');
   if(old)db.prepare('UPDATE sources SET active=1,unlinkedAt=NULL,nextAt=0 WHERE id=?').run(id);
   else db.prepare('INSERT INTO sources(id,trader,binding) VALUES(?,?,?)').run(id,binding.trader,canonical(binding));
  });},
  unlink(source:TradeSourceRef,trader:string,now=Date.now()){traderSchema.parse(trader);const result=db.prepare('UPDATE sources SET active=0,unlinkedAt=?,nextAt=0 WHERE id=? AND trader=?').run(now,sourceKey(source),trader);if(!result.changes)throw new Error('Unknown linked source');},
  challenge(input:{trader:string;source:TradeSourceRef;operation:'link'|'unlink';origin:string},now=Date.now()){
   traderSchema.parse(input.trader);sourceSchema.parse(input.source);
   if(!['link','unlink'].includes(input.operation)||new URL(input.origin).origin!==input.origin)throw new Error('Invalid challenge scope');
   db.prepare('DELETE FROM challenges WHERE expires<?').run(now-3600000);
   if(Number((db.prepare('SELECT count(*) AS n FROM challenges WHERE expires>=?').get(now) as any).n)>1000)throw new Error('Too many pending challenges');
   const nonce=randomUUID(),expiresAt=now+300000;
   const message=`Poros trade history\nOrigin: ${input.origin}\nOperation: ${input.operation}\nProfile: ${input.trader}\nSource: ${canonical(input.source)}\nNonce: ${nonce}\nExpires: ${new Date(expiresAt).toISOString()}\nPublish this source's executions and retain its attributed history after unlinking.`;
   const result={...input,nonce,expiresAt,message};db.prepare('INSERT INTO challenges(nonce,payload,expires) VALUES(?,?,?)').run(nonce,canonical(result),expiresAt);return result;
  },
  proof(nonce:string,now=Date.now()){
   if(typeof nonce!=='string'||nonce.length>64)throw new Error('Invalid nonce');const row=db.prepare('SELECT * FROM challenges WHERE nonce=? AND used=0 AND expires>?').get(nonce,now) as any;if(!row)throw new Error('Expired or replayed challenge');return JSON.parse(row.payload) as {trader:string;source:TradeSourceRef;operation:'link'|'unlink';origin:string;message:string;nonce:string;expiresAt:number};
  },
  consume(nonce:string,now=Date.now()){return transaction(()=>{const value=api.proof(nonce,now);const r=db.prepare('UPDATE challenges SET used=1 WHERE nonce=? AND used=0').run(nonce);if(!r.changes)throw new Error('Replayed proof');return value;});},
  enqueue(input:LedgerInput){const record=buildTradeRecord(input);const old=db.prepare('SELECT hash FROM outbox WHERE identity=?').get(record.identity) as any;
   if(old&&old.hash!==record.recordHash)throw new Error('LEDGER_CONFLICT');
   db.prepare('INSERT OR IGNORE INTO outbox(identity,hash,input) VALUES(?,?,?)').run(record.identity,record.recordHash,canonical(input));return record.identity;
  },
  outbox():Outbox[]{return db.prepare("SELECT * FROM outbox WHERE state!='recorded' ORDER BY rowid").all().map((r:any)=>({identity:r.identity,input:JSON.parse(r.input),state:r.state,entry:r.entry?JSON.parse(r.entry):null,attemptedAt:r.attemptedAt}));},
  markAttempt(identity:string,now=Date.now()){db.prepare("UPDATE outbox SET state='uncertain',attemptedAt=? WHERE identity=? AND state='pending'").run(now,identity);},
  confirm(identity:string,entry:LedgerEntry){db.prepare("UPDATE outbox SET state='recorded',entry=? WHERE identity=?").run(canonical(entry),identity);},
  conflict(identity:string){db.prepare("UPDATE outbox SET state='conflict' WHERE identity=?").run(identity);},
  checkpoint(id:string,coverage:LedgerCoverage|null,cursor:string|null,nextAt:number,error:string|null=null){db.prepare('UPDATE sources SET coverage=?,cursor=?,nextAt=?,lastError=? WHERE id=?').run(coverage?canonical(coverage):null,cursor,nextAt,error,id);},
  lease(owner:string,now=Date.now()){return transaction(()=>{
   const old=db.prepare('SELECT * FROM lease WHERE id=1').get() as any;
   if(old&&old.owner!==owner&&old.untilAt>now)return false;
   db.prepare('INSERT INTO lease(id,owner,untilAt) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,untilAt=excluded.untilAt').run(owner,now+120000);return true;
  });},
  release(owner:string){db.prepare('DELETE FROM lease WHERE owner=?').run(owner);},
  trackOrder(input:{source:TradeSourceRef;trader:string;runId:string;actionId:string;quoteId:string;orderId?:string;createdAt:number}){
   sourceSchema.parse(input.source);traderSchema.parse(input.trader);if(![input.runId,input.actionId,input.quoteId].every(v=>typeof v==='string'&&v.length>0&&v.length<=256))throw new Error('Invalid tracking intent');
   const id=domainHash('trade-intent',{source:input.source,runId:input.runId,actionId:input.actionId,quoteId:input.quoteId});
   transaction(()=>{const prior=db.prepare('SELECT orderId FROM intents WHERE id=?').get(id) as any;
    if(prior?.orderId&&input.orderId&&prior.orderId!==input.orderId)throw new Error('Conflicting accepted order');
    db.prepare('INSERT INTO intents(id,payload,orderId) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET orderId=COALESCE(excluded.orderId,intents.orderId)').run(id,canonical(input),input.orderId??null);
   });return id;
  },
  intents(){return db.prepare('SELECT * FROM intents').all().map((r:any)=>({id:r.id,...JSON.parse(r.payload),orderId:r.orderId}));},
  receipts():LedgerEntry[]{return db.prepare("SELECT entry FROM outbox WHERE state='recorded'").all().map((r:any)=>JSON.parse(r.entry));},
  meta(key:string,value?:string){if(value!==undefined)db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);return (db.prepare('SELECT value FROM meta WHERE key=?').get(key) as any)?.value as string|undefined;},
  close(){db.close();},
 };
 return api;
}
export type TradeState=ReturnType<typeof openTradeState>;
