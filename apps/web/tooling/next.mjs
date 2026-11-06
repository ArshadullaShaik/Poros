import {loadEnvFile} from 'node:process';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
try { loadEnvFile(fileURLToPath(new URL('../../../.env.local', import.meta.url))); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const command = process.argv[2] ?? 'dev';
if (!['dev', 'build', 'start'].includes(command)) throw new Error('Expected dev, build, or start.');
const args = [fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)), command];
if (command !== 'start') args.push('--webpack');
if (command !== 'build') args.push('--hostname', '127.0.0.1', '--port', process.env.PORT ?? '4325');
const child = spawn(process.execPath, args, {cwd: fileURLToPath(new URL('../', import.meta.url)), env: process.env, stdio: 'inherit', windowsHide: true});
const worker=command!=='build'&&process.env.MEMBERSHIP_RELAY_PRIVATE_KEY?spawn(process.execPath,[fileURLToPath(new URL('./membership-worker.mjs',import.meta.url))],{env:process.env,stdio:'inherit',windowsHide:true}):undefined;
worker?.on('error',error=>console.error('Membership worker: '+error.message));
worker?.on('exit',code=>{if(code)console.error('Membership worker stopped; automatic activation is unavailable.');});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {child.kill(signal);worker?.kill(signal);});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { worker?.kill('SIGTERM'); process.exitCode = code ?? 1; });
