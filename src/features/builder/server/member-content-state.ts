import {DatabaseSync} from 'node:sqlite';
import {createCipheriv,createDecipheriv,randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,chmodSync,existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {canonical} from '../../../integrations/arkiv/codec.ts';

export function memberFailure(code:string):never {throw Object.assign(new Error(code),{code});}
type Publication={creator:string;publicationId:string;hash:string;status:string;content:any;reference?:string};
export function openMemberContentState(path:string,masterKey:Uint8Array,initialize=false,recoverUploads=true){
 if(masterKey.length!==32)throw new Error('Configure a 32-byte membership master key');
 if(path!==':memory:'){
  path=resolve(path);
  if(initialize&&existsSync(path))throw new Error('Membership database already exists');
  if(!initialize&&!existsSync(path))memberFailure('CUSTODY_MISSING');
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
 }
 const db=new DatabaseSync(path);
 try{
  if(path!==':memory:')chmodSync(path,0o600);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  const version=(db.prepare('PRAGMA user_version').get() as any).user_version;
  if(version!==0&&version!==1&&version!==2)throw new Error('Unsupported membership database version');
  db.exec(`CREATE TABLE IF NOT EXISTS publications(creator TEXT NOT NULL,id TEXT NOT NULL,hash TEXT NOT NULL,status TEXT NOT NULL,draft TEXT NOT NULL,reference TEXT,PRIMARY KEY(creator,id));
   CREATE TABLE IF NOT EXISTS challenges(nonce TEXT PRIMARY KEY,payload TEXT NOT NULL,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS relay_jobs(kind TEXT,owner TEXT,id TEXT,value TEXT NOT NULL,PRIMARY KEY(kind,owner,id)); PRAGMA user_version=2;`);
  function seal(value:unknown,context:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',masterKey,iv);cipher.setAAD(Buffer.from(context));const data=Buffer.concat([cipher.update(canonical(value),'utf8'),cipher.final()]);return JSON.stringify({iv:iv.toString('base64'),data:data.toString('base64'),tag:cipher.getAuthTag().toString('base64')});}
  function open(value:string,context:string){const box=JSON.parse(value),decipher=createDecipheriv('aes-256-gcm',masterKey,Buffer.from(box.iv,'base64'));decipher.setAAD(Buffer.from(context));decipher.setAuthTag(Buffer.from(box.tag,'base64'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data,'base64')),decipher.final()]).toString('utf8'));}
  const marker=db.prepare("SELECT value FROM meta WHERE key='key-check'").get() as any;
  if(marker){if(open(marker.value,'membership-key-check')!=='poros')throw new Error('Wrong membership key');}
  else db.prepare("INSERT INTO meta(key,value) VALUES('key-check',?)").run(seal('poros','membership-key-check'));
  if(recoverUploads)db.exec("UPDATE publications SET status='uncertain' WHERE status='uploading'");
  const context=(creator:string,id:string,hash:string)=>canonical({creator,publicationId:id,hash,format:'swarm-message/1'});
  function publication(creator:string,id:string):Publication|undefined{
   const row=db.prepare('SELECT * FROM publications WHERE creator=? AND id=?').get(creator,id) as any;if(!row)return;
   const aad=context(creator,id,row.hash);
   return {creator,publicationId:id,hash:row.hash,status:row.status,content:open(row.draft,aad+':draft'),...(row.reference?{reference:open(row.reference,aad+':reference')}: {})};
  }
  const jobContext=(kind:string,owner:string,id:string)=>canonical({kind,owner,id});
  function job(kind:string,owner:string,id:string):any{
   const row=db.prepare('SELECT value FROM relay_jobs WHERE kind=? AND owner=? AND id=?').get(kind,owner,id) as any;
   return row?open(row.value,jobContext(kind,owner,id)):undefined;
  }
  function saveJob(value:any){db.prepare('INSERT OR REPLACE INTO relay_jobs(kind,owner,id,value) VALUES(?,?,?,?)').run(value.kind,value.owner,value.id,seal(value,jobContext(value.kind,value.owner,value.id)));}
  return {
   publication,job,
   recoverLegacyUploads(){db.exec("UPDATE publications SET status='uncertain' WHERE status='uploading' AND NOT EXISTS (SELECT 1 FROM relay_jobs WHERE kind='publish' AND owner=publications.creator AND id=publications.id)");},
   recoverUploads(creator:string,id:string){db.prepare("UPDATE publications SET status='uncertain' WHERE status='uploading' AND creator=? AND id=?").run(creator,id);},
   enqueue(input:{kind:string;owner:string;id:string;payload:any}){
    const prior=job(input.kind,input.owner,input.id);
    if(prior){if(canonical(prior.payload)!==canonical(input.payload))memberFailure('PUBLICATION_CONFLICT');return prior;}
    const value={...input,phase:'queued'};saveJob(value);return value;
   },
   updateJob(kind:string,owner:string,id:string,patch:Record<string,unknown>){const prior=job(kind,owner,id);if(!prior)memberFailure('INVALID_INPUT');const value={...prior,...patch};saveJob(value);return value;},
   jobs(){return (db.prepare('SELECT kind,owner,id FROM relay_jobs').all() as any[]).map(row=>job(row.kind,row.owner,row.id)).filter(row=>row.phase!=='done');},
   lease(owner:string,now:number){
    const value=JSON.stringify({owner,expires:now+60000});
    return db.prepare("INSERT INTO meta(key,value) VALUES('relay-lease',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE json_extract(meta.value,'$.owner')=? OR json_extract(meta.value,'$.expires')<?").run(value,owner,now).changes===1;
   },
   renewLease(owner:string,now:number){return db.prepare("UPDATE meta SET value=? WHERE key='relay-lease' AND json_extract(value,'$.owner')=? AND json_extract(value,'$.expires')>?").run(JSON.stringify({owner,expires:now+60000}),owner,now).changes===1;},
   signedJob(owner:string,now:number,kind:string,wallet:string,id:string,raw:string,hash:string){
    db.exec('BEGIN IMMEDIATE');
    try{
     if(!this.renewLease(owner,now))memberFailure('RELAY_UNAVAILABLE');
     const prior=job(kind,wallet,id);if(!prior||prior.phase==='done'||prior.raw)memberFailure('PUBLICATION_CONFLICT');
     saveJob({...prior,raw,hash,phase:'sent'});db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
   },
   healthy(now:number,actor?:string){const row=db.prepare("SELECT value FROM meta WHERE key='relay-ready'").get() as any;if(!row)return false;const ready=JSON.parse(row.value);return ready.at>now-30000&&(!actor||ready.actor===actor);},
   heartbeat(now:number,actor?:string){db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('relay-ready',?)").run(JSON.stringify({at:now,actor}));},
   prepare(creator:string,id:string,hash:string,content:unknown){
    const prior=publication(creator,id);if(prior){if(prior.hash!==hash)memberFailure('PUBLICATION_CONFLICT');return prior;}
    db.prepare("INSERT INTO publications(creator,id,hash,status,draft) VALUES(?,?,?,'prepared',?)").run(creator,id,hash,seal(content,context(creator,id,hash)+':draft'));
    return publication(creator,id)!;
   },
   begin(creator:string,id:string,retryUncertain:boolean){
    const row=publication(creator,id);if(!row)memberFailure('CONTENT_UNAVAILABLE');
    if(row.status==='uncertain'&&!retryUncertain)memberFailure('UPLOAD_UNCERTAIN');
    const changed=db.prepare("UPDATE publications SET status='uploading' WHERE creator=? AND id=? AND (status='prepared' OR (status='uncertain' AND ?=1))").run(creator,id,retryUncertain?1:0);
    if(changed.changes!==1)memberFailure('UPLOAD_BUSY');
   },
   finish(creator:string,id:string,reference:string){
    const row=publication(creator,id);if(!row)memberFailure('CONTENT_UNAVAILABLE');
    const changed=db.prepare("UPDATE publications SET status='uploaded',reference=? WHERE creator=? AND id=? AND status='uploading'").run(seal(reference,context(creator,id,row.hash)+':reference'),creator,id);
    if(changed.changes!==1)memberFailure('UPLOAD_BUSY');
   },
   uncertain(creator:string,id:string){db.prepare("UPDATE publications SET status='uncertain' WHERE creator=? AND id=? AND status='uploading'").run(creator,id);},
   challenge(input:Record<string,unknown>,now:number){
    db.prepare('DELETE FROM challenges WHERE expires<=?').run(now);
    if(Number((db.prepare('SELECT COUNT(*) AS n FROM challenges').get() as any).n)>=10000)memberFailure('RATE_LIMITED');
    const nonce=randomUUID(),expires=now+300000;
    const payload={...input,domain:'poros:member-content:1',nonce,issuedAt:now,expiresAt:expires};
    const message=canonical(payload);db.prepare('INSERT INTO challenges(nonce,payload,expires) VALUES(?,?,?)').run(nonce,message,expires);
    return {nonce,message,expiresAt:expires};
   },
   proof(nonce:string,now:number){const row=db.prepare('SELECT payload FROM challenges WHERE nonce=? AND used=0 AND expires>?').get(nonce,now) as any;if(!row)memberFailure('INVALID_PROOF');return {...JSON.parse(row.payload),message:row.payload};},
   consume(nonce:string,now:number){if(db.prepare('UPDATE challenges SET used=1 WHERE nonce=? AND used=0 AND expires>?').run(nonce,now).changes!==1)memberFailure('INVALID_PROOF');},
   close(){db.close();},
  };
 }catch(error){db.close();throw error;}
}
export type MemberContentState=ReturnType<typeof openMemberContentState>;
