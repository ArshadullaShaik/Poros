import {pairForStrategy} from '../../../src/features/builder/market/config.ts';
import {paperPosition} from '../../../src/features/builder/demo/chart.js';

export interface PaperFill {
  actionId: string;
  side: 'BUY' | 'SELL';
  notionalUsd: string;
  baseQuantity: string;
  feeUsd: string;
  priceUsd: string;
  filledAtMs: number;
}
export interface LiveOrder {
  orderId: string;
  side: 'BUY' | 'SELL';
  notionalUsd: string;
  status: string;
  submittedAtMs: number;
}
export interface ExecutionRecord {
  id: string;
  pairId: string;
  agentMode: 'AI' | 'RULES_ONLY' | 'LIVE';
  status: string;
  updatedAt: number;
  inferenceCount: number;
  orders: PaperFill[];
  liveOrders: LiveOrder[];
}
const prefix = 'poros.execution-history.v1.';
const maxBytes = 2000000;
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128;
const timestamp = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const amount = (value: unknown, zero = false): value is string => typeof value === 'string' && /^\d{1,18}(?:\.\d{1,36})?$/.test(value) && Number.isFinite(Number(value)) && (zero ? Number(value) >= 0 : Number(value) > 0);
const side = (value: unknown) => value === 'BUY' || value === 'SELL';

export function historyOwner(owner?: string) {
  if (owner === undefined) return 'paper';
  if (/^0x[0-9a-f]{40}$/i.test(owner)) return owner.toLowerCase();
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(owner)) return owner;
  throw new Error('Invalid history wallet');
}
function valid(record: ExecutionRecord) {
  if (!record || !text(record.pairId)) return false;
  try { pairForStrategy(record?.pairId); } catch { return false; }
  return text(record.id) && ['AI','RULES_ONLY','LIVE'].includes(record.agentMode) && text(record.status) && timestamp(record.updatedAt) &&
    Number.isSafeInteger(record.inferenceCount) && record.inferenceCount >= 0 && record.inferenceCount <= 1000 &&
    Array.isArray(record.orders) && record.orders.length <= 100 && record.orders.every(fill => text(fill.actionId) && side(fill.side) && amount(fill.notionalUsd) && amount(fill.baseQuantity) && amount(fill.feeUsd,true) && amount(fill.priceUsd) && timestamp(fill.filledAtMs)) &&
    Array.isArray(record.liveOrders) && record.liveOrders.length <= 100 && record.liveOrders.every(order => text(order.orderId) && side(order.side) && amount(order.notionalUsd) && text(order.status) && timestamp(order.submittedAtMs)) &&
    (record.agentMode === 'LIVE' ? record.orders.length === 0 : record.liveOrders.length === 0);
}
export function readExecutionRuns(storage: Pick<Storage,'getItem'>, owner?: string): ExecutionRecord[] {
  const raw = storage.getItem(prefix + historyOwner(owner));
  if (!raw) return [];
  if (raw.length > maxBytes) throw new Error('Saved order history is too large');
  const records: unknown = JSON.parse(raw);
  if (!Array.isArray(records) || records.length > 100 || !records.every(valid)) throw new Error('Saved order history is invalid');
  return records;
}
export function saveExecutionRun(storage: Pick<Storage,'getItem'|'setItem'>, owner: string | undefined, snapshot: any, updatedAt: number) {
  // Select receipt fields explicitly. Drafts, signing payloads and API keys stay out of this cache.
  const record: ExecutionRecord = {
    id: snapshot.id, pairId: snapshot.pair?.id, agentMode: snapshot.agentMode, status: snapshot.status, updatedAt,
    inferenceCount: Array.isArray(snapshot.inference) ? snapshot.inference.length : 0,
    orders: (snapshot.orders ?? []).map((fill: PaperFill) => ({actionId:fill.actionId,side:fill.side,notionalUsd:fill.notionalUsd,baseQuantity:fill.baseQuantity,feeUsd:fill.feeUsd,priceUsd:fill.priceUsd,filledAtMs:fill.filledAtMs})),
    liveOrders: (snapshot.liveOrders ?? []).map((order: LiveOrder) => ({orderId:order.orderId,side:order.side,notionalUsd:order.notionalUsd,status:order.status,submittedAtMs:order.submittedAtMs})),
  };
  if (!valid(record) || record.agentMode === 'LIVE' && !owner) throw new Error('Invalid execution receipt');
  const previous = readExecutionRuns(storage, owner);
  if (previous.some(item => item.id === record.id && item.updatedAt > updatedAt)) return;
  const records = previous.filter(item => item.id !== record.id);
  records.push(record);
  records.sort((a,b) => b.updatedAt - a.updatedAt);
  records.length = Math.min(records.length,100);
  let raw = JSON.stringify(records);
  while (raw.length > maxBytes) { records.pop(); raw = JSON.stringify(records); }
  storage.setItem(prefix + historyOwner(owner), raw);
}
export function paperTransactions(records: ExecutionRecord[]) {
  return records.flatMap(record => {
    if (record.agentMode === 'LIVE') return [];
    const fills: PaperFill[] = [];
    let previousPnl = 0;
    return record.orders.map(fill => {
      fills.push(fill);
      const position = paperPosition({mode:'PAPER',orders:fills});
      const realizedPnl = fill.side === 'SELL' && position ? position.realizedPnl - previousPnl : null;
      if (position) previousPnl = position.realizedPnl;
      return {...fill,runId:record.id,pairId:record.pairId,agentMode:record.agentMode,realizedPnl};
    });
  }).sort((a,b) => b.filledAtMs - a.filledAtMs);
}
