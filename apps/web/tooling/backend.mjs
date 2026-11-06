import {createServer} from 'node:http';
import {existsSync} from 'node:fs';
import {createApiHandler} from '../../../src/features/builder/server/api.mjs';
import {createBackendGateway} from '../../../src/features/builder/server/deployment.mjs';
import {startBackendProcesses} from './backend-processes.mjs';
const bundled=process.env.POROS_BUNDLED_SERVICES==='1';
const restored=existsSync('/state/.poros-ready');
if(bundled&&restored){
 for(const path of [process.env.MEMBERSHIP_DB_PATH,'/state/bee/keys/swarm.key',process.env.BEE_PASSWORD_FILE])if(!path||!existsSync(path))throw new Error('Restore the existing membership database and Bee identity before starting.');
}
const handler=createBackendGateway({handler:createApiHandler(),secret:process.env.POROS_PROXY_SECRET,origin:process.env.MEMBERSHIP_ORIGIN});
const server=createServer(handler);let stopping=false,stopProcesses=()=>Promise.resolve();
async function shutdown(code=0){
 if(stopping)return;stopping=true;
 const timeout=setTimeout(()=>process.exit(1),25000);timeout.unref();
 await Promise.all([stopProcesses(),new Promise(resolve=>server.close(resolve))]);process.exit(code);
}
server.requestTimeout=190000;server.headersTimeout=15000;
server.listen(Number(process.env.PORT??8080),process.env.HOST??'127.0.0.1',()=>{
 console.info('Poros persistent backend listening.');
 if(bundled&&!restored)console.info('Awaiting restored persistent data; Bee and the membership worker remain stopped.');
});
if(!bundled||restored)stopProcesses=startBackendProcesses({onFailure:()=>{console.error('A backend service stopped; restarting the deployment.');void shutdown(1);}});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void shutdown();});
