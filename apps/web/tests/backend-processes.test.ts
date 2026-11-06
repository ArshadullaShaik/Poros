import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {startBackendProcesses} from '../tooling/backend-processes.mjs';
test('Railway starts one Bee and one worker; a failed child stops its sibling and requests shutdown',()=>{
 const children:any[]=[],commands:any[]=[];let failed=0;
 const spawn:any=(command:any,args:any,options:any)=>{commands.push({command,args,options});const child:any=new EventEmitter();child.kills=[];child.kill=(signal:string)=>child.kills.push(signal);children.push(child);return child;};
 const env={NODE_ENV:'test' as const,POROS_BUNDLED_SERVICES:'1',BEE_DATA_DIR:'/state/bee',SWARM_BEE_URL:'http://127.0.0.1:1633'};
 const stop=startBackendProcesses({env,spawn,onFailure:()=>{failed++;}});
 assert.equal(commands.length,2);assert.equal(commands[0].command,'/usr/local/bin/bee');assert.deepEqual(commands[0].args,['start']);
 assert.equal(commands[0].options.env.BEE_API_ADDR,'127.0.0.1:1633');
 assert.equal(commands[1].args[0].endsWith('membership-worker.mjs'),true);
 children[0].emit('exit',1);assert.equal(failed,1);assert.deepEqual(children[1].kills,['SIGTERM']);
 stop();assert.equal(failed,1);
});
test('standalone API does not start extra processes and unsafe bundled Bee settings fail closed',()=>{
 let spawned=0;
 startBackendProcesses({env:{NODE_ENV:'test'},spawn:(()=>{spawned++;}) as any,onFailure:()=>{}})();assert.equal(spawned,0);
 assert.throws(()=>startBackendProcesses({env:{NODE_ENV:'test',POROS_BUNDLED_SERVICES:'1',BEE_DATA_DIR:'/state/bee',SWARM_BEE_URL:'https://external.example'},spawn:(()=>{}) as any,onFailure:()=>{}}));
});
