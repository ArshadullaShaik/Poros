import {buildTradeRecord} from '../../src/integrations/arkiv/trade-contracts.ts';
export const trader = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
export const source = {kind:'flash' as const,sourceId:'flash:'+trader,wallet:trader,chainFamily:'evm' as const};
export function detail(side='buy',id='buy',qty='2',value='100',time='2026-11-01T00:00:00Z') {
 const asset=(address:string,ticker:string)=>({address,ticker,chain:{id:'8453',namespace:'eip155',name:'Base'}});
 return {order:{orderId:id,status:'ORDER_STATUS_CANCELLED',funderAddress:trader,recipientAddress:trader,side,targetAsset:asset('0x'+'1'.repeat(40),'ETH'),contraAsset:asset('0x'+'2'.repeat(40),'USDC')},fills:[{rootOrderId:id,orderId:id+'-fill',transactionId:'0x'+'3'.repeat(64),status:'CHAIN_STATUS_FINALIZED',filledAt:time,targetAmount:qty,contraAmount:value,feeNotional:'0.1'}]};
}

export function repository(){
 const entries:any[]=[];let loseResponse=false;
 return {entries,set loseResponse(v:boolean){loseResponse=v;},
  async append(input:any){const r=buildTradeRecord(input),old=entries.find(e=>e.identity===r.identity);if(old){if(old.recordHash!==r.recordHash)throw new Error('conflict');return old;}
   const entry={...r,entityKey:'0x'+String(entries.length+1).padStart(64,'0'),expiresAtBlock:'9999999'};entries.push(entry);if(loseResponse){loseResponse=false;throw new Error('Lost response');}return entry;},
  async find(id:string){return entries.filter(e=>e.identity===id);},async list(){return {items:entries};},async renew(id:string){return entries.find(e=>e.entityKey===id);},async read(id:string){return entries.find(e=>e.entityKey===id);},
 };
}
