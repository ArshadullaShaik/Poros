'use client';
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import Link from 'next/link';
import {MarketActivity, MarketChart} from './market-chart';
import {createInjectedWallet} from '../src/wallet.ts';
import {historyOwner, readExecutionRuns, paperTransactions, type ExecutionRecord} from '../src/order-history.ts';
import {readPaperRuns, type PaperRun} from '../src/performance.ts';
import {pairForStrategy, tradingPairs, networks} from '../../../src/features/builder/market/config.ts';
import {mountMarketChart} from '../../../src/features/builder/demo/chart.js';
import {createExchangeFeed} from '../../../src/features/builder/demo/exchange-chart.js';
import {connectSolanaWallet} from '../../../src/features/builder/demo/solana-wallet.js';
import type {summarizeFlashFills} from '../../../src/features/builder/execution/performance.ts';

type FlashHistory = ReturnType<typeof summarizeFlashFills>;
type Chart = ReturnType<typeof mountMarketChart>;
const number = (value: number | string) => new Intl.NumberFormat('en-US',{maximumFractionDigits:8}).format(Number(value));
const modeLabel = (mode: string) => mode === 'LIVE' ? 'AI live' : mode === 'AI' ? 'AI paper' : 'Local paper';

export function OrdersWorkspace() {
  const [pairId, setPairId] = useState('eth-usdc');
  const pair = pairForStrategy(pairId);
  const pairRef = useRef(pair);
  const chartRef = useRef<Chart | undefined>(undefined);
  const rangesRef = useRef<{pairId:string;ranges:{type:'signal.price';minPriceUsd:number;maxPriceUsd:number}[]} | undefined>(undefined);
  const [owner, setOwner] = useState<string>();
  const ownerKey = historyOwner(owner);
  const [saved, setSaved] = useState<{owner: string; records: ExecutionRecord[]; legacy: PaperRun[]}>({owner:'paper',records:[],legacy:[]});
  const records = saved.owner === ownerKey ? saved.records : [];
  const [cacheError, setCacheError] = useState('');
  const [live, setLive] = useState<{owner: string; data: FlashHistory}>();
  const [liveError, setLiveError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [walletError, setWalletError] = useState('');
  const walletRef = useRef<ReturnType<typeof createInjectedWallet>>(undefined);
  const solanaEvents = useRef<(() => void) | undefined>(undefined);
  const connectionGeneration = useRef(0);

  useEffect(() => {
    try {
      const selected = new URLSearchParams(location.search).get('pair') ?? sessionStorage.getItem('poros.orders.market');
      if (selected) setPairId(pairForStrategy(selected).id);
    } catch { /* A missing or invalid preference uses the default market. */ }
  }, []);

  useLayoutEffect(() => {
    const chart = mountMarketChart({historyFeed:createExchangeFeed(),getPair:()=>pairRef.current,getDraft:()=>({nodes:rangesRef.current?.pairId===pairRef.current.id?rangesRef.current.ranges:[]})});
    chartRef.current = chart;
    void chart.preload();
    void chart.refresh();
    const timer = setInterval(() => {if (!document.hidden) void chart.refresh();},5000);
    const visible = () => {if (!document.hidden) void chart.refresh();};
    document.addEventListener('visibilitychange',visible);
    return () => {clearInterval(timer);document.removeEventListener('visibilitychange',visible);chart.stop();chartRef.current=undefined;};
  }, []);

  useEffect(() => {
    const receive = (event: Event) => {
      const data=(event as CustomEvent).detail;
      if (!data || typeof data.pairId!=='string' || !Array.isArray(data.ranges) || data.ranges.length>100 ||
          !data.ranges.every((range:any)=>range?.type==='signal.price' && Number.isFinite(range.minPriceUsd) && Number.isFinite(range.maxPriceUsd) && range.minPriceUsd>0 && range.maxPriceUsd>=range.minPriceUsd)) return;
      try {pairForStrategy(data.pairId);} catch {return;}
      rangesRef.current=data;
      chartRef.current?.draftChanged();
    };
    window.addEventListener('poros:strategy-chart',receive);
    window.dispatchEvent(new Event('poros:request-strategy-chart'));
    return () => window.removeEventListener('poros:strategy-chart',receive);
  }, []);

  useEffect(() => {
    pairRef.current = pair;
    chartRef.current?.draftChanged();
    try {sessionStorage.setItem('poros.orders.market',pair.id);} catch { /* Preference storage is optional. */ }
  }, [pair]);

  useEffect(() => {
    const generation = ++connectionGeneration.current;
    solanaEvents.current?.();
    solanaEvents.current = undefined;
    setOwner(undefined);
    setWalletError('');
    if (pair.network.family === 'solana') return;
    const wallet = createInjectedWallet();
    walletRef.current = wallet;
    let active = true;
    const read = async () => {
      let account: string | undefined;
      try {account=(await wallet?.getContext())?.account;} catch { /* A locked wallet remains disconnected. */ }
      if (active && generation===connectionGeneration.current) setOwner(account);
    };
    const unsubscribe = wallet?.subscribe(() => {setOwner(undefined);void read();});
    void read();
    return () => {active=false;unsubscribe?.();};
  }, [pair.network.family]);

  useEffect(() => () => {connectionGeneration.current++;solanaEvents.current?.();}, []);

  async function connect() {
    const generation = connectionGeneration.current;
    setWalletError('');
    try {
      if (pair.network.family === 'solana') {
        const connection = await connectSolanaWallet();
        if (generation!==connectionGeneration.current) return;
        setOwner(connection.address);
        solanaEvents.current?.();
        solanaEvents.current=connection.wallet.features['standard:events']?.on('change',()=>setOwner(undefined));
      } else {
        const wallet = walletRef.current;
        if (!wallet) throw new Error('Open Orders in a browser with MetaMask installed.');
        await wallet.connect();
        const context = await wallet.getContext();
        if (generation===connectionGeneration.current) setOwner(context.account);
      }
    } catch (error) {
      if (generation===connectionGeneration.current) setWalletError(error instanceof Error ? error.message : 'Wallet connection could not finish.');
    }
  }

  useEffect(() => {
    const read = () => {
      try {
        const records=readExecutionRuns(localStorage,owner);
        const legacy=owner?.startsWith('0x')?readPaperRuns(localStorage,owner):[];
        setSaved({owner:ownerKey,records,legacy});setCacheError('');
      } catch {setSaved({owner:ownerKey,records:[],legacy:[]});setCacheError('Saved execution receipts could not be read in this browser.');}
    };
    const storage = (event: StorageEvent) => {if (event.key?.startsWith('poros.execution-history.v1.')) read();};
    read();
    window.addEventListener('poros:execution-updated',read);
    window.addEventListener('storage',storage);
    return () => {window.removeEventListener('poros:execution-updated',read);window.removeEventListener('storage',storage);};
  }, [owner,ownerKey,refresh]);

  useEffect(() => {
    if (!owner) {setLive(undefined);setLiveError('');setLoading(false);return;}
    const controller = new AbortController();
    let pending = false;
    setLiveError('');
    const read = async () => {
      if (pending || document.hidden) return;
      pending=true;setLoading(true);
      try {
        const response=await fetch('/api/performance?wallet='+encodeURIComponent(owner),{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(50000)])});
        const payload=await response.json();
        if (!response.ok || !payload.ok || !Array.isArray(payload.data?.transactions) || typeof payload.data.complete!=='boolean') throw new Error('Invalid fill history');
        if (!controller.signal.aborted) {setLive({owner:ownerKey,data:payload.data});setLiveError('');}
      } catch {
        if (!controller.signal.aborted) setLiveError('Live fills could not be verified. Refresh to try again.');
      } finally {
        if (!controller.signal.aborted) {pending=false;setLoading(false);}
      }
    };
    void read();
    const timer=setInterval(()=>{void read();},30000);
    const visible=()=>{if(!document.hidden)void read();};
    document.addEventListener('visibilitychange',visible);
    return ()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
  }, [owner,ownerKey,refresh]);

  useEffect(() => {
    const chart=chartRef.current;
    if (!chart) return;
    chart.resetActivity();
    for (const record of [...records].filter(item=>item.pairId===pairId).sort((a,b)=>a.updatedAt-b.updatedAt)) {
      chart.activity({kind:'snapshot',pairId,time:record.updatedAt,data:{...record,mode:record.agentMode==='LIVE'?'LIVE':'PAPER',pair:{id:pairId},message:modeLabel(record.agentMode)+' · '+record.status.toLowerCase().replaceAll('_',' ')}});
    }
  }, [saved,ownerKey,pairId]);

  const verified=live?.owner===ownerKey?live.data:undefined;
  const paper=paperTransactions(records);
  const liveOrders=new Map(records.flatMap(record=>record.liveOrders.map(order=>[order.orderId,{record,order}] as const)));
  const fills=verified?.transactions??[];
  const filledIds=new Set(fills.map(fill=>fill.orderId));
  const detailedIds=new Set(records.map(record=>record.id));
  const legacy=saved.owner===ownerKey?saved.legacy.filter(record=>!detailedIds.has(record.id)):[];
  const rows=[
    ...legacy.map(run=>({key:'legacy:'+run.id,time:run.updatedAt,market:run.pair,chain:'—',side:'—',mode:'Paper run total',quantity:null,value:null,currency:'USD',fee:null,pnl:run.realizedPnl,status:run.fills+' fills · summary',reference:run.id})),
    ...paper.map(fill=>{
      const market=pairForStrategy(fill.pairId);
      return {key:fill.runId+':'+fill.actionId+':'+fill.filledAtMs,time:fill.filledAtMs,market:market.label,chain:market.network.name,side:fill.side,mode:modeLabel(fill.agentMode),quantity:fill.baseQuantity,value:fill.notionalUsd,currency:'USD',fee:fill.feeUsd,pnl:fill.realizedPnl,status:'Paper fill',reference:fill.runId};
    }),
    ...fills.map(fill=>({key:fill.orderId+':'+fill.transactionId,time:fill.filledAt,market:fill.market,chain:fill.chain,side:fill.side,mode:liveOrders.has(fill.orderId)?'AI live':'Wallet',quantity:fill.quantity,value:fill.value,currency:fill.currency,fee:fill.feeUsd,pnl:fill.realizedPnl,status:'Finalized',reference:fill.transactionId})),
    ...[...liveOrders.values()].filter(item=>!filledIds.has(item.order.orderId)).map(({record,order})=>({key:order.orderId,time:order.submittedAtMs,market:pairForStrategy(record.pairId).label,chain:pairForStrategy(record.pairId).network.name,side:order.side,mode:'AI live',quantity:null,value:order.notionalUsd,currency:'USD',fee:null,pnl:null,status:order.status==='ORDER_STATUS_FILLED'?'Awaiting verified fill':order.status.replace('ORDER_STATUS_','').toLowerCase(),reference:order.orderId})),
  ].sort((a,b)=>b.time-a.time);

  return <main className="orders-page">
    <div className="page-heading">
      <div>
        <h1>Orders</h1>
      </div>
      <Link className="button secondary" href="/">Back to Trade</Link>
    </div>
    <div className="orders-toolbar">
      <label className="field orders-market">
        <span>Chart market</span>
        <select value={pairId} onChange={event=>setPairId(event.target.value)}>
          {Object.values(networks).map(network=><optgroup key={network.key} label={network.name}>
            {tradingPairs.filter(item=>item.network.key===network.key).map(item=><option key={item.id} value={item.id}>{item.label}</option>)}
          </optgroup>)}
        </select>
      </label>
      <div className="heading-actions">
        <button className="button secondary" type="button" onClick={()=>setRefresh(value=>value+1)} disabled={loading}>
          {loading?'Checking fills…':'Refresh history'}
        </button>
        <button className="button secondary" type="button" onClick={()=>{void connect();}}>
          {owner?owner.slice(0,7)+'…'+owner.slice(-5):'Connect wallet'}
        </button>
      </div>
    </div>
    {walletError && <p role="alert">{walletError}</p>}
    <div className="orders-data">
    <MarketChart/>
    <MarketActivity/>
    <section className="orders-history" aria-labelledby="orders-history-title">
      <h2 id="orders-history-title">Transaction history</h2>
      <details className="history-method"><summary>How history is calculated</summary><p>AI attribution and paper fills use the last 100 runs saved in this browser. Older paper records show run totals. Live P/L uses finalized Flash fills and average cost. Reported fees appear separately. Gas is excluded.</p></details>
      {!owner && <p className="muted">Connect a wallet for live fills. Paper orders are saved in this browser.</p>}
      {cacheError && <p role="alert">{cacheError}</p>}
      {liveError && <p role="alert">{liveError}</p>}
      {verified && !verified.complete && <p role="status">Older Flash orders exist. Profit and loss is withheld where the cost basis is incomplete.</p>}
      {rows.length>100 && <p className="muted">Showing the latest 100 entries.</p>}
      {rows.length ? <div className="orders-table-wrap">
        <table>
          <thead><tr>
            <th>Time</th><th>Market</th><th>Side</th><th>Execution</th><th>Status</th>
            <th>Quantity</th><th>Value</th><th>Fees (USD)</th><th>Realized P/L</th><th>Reference</th>
          </tr></thead>
          <tbody>{rows.slice(0,100).map(row=><tr key={row.key}>
            <td>{new Date(row.time).toLocaleString()}</td>
            <td>{row.market}<small>{row.chain}</small></td>
            <td>{row.side}</td>
            <td>{row.mode}</td>
            <td>{row.status}</td>
            <td>{row.quantity===null?'—':number(row.quantity)}</td>
            <td>{row.value===null?'—':number(row.value)+' '+row.currency}</td>
            <td>{row.fee===null?'—':number(row.fee)}</td>
            <td className={row.pnl===null?'':Number(row.pnl)<0?'loss':'profit'}>
              {row.pnl===null?row.side==='BUY'?'No realized P/L':'Awaiting cost basis':number(row.pnl)+' '+row.currency}
            </td>
            <td><code title={row.reference}>{row.reference.slice(0,8)}…{row.reference.slice(-5)}</code></td>
          </tr>)}</tbody>
        </table>
      </div> : <p>{loading?'Reading finalized fills…':'Run a strategy to see its orders here.'}</p>}
    </section>
    </div>
  </main>;
}
