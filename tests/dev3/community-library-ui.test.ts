import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mountCommunityLibrary} from '../../src/features/builder/demo/community.js';
class Node {textContent='';children:any[]=[];handlers:any={};disabled=false;hidden=false;append(...v:any[]){this.children.push(...v);}replaceChildren(...v:any[]){this.children=v;}addEventListener(k:string,f:Function){this.handlers[k]=f;}}
const versionKey='0x'+'1'.repeat(64),communityKey='0x'+'2'.repeat(64);
function setup(api:any){const controls=new Map(['community-library-title','back-to-communities','community-page-link','community-strategies','community-strategies-status','refresh-community-strategies','more-community-strategies'].map(id=>[id,new Node()]));let loaded:any;const ui=mountCommunityLibrary({root:{querySelector:(id:string)=>controls.get(id.slice(1)),createElement:()=>new Node()},loadApi:async()=>({publicStrategies:api}),onLoad:(graph:any)=>{loaded=graph;}});return {ui,controls,get loaded(){return loaded;}};}
test('community sidebar loads actual communities, then only strategies in the selected community',async()=>{
 let filter:any;
 const s=setup({listCommunities:async()=>({items:[{name:'Trading room',communityKey}],nextOffset:null}),listStrategies:async(input:any)=>{filter=input;return {items:[{name:'Public rules',rootVersionKey:versionKey,communityKey}],nextOffset:null};},getVersion:async()=>({document:{graph:{name:'Rules'}}})});await s.ui.refresh();
 const room=s.controls.get('community-strategies')!.children[0];assert.equal(room.draggable,false);assert.equal(room.children[0].textContent,'Trading room');await room.handlers.click();assert.equal(filter.communityKey,communityKey);
 const card=s.controls.get('community-strategies')!.children[0];assert.equal(card.draggable,true);await card.handlers.click();assert.equal(s.loaded.name,'Rules');
 s.controls.get('back-to-communities')!.handlers.click();await new Promise(resolve=>setImmediate(resolve));assert.equal(s.controls.get('community-strategies')!.children[0].children[0].textContent,'Trading room');
});
test('unavailable community data stays an explicit error and does not invent cards',async()=>{
 const s=setup({listCommunities:async()=>{throw new Error('Network unavailable');}});await s.ui.refresh();assert.equal(s.controls.get('community-strategies')!.children.length,0);assert.match(s.controls.get('community-strategies-status')!.textContent,/Network unavailable/);
});
