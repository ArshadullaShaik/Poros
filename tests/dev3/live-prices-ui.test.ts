import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mountLivePrices} from '../../src/features/builder/demo/prices.js';
class Node {
 textContent='';children:Node[]=[];handlers:Record<string,Function>={};className='';disabled=false;
 attributes=new Map<string,string>();
 append(...values:Node[]){this.children.push(...values);}
 replaceChildren(...values:Node[]){this.children=values;}
 addEventListener(event:string,handler:Function){this.handlers[event]=handler;}
 getAttribute(name:string){return this.attributes.get(name)??null;}
 setAttribute(name:string,value:string){this.attributes.set(name,value);}
 cloneNode(){const copy=new Node();copy.textContent=this.textContent;copy.className=this.className;copy.children=this.children.map(child=>child.cloneNode());return copy;}
}
const pairs=[{id:'eth-usdc',base:{reference:'ETH',symbol:'WETH'},network:{name:'Base'}},{id:'btc-usdc',base:{reference:'BTC',symbol:'cbBTC'},network:{name:'Base'}}];
function setup(request:any){const list=new Node(),status=new Node();let selected='';const root={querySelector:(id:string)=>id==='#live-prices-list'?list:id==='#live-prices-status'?status:null,createElement:()=>new Node()};const ui=mountLivePrices({root,getPairs:()=>pairs,onSelect:(p:any)=>{selected=p.id;},request});return {ui,list,status,get selected(){return selected;}};}
test('live watchlist shows actual prices and lets a price row select its market',async()=>{
 const s=setup(async(url:string)=>{const id=new URL(url,'http://local').searchParams.get('pair');return Response.json({ok:true,data:{source:'CHAINLINK',pairId:id,stale:false,priceUsd:id==='eth-usdc'?'2500.000000':'75000.000000'}});});
 await s.ui.refresh();assert.equal(s.list.children.length,2);assert.match(s.list.children[0].children[1].textContent,/2,500/);assert.match(s.status.textContent,/Updated/);
 s.list.children[1].handlers.click();assert.equal(s.selected,'btc-usdc');
});
test('stale, mismatched and failed prices show unavailable rather than stale or fabricated values',async()=>{
 for(const response of [Response.json({ok:true,data:{source:'CHAINLINK',pairId:'wrong',stale:false,priceUsd:'9999.000000'}}),Response.json({ok:true,data:{source:'CHAINLINK',pairId:'eth-usdc',stale:true,priceUsd:'9999.000000'}}),Response.json({ok:false},{status:503})]){
  const s=setup(async()=>response.clone());await s.ui.refresh();assert.equal(s.list.children[0].children[1].textContent,'Unavailable');
 }
});

test('prices can be displayed read-only without offering a market switch',async()=>{
 const list=new Node(),status=new Node();const root={querySelector:(id:string)=>id==='#live-prices-list'?list:id==='#live-prices-status'?status:null,createElement:()=>new Node()};
 const ui=mountLivePrices({root,getPairs:()=>pairs,request:async(url:string)=>Response.json({ok:true,data:{source:'CHAINLINK',pairId:new URL(url,'http://local').searchParams.get('pair'),stale:false,priceUsd:'2500.000000'}})});
 await ui.refresh();assert.equal(list.children[0].handlers.click,undefined);
});

test('ticker refresh keeps its rows and updates both copies while scrolling can be paused',async()=>{
 const list=new Node(),copy=new Node(),status=new Node(),pause=new Node();
 let paused=false,price='2500.000000';
 const ticker={classList:{toggle(_name:string,value:boolean){paused=value;}}};
 const nodes={'#live-prices-list':list,'#live-prices-copy':copy,'#live-prices-status':status,'#live-prices-pause':pause};
 const root={querySelector:(id:keyof typeof nodes)=>nodes[id]??null,createElement:()=>new Node()};
 Object.assign(list,{closest:()=>ticker});
 const ui=mountLivePrices({root,getPairs:()=>pairs,request:async(url:string)=>Response.json({ok:true,data:{source:'CHAINLINK',pairId:new URL(url,'http://local').searchParams.get('pair'),stale:false,priceUsd:price}})});
 await ui.refresh();const row=list.children[0];
 assert.equal(copy.children.length,2);assert.match(copy.children[0]!.children[1]!.textContent,/2,500/);
 price='2600.000000';await ui.refresh();
 assert.equal(list.children[0],row);assert.match(copy.children[0]!.children[1]!.textContent,/2,600/);
 pause.handlers.click!();assert.equal(paused,true);assert.equal(pause.getAttribute('aria-pressed'),'true');assert.equal(pause.textContent,'Resume scrolling');
 pause.handlers.click!();assert.equal(paused,false);assert.equal(pause.textContent,'Pause scrolling');
});
