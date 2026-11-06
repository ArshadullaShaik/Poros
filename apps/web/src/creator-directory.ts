import type {Hex} from 'viem';
import type {ArkivStore} from '../../../src/integrations/arkiv/contracts.ts';
import type {CreatorMemberships} from '../../../src/integrations/arkiv/community/memberships.ts';
import type {CommunityHub} from '../../../src/integrations/arkiv/community/service.ts';
import type {EventRepository} from '../../../src/integrations/arkiv/community/contracts.ts';
import {escape as e,short,formatAmount} from './core.ts';

export type Creator = {wallet:Hex;name:string;strategies:number;posts:number;priceWei?:string};
export async function readCreatorDirectory(strategies: Pick<ArkivStore,'listStrategies'>, memberships: Pick<CreatorMemberships,'plans'>, community: Pick<CommunityHub,'getProfile'|'listThreads'>, events:Pick<EventRepository,'scan'>) {
  const [plans,threads] = await Promise.all([memberships.plans(),events.scan({type:'thread'})]);
  const creators = new Map<Hex,Creator>();
  const creator = (wallet:Hex) => {
    if(!creators.has(wallet))creators.set(wallet,{wallet,name:short(wallet),strategies:0,posts:0});
    return creators.get(wallet)!;
  };
  for(const plan of plans)creator(plan.actor).priceWei=String(plan.data.priceWei);
  const seen=new Set<string>();
  let offset:number|null=0,skipped=0;
  // shortcut: bounded discovery for the local demo; add indexed pagination when the directory grows.
  for(let page=0;page<5&&offset!==null;page++) {
    const result=await strategies.listStrategies({page:{offset,limit:20}});
    for(const row of result.items)if(!seen.has(row.rootVersionKey)) {
      seen.add(row.rootVersionKey);creator(row.creator).strategies++;
    }
    skipped+=result.skipped;
    if(result.nextOffset!==null&&result.nextOffset<=offset)throw new Error('Creator discovery did not advance. Try refreshing.');
    offset=result.nextOffset;
  }
  const rooms=[...new Set(threads.map(row=>row.scope))];
  let partial=offset!==null||skipped>0||rooms.length>20;
  for(let i=0;i<Math.min(rooms.length,20);i+=4)await Promise.all(rooms.slice(i,Math.min(i+4,20)).map(async room=>{
    try {
      const visible=await community.listThreads({communityKey:room as Hex});
      for(const post of visible)creator(post.actor).posts++;
    } catch { partial=true; }
  }));
  const rows=[...creators.values()].sort((a,b)=>b.strategies-a.strategies||b.posts-a.posts||a.wallet.localeCompare(b.wallet)).slice(0,20);
  for(let i=0;i<rows.length;i+=4)await Promise.all(rows.slice(i,i+4).map(async row=>{
    try {const profile=await community.getProfile({wallet:row.wallet});if(profile)row.name=profile.displayName+' (@'+profile.handle+')';}
    catch { /* The wallet remains the verified identity if its profile is unavailable. */ }
  }));
  return {rows,partial:partial||creators.size>rows.length};
}

type MarketResult = {marketId:string;market:string;chain:string;currency:string;realizedPnl:string|null;sells:number;eligibleForRanking?:boolean};
export type CreatorResult = {creator:Creator;complete:boolean;markets:MarketResult[];error?:string};
function units(value:string) {
  if(!/^-?\d{1,36}(?:\.\d{1,36})?$/.test(value))throw new Error('Invalid profit amount.');
  const [whole,fraction='']=value.replace('-','').split('.');
  return BigInt(whole+fraction.padEnd(36,'0'))*(value.startsWith('-')?-1n:1n);
}
export function rankCreators(results:CreatorResult[],marketId:string) {
  return results.flatMap(result=>{
    const market=result.markets.find(row=>row.marketId===marketId);
    if(result.error||!result.complete||!market||market.realizedPnl===null||market.sells<1||market.eligibleForRanking===false)return [];
    return [{...result.creator,profit:market.realizedPnl,amount:units(market.realizedPnl),sells:market.sells}];
  }).sort((a,b)=>a.amount===b.amount?b.strategies-a.strategies||b.posts-a.posts||a.wallet.localeCompare(b.wallet):a.amount>b.amount?-1:1);
}

