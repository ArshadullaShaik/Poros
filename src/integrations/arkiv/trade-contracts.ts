import {z} from 'zod';
import type {Hex} from 'viem';
import {domainHash} from './codec.ts';
const text=z.string().min(1).max(256),wallet=z.string().regex(/^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/);
export const decimal=z.string().regex(/^\d{1,18}(?:\.\d{1,36})?$/);
export const sourceSchema=z.strictObject({kind:z.enum(['flash','portfolio']),sourceId:text,wallet,chainFamily:z.enum(['evm','solana'])}).superRefine((s,c)=>{
 if((s.chainFamily==='evm')!==s.wallet.startsWith('0x'))c.addIssue({code:'custom',message:'Source address family mismatch'});
 if(s.chainFamily==='evm'&&s.wallet!==s.wallet.toLowerCase())c.addIssue({code:'custom',message:'Normalize EVM source address'});
 if(s.kind==='flash'&&s.sourceId!=='flash:'+s.wallet)c.addIssue({code:'custom',message:'Invalid Flash source identity'});
});
export type TradeSourceRef=z.infer<typeof sourceSchema>;
export const traderSchema=z.string().regex(/^0x[0-9a-f]{40}$/);
export const bindingSchema=z.strictObject({trader:traderSchema,source:sourceSchema,linkedAt:z.number().int().positive(),historicalFrom:z.number().int().positive().nullable()});
export type SourceBinding=z.infer<typeof bindingSchema>;
export const fillSchema=z.strictObject({fillId:text,orderId:text,chain:text,baseAsset:text,quoteAsset:text,market:text,currency:text,side:z.enum(['BUY','SELL']),quantity:decimal,value:decimal,feeUsd:decimal.nullable(),feeAsset:text.nullable(),feeAmount:decimal.nullable(),filledAt:z.number().int().positive(),transactionId:text,evidenceHash:z.string().regex(/^0x[0-9a-f]{64}$/)});
export type VerifiedFill=z.infer<typeof fillSchema>;
export interface VerifiedOrder {orderId:string;status:string;fills:VerifiedFill[];evidenceHash:Hex;market?:string;chain?:string;currency?:string;side?:'BUY'|'SELL'}
export interface SourcePage {orders:VerifiedOrder[];nextCursor:string|null;observedAt:number}
export const coverageSchema=z.strictObject({from:z.number().int().positive().nullable(),through:z.number().int().positive(),lastSyncedAt:z.number().int().positive(),sourceExhausted:z.boolean(),gaps:z.array(z.string().max(256)).max(100),disputed:z.boolean(),renewalHealthy:z.boolean()});
export type LedgerCoverage=z.infer<typeof coverageSchema>;
const base={schemaVersion:z.literal(1),trader:traderSchema,source:sourceSchema,observedAt:z.number().int().positive()};
export const recordInputSchema=z.discriminatedUnion('kind',[
 z.strictObject({...base,kind:z.literal('source-link'),data:bindingSchema}),
 z.strictObject({...base,kind:z.literal('source-unlink'),data:z.strictObject({unlinkedAt:z.number().int().positive()})}),
 z.strictObject({...base,kind:z.literal('fill'),data:fillSchema}),
 z.strictObject({...base,kind:z.literal('order'),data:z.strictObject({orderId:text,status:z.string().regex(/^ORDER_STATUS_[A-Z_]+$/),market:text.optional(),chain:text.optional(),currency:text.optional(),side:z.enum(['BUY','SELL']).optional()})}),
 z.strictObject({...base,kind:z.literal('coverage'),data:coverageSchema}),
 z.strictObject({...base,kind:z.literal('dispute'),data:z.strictObject({identity:z.string().regex(/^0x[0-9a-f]{64}$/),evidenceHashes:z.array(z.string().regex(/^0x[0-9a-f]{64}$/)).min(2).max(10)})}),
]);
export type LedgerInput=z.infer<typeof recordInputSchema>;
export type LedgerRecord=LedgerInput&{identity:Hex;recordHash:Hex};
export type LedgerEntry=LedgerRecord&{entityKey:Hex;txHash?:Hex;expiresAtBlock:string};
export type RecordingState='pending'|'delayed'|'recorded'|'incomplete';
export function sourceKey(source:TradeSourceRef){return domainHash('trade-source',sourceSchema.parse(source));}
export function buildTradeRecord(input:LedgerInput):LedgerRecord {
 const core=recordInputSchema.parse(input);
 if(core.kind==='source-link'&&(core.data.trader!==core.trader||sourceKey(core.data.source)!==sourceKey(core.source)))throw new Error('Source link mismatch');
 const data=core.data;
 const id=core.kind==='fill'?{order:core.data.orderId,fill:core.data.fillId,chain:core.data.chain}:
  core.kind==='order'?{order:core.data.orderId,status:core.data.status}:core.kind==='dispute'?core.data:{at:core.observedAt};
 const identity=domainHash('trade-identity',{kind:core.kind,trader:core.trader,source:sourceKey(core.source),id});
 // Observation time is not economic evidence: repeated fetches of the same fill are idempotent.
 const recordHash=domainHash('trade-record',{kind:core.kind,trader:core.trader,source:core.source,data,identity});
 return {...core,identity,recordHash};
}
