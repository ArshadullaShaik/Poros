import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createApiHandler} from '../../src/features/builder/server/api.mjs';
import {moderateCommunityText} from '../../src/features/builder/ai/moderation.ts';
const key='sk-test-only-not-a-real-key';
let output:unknown={allowed:true};
const fetcher:any=async(url:string)=>Response.json(url.endsWith('/models')?{data:[{
 id:'qwen3.7-flash',type:'chatbot',provider_count:1,context_length:32768,max_completion_tokens:4096,
 architecture:{input_modalities:['text'],output_modalities:['text']},supported_formats:['openai'],
 supported_parameters:['max_tokens','tools','response_format'],pricing:{prompt:'100',completion:'200'},pricing_usd:{prompt:'0.00000002',completion:'0.00000004'}
}]}:{model:'qwen3.7-flash',choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]});
test('0G moderation accepts only explicit boolean verdicts and validates input',async()=>{
 output={allowed:true};assert.equal(await moderateCommunityText(key,'public strategy',undefined,fetcher),true);
 output={allowed:false};assert.equal(await moderateCommunityText(key,'blocked text',undefined,fetcher),false);
 for(const bad of [{allowed:'true'},{allowed:true,extra:1},null,{}]){
 output=bad;await assert.rejects(moderateCommunityText(key,'text',undefined,fetcher),{code:'INVALID_OUTPUT'});
 }
 for(const bad of ['',null,'a'.repeat(12001)])await assert.rejects(moderateCommunityText(key,bad,undefined,fetcher),{code:'INVALID_INPUT'});
});
test('moderation API requires the browser credential and same-origin JSON requests',async()=>{
 output={allowed:true};
 const handler=createApiHandler({fetcher});const server=createServer(handler);
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+(server.address() as any).port;
 const post=(headers:Record<string,string>)=>fetch(base+'/api/community-moderation',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({text:'strategy'})});
 try{
 assert.equal((await post({})).status,401);
 assert.equal((await post({Authorization:'Bearer '+key,Origin:'https://evil.example'})).status,403);
 const response=await post({Authorization:'Bearer '+key,Origin:base});assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{ok:true,data:{allowed:true}});
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
