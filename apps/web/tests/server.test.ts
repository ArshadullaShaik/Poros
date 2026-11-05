import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('one origin serves builder and community with isolated assets and private files',async()=>{
  const child=spawn(process.execPath,['tooling/server.mjs'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',chunk=>{stderr+=String(chunk);});
  try{
    const base=await new Promise<string>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Static host did not start')),20000);let output='';child.stdout.on('data',chunk=>{output+=String(chunk);const found=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(found){clearTimeout(timeout);resolve(found[0]);}});child.on('error',reject);child.on('exit',code=>{clearTimeout(timeout);reject(new Error('Static host stopped: '+code+' '+stderr));});});
    const home=await fetch(base);assert.equal(home.status,200);const homeHtml=await home.text();assert.match(homeHtml,/Poros.*Strategy builder/);
    assert.doesNotMatch(homeHtml,/community-marquee|execution-workspace/);
    assert.match(homeHtml,/href="\/community">Communities/);
    assert.match(homeHtml,/href="\/home">Home/);assert.match(homeHtml,/href="\/profile">Profile/);
    for(const path of ['/home','/profile','/0g-pot'])assert.equal((await fetch(base+path)).status,200);
    assert.equal((await fetch(base+'/community/builder.js')).status,200);
    const community=await fetch(base+'/community');assert.equal(community.status,200);assert.match(await community.text(),/Poros Community/);
    const script=await fetch(base+'/community/app.js');assert.match(script.headers.get('content-type')!,/javascript/);assert.equal(script.headers.get('cache-control'),'no-store');
    const bundle=await script.text();assert.doesNotMatch(bundle,/Find your next idea/);assert.match(bundle,/Membership income/);assert.doesNotMatch(bundle,/node:sqlite|createWalletAuth|openMarketplace|diagnostic-private|Weekly accumulation/);
    assert.equal((await fetch(base+'/api/community-marketplace/orders')).status,404);
    assert.equal((await fetch(base+'/api/community-marketplace/orders',{method:'POST'})).status,405);
    assert.equal((await fetch(base+'/.env')).status,404);assert.equal((await fetch(base+'/vault.sqlite')).status,404);
    assert.equal((await fetch(base+'/src/main.ts')).status,404);
  }finally{child.kill();}
});