export function creatorCard(row:Creator) {
  return `<article class="creator-discovery-card"><strong>${e(row.name)}</strong><small>${e(short(row.wallet))} · ${row.strategies} public strategies · ${row.posts} community posts</small><p>${row.priceWei?e(formatAmount(row.priceWei,18))+' Sepolia ETH / 30 days':'Membership not offered yet'}</p><a class="button secondary" href="/community#/profile/${row.wallet}">Profile</a> ${row.priceWei?`<a class="button primary" href="/community#/memberships?creator=${row.wallet}">Subscribe / renew</a>`:''}</article>`;
}

export function mountCreatorDirectory(root:HTMLElement,load:()=>Promise<Awaited<ReturnType<typeof readCreatorDirectory>>>,compact=false) {
  let disposed=false,busy=false,rows:Creator[]=[],results:CreatorResult[]=[];
  const controller=new AbortController();
  root.innerHTML=compact
    ? `<div class="membership-toolbar compact"><a class="button secondary" href="/community#/creator">Become a creator / Dashboard</a><a class="button secondary" href="/community#/creators">Leaderboard &amp; discovery ↗</a><button type="button" class="button secondary" data-directory-refresh>Refresh list</button></div><p data-directory-status class="small muted" role="status"></p><div data-creator-cards class="creator-directory"></div>`
    : `<div class="membership-toolbar"><a class="button primary" href="/community#/creator">Become a creator / Dashboard</a><a class="button secondary" href="/community#/memberships">My subscriptions</a><button type="button" class="button secondary" data-directory-refresh>Refresh creators</button></div><p>Anyone can publish a membership. Public strategy activity helps readers discover you; verified results determine profit rank.</p><p data-directory-status role="status"></p><div data-creator-cards class="creator-directory"></div><section class="paper-panel"><h2>Profit leaderboard</h2><p>Verified Arkiv fills, ranked separately for each market and network. Higher gross realized P/L ranks first; public strategy count, then community post count, break ties. Paper results and self-reported profits never count.</p><button type="button" class="button secondary" data-profit-load disabled>Load verified profits</button><p data-profit-status role="status">Load on demand to keep browsing fast.</p><label class="field"><span>Compare a market</span><select data-profit-market disabled><option>No verified results loaded</option></select></label><div data-profit-table></div><p class="muted">Ranks compare only verified creators loaded in this directory. Linked-source Arkiv history; incomplete history or missing cost basis is unranked. Fees are reported separately in profiles; gas, external trades and open-position gains are excluded. Results cover available history, not a fixed contest period or proof that a posted strategy caused the profit.</p></section>`;
  const status=root.querySelector<HTMLElement>('[data-directory-status]')!;
  const refresh=root.querySelector<HTMLButtonElement>('[data-directory-refresh]')!;
  const profit=root.querySelector<HTMLButtonElement>('[data-profit-load]');
  const market=root.querySelector<HTMLSelectElement>('[data-profit-market]');
  const profitStatus=root.querySelector<HTMLElement>('[data-profit-status]');
  function renderRanking() {
    if(!market)return;
    const ranked=rankCreators(results,market.value);
    root.querySelector('[data-profit-table]')!.innerHTML=ranked.length?`<div class="profile-table-wrap"><table class="profile-table"><thead><tr><th>Rank</th><th>Creator</th><th>Realized P/L</th><th>Public strategies</th><th>Matched sells</th></tr></thead><tbody>${ranked.map((row,i)=>`<tr><td>${i+1}</td><td><a href="/community#/profile/${row.wallet}">${e(row.name)}</a></td><td>${e(row.profit)} ${e(results.flatMap(r=>r.markets).find(m=>m.marketId===market.value)?.currency)}</td><td>${row.strategies}</td><td>${row.sells}</td></tr>`).join('')}</tbody></table></div>`:'<p>No ranked results to display.</p>';
  }
  async function refreshDirectory() {
    if(disposed||busy)return;busy=true;refresh.disabled=true;if(profit)profit.disabled=true;
    status.textContent='Reading public creator activity…';
    try {
      const result=await load();if(disposed)return;
      rows=result.rows;results=[];
      root.querySelector('[data-creator-cards]')!.innerHTML=rows.map(creatorCard).join('')||'<p>No published strategies or creator plans yet. Become the first creator.</p>';
      status.textContent=`${rows.length} creators shown. ${result.partial?'Partial directory: up to 100 strategy records, 20 communities and 20 creators; counts and ranks cover loaded records only.':'Activity counts cover available public strategy roots and forks; revisions are not counted twice.'} Expired Arkiv records are not lifetime activity. Community posts include written strategies and discussions; they are shown separately from validated strategies.`;
      if(market){market.innerHTML='<option>No verified results loaded</option>';market.disabled=true;renderRanking();}
      if(profitStatus)profitStatus.textContent='Load on demand to keep browsing fast.';
    } catch {status.textContent='Creator discovery is unavailable. Refresh to try again.';}
    finally {busy=false;if(!disposed){refresh.disabled=false;if(profit)profit.disabled=!rows.length;}}
  }
  async function loadProfits() {
    if(disposed||busy||!profit||!market||!profitStatus)return;
    busy=true;profit.disabled=true;refresh.disabled=true;results=[];market.disabled=true;
    root.querySelector('[data-profit-table]')!.textContent='Checking finalized fills…';
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(120000)]);
    for(const creator of rows) {
      if(signal.aborted)break;
      profitStatus.textContent=`Checking ${results.length+1} of ${rows.length}: ${creator.name}…`;
      try {
        const response=await fetch('/api/trade-history/report?trader='+encodeURIComponent(creator.wallet),{cache:'no-store',signal});
        if(!response.ok)throw new Error('History unavailable');
        const payload=await response.json(),data=payload.data;
        if(!payload.ok||data?.provenance!=='arkiv'||typeof data?.complete!=='boolean'||!Array.isArray(data.markets)||data.markets.some((row:MarketResult)=>typeof row.marketId!=='string'||typeof row.market!=='string'||typeof row.chain!=='string'||typeof row.currency!=='string'||!Number.isSafeInteger(row.sells)||row.sells<0||row.realizedPnl!==null&&typeof row.realizedPnl!=='string'))throw new Error('Invalid history');
        for(const row of data.markets)if(row.realizedPnl!==null)units(row.realizedPnl);
        results.push({creator,complete:data.complete,markets:data.markets});
      } catch {results.push({creator,complete:false,markets:[],error:'History unavailable'});}
      if(disposed)return;
    }
    if(disposed)return;
    const markets=new Map(results.flatMap(result=>result.markets).map(row=>[row.marketId,row]));
    market.innerHTML=markets.size?[...markets].map(([id,row])=>`<option value="${e(id)}">${e(row.chain)} · ${e(row.market)}</option>`).join(''):'<option>No markets available</option>';
    market.disabled=!markets.size;renderRanking();
    profitStatus.textContent=`Checked ${results.length}/${rows.length} creators at ${new Date().toLocaleTimeString()}. ${results.filter(row=>row.error).length} unavailable; ${results.filter(row=>!row.error&&!row.complete).length} incomplete histories. Missing results are excluded, not treated as zero profit.`;
    busy=false;profit.disabled=false;refresh.disabled=false;
  }
  refresh.addEventListener('click',refreshDirectory);
  profit?.addEventListener('click',loadProfits);market?.addEventListener('change',renderRanking);
  void refreshDirectory();
  return {dispose(){disposed=true;controller.abort();refresh.removeEventListener('click',refreshDirectory);profit?.removeEventListener('click',loadProfits);market?.removeEventListener('change',renderRanking);}};
}
