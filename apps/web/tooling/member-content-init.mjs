import {loadEnvFile} from 'node:process';
import {fileURLToPath} from 'node:url';
import {isAbsolute} from 'node:path';
import {openMemberContentState} from '../../../src/features/builder/server/member-content-state.ts';
try{loadEnvFile(fileURLToPath(new URL('../../../.env.local',import.meta.url)));}catch(error){if(error.code!=='ENOENT')throw error;}
const path=process.env.MEMBERSHIP_DB_PATH,key=process.env.MEMBERSHIP_MASTER_KEY;
if(!path||!isAbsolute(path)||!key)throw new Error('Set the persistent absolute membership database path and master key first.');
const bytes=Buffer.from(key,'base64');
if(bytes.length!==32||bytes.toString('base64')!==key)throw new Error('Use a base64-encoded random 32-byte master key.');
openMemberContentState(path,bytes,true).close();
console.log('Initialized membership storage. Preserve its database and master key across restarts.');
