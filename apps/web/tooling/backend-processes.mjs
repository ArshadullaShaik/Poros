import {spawn as nodeSpawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export function startBackendProcesses({env=process.env,spawn=nodeSpawn,onFailure}){
 if(env.POROS_BUNDLED_SERVICES!=='1')return ()=>Promise.resolve();
 if(env.SWARM_BEE_URL!=='http://127.0.0.1:1633'||env.BEE_DATA_DIR!=='/state/bee')throw new Error('Bundled Bee must use loopback and the persistent /state/bee directory.');
 const children=[],exited=new Set();let stopping=false;
 const finished=[];
 function stop(){if(!stopping){stopping=true;for(const child of children)if(!exited.has(child))child.kill('SIGTERM');}return Promise.all(finished);}
 for(const [command,args]of [
  ['/usr/local/bin/bee',['start']],
  [process.execPath,[fileURLToPath(new URL('./membership-worker.mjs',import.meta.url))]],
 ]){
  const child=spawn(command,args,{env:{...env,BEE_API_ADDR:'127.0.0.1:1633'},stdio:'inherit',windowsHide:true});children.push(child);
  finished.push(new Promise(resolve=>{
   const ended=()=>{if(exited.has(child))return;exited.add(child);resolve();if(!stopping){void stop();onFailure();}};
   child.once('error',ended);child.once('exit',ended);
  }));
 }
 return stop;
}
