import {escape as e,short} from './core.ts';

export function transactionLink(hash:unknown,network:'arkiv'|'sepolia'='arkiv') {
  if(typeof hash!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(hash))return '';
  const explorer=network==='arkiv'?'https://rabdi.explorer.arkiv.network':'https://sepolia.etherscan.io';
  return `<a class="transaction-link" href="${explorer}/tx/${hash}" target="_blank" rel="noopener noreferrer">${e(short(hash))} ↗<span class="sr-only"> ${network} transaction details</span></a>`;
}
export type ChainClock={block:bigint;timestamp:number;duration:number;observed:number};
export function remainingLifetime(expiry:string,clock:ChainClock|undefined,now=Date.now()) {
  if(!clock||now-clock.observed>120000||!/^\d+$/.test(expiry))return 'Lifetime temporarily unavailable';
  const seconds=Math.max(0,Math.ceil((clock.timestamp+Number(BigInt(expiry)-clock.block)*clock.duration*1000-now)/1000));
  if(!Number.isSafeInteger(seconds))return 'Lifetime temporarily unavailable';
  if(seconds===0)return 'Expired — awaiting chain refresh';
  return `~${Math.floor(seconds/86400)}d ${Math.floor(seconds%86400/3600)}h ${Math.floor(seconds%3600/60)}m ${seconds%60}s remaining`;
}
export function lifetime(expiry:string,preview=false){return `<span class="community-lifetime community-timer" title="Expires at Arkiv block ${e(expiry)}" ${preview?'':`data-expiry="${e(expiry)}"`}>${preview?'Preview lifetime': 'Checking remaining lifetime…'}</span>`;}
