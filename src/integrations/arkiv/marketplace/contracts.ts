import type {Hex,PublicClient} from 'viem';
import type {Json} from '../contracts.ts';
import type {Currency,Listing} from '../community/contracts.ts';
export class MarketplaceError extends Error {
  code:'AUTH_REQUIRED'|'AUTH_INVALID'|'LIMIT_EXCEEDED'|'INVALID_INPUT'|'DEPENDENCY_UNAVAILABLE'|'NOT_FOUND'|'NOT_OWNER'|
    'INTENT_CONFLICT'|'LISTING_UNAVAILABLE'|'VAULT_INTEGRITY_FAILED'|'PAYMENT_UNVERIFIED'|'PAYMENT_REUSED'|'PAYMENT_REQUIRED';
  constructor(code:MarketplaceError['code'],message=code){super(message);this.code=code;this.name='MarketplaceError';}
}
export interface Order {orderId:string;buyer:Hex;requestId:string;listing:Listing;afterBlock:string;expiresAt:number;transactionHash?:Hex;payment?:PaymentEvidence}
export interface PaymentEvidence {chainId:number;transactionHash:Hex;blockHash:Hex;blockNumber:string;logIndex:number}
export interface PaymentVerifier {currency:Currency;currentBlock():Promise<bigint>;verify(order:Order,transactionHash:Hex):Promise<PaymentEvidence>}
export interface PaymentOptions {client:Pick<PublicClient,'getChainId'|'getBlockNumber'|'getBlock'|'getTransactionReceipt'>;currency:Currency;confirmations:number}
export interface PrivatePackage {packageSchema:'private-strategy/1';strategy:Json;terms:string}
export type ValidatePrivateStrategy=(input:unknown)=>Json;
export function marketFail(code:MarketplaceError['code']):never{throw new MarketplaceError(code);}
