import {loadEnvFile} from 'node:process';
import {fileURLToPath} from 'node:url';
import {getMemberContentRuntime} from '../../../src/features/builder/server/member-content.ts';
import {createRelayWorker} from '../../../src/features/builder/server/membership-relay.ts';
try{loadEnvFile(fileURLToPath(new URL('../../../.env.local',import.meta.url)));}catch(error){if(error.code!=='ENOENT')throw error;}
const runtime=getMemberContentRuntime();
if(!runtime||!/^0x[0-9a-fA-F]{64}$/.test(process.env.MEMBERSHIP_RELAY_PRIVATE_KEY??''))throw new Error('Configure Swarm custody and MEMBERSHIP_RELAY_PRIVATE_KEY before starting the membership worker.');
console.info('Membership relay wallet: '+runtime.relayActor+' (Rabdi tGLM).');
const tick=createRelayWorker(runtime,process.env.MEMBERSHIP_RELAY_PRIVATE_KEY);
let stopped=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopped=true;});
while(!stopped){try{await tick();}catch{console.error('Membership relay unavailable; retrying.');}if(!stopped)await new Promise(resolve=>setTimeout(resolve,3000));}
runtime.state.close();
