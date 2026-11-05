import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mountLivePrices} from '../../src/features/builder/demo/prices.js';
class Node {textContent='';children:any[]=[];handlers:any={};className='';disabled=false;append(...v:any[]){this.children.push(...v);}replaceChildren(...v:any[]){this.children=v;}addEventListener(k:string,fn:Function){this.handlers[k]=fn;}}
const pairs=[{id:'eth-usdc',base:{reference:'ETH',symbol:'WETH'},network:{name:'Base'}},{id:'btc-usdc',base:{reference:'BTC',symbol:'cbBTC'},network:{name:'Base'}}];
function setup(request:any){const list=new Node(),status=new Node();let selected='';const root={querySelector:(id:string)=>id==='#live-prices-list'?list:status,createElement:()=>new Node()};const ui=mountLivePrices({root,getPairs:()=>pairs,onSelect:(p:any)=>{selected=p.id;},request});return {ui,list,status,get selected(){return selected;}};}
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
 const list=new Node(),status=new Node();const root={querySelector:(id:string)=>id==='#live-prices-list'?list:status,createElement:()=>new Node()};
 const ui=mountLivePrices({root,getPairs:()=>pairs,request:async(url:string)=>Response.json({ok:true,data:{source:'CHAINLINK',pairId:new URL(url,'http://local').searchParams.get('pair'),stale:false,priceUsd:'2500.000000'}})});
 await ui.refresh();assert.equal(list.children[0].handlers.click,undefined);
});
