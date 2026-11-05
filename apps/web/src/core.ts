import serialize from 'canonicalize';
import { decodeFunctionData, keccak256, parseAbi, toBytes, type Hex } from 'viem';
import type { Listing } from '../../../src/integrations/arkiv/community/index.ts';
import type { Json } from '../../../src/integrations/arkiv/index.ts';
import type { Order } from '../../../src/integrations/arkiv/marketplace/contracts.ts';
import type { Transfer, WalletBridge } from './integration.ts';
export const keyPattern = /^0x[0-9a-f]{64}$/;
export const walletPattern = /^0x[0-9a-f]{40}$/;
export function errorCode(error: unknown): string {
    if (error && typeof error === 'object' && 'code' in error)
        return error.code === 4001 ? 'USER_REJECTED' : String(error.code);
    return 'DEPENDENCY_UNAVAILABLE';
}
export function failure(code: string): never { throw Object.assign(new Error(code), { code }); }
export const short = (value: string) => value.length > 16 ? value.slice(0, 7) + '…' + value.slice(-5) : value;
export const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
export function checkedText(value: string, min: number, max: number) {
    const n = new TextEncoder().encode(value).length;
    if (n < min || n > max)
        failure('INVALID_INPUT');
    return value;
}
export function formatAmount(amount: string, decimals: number): string {
    if (!/^(0|[1-9][0-9]*)$/.test(amount) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36)
        failure('INVALID_INPUT');
    const digits = amount.padStart(decimals + 1, '0');
    if (!decimals)
        return digits;
    const fractional = digits.slice(-decimals).replace(/0+$/, '');
    return digits.slice(0, -decimals) + (fractional ? '.' + fractional : '');
}
export function parseAmount(value: string, decimals: number): string {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36 || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value))
        failure('INVALID_INPUT');
    const [whole, fraction = ''] = value.split('.');
    if (fraction.length > decimals)
        failure('INVALID_INPUT');
    const amount = BigInt(whole! + fraction.padEnd(decimals, '0'));
    if (amount <= 0n || amount >= 2n ** 256n)
        failure('INVALID_INPUT');
    return String(amount);
}
export interface Quote extends Order {
    state: 'awaiting-payment' | 'expired' | 'paid';
    transaction: Transfer | null;
}
export function currencyMatches(listing: Listing, payment?: {
    currency: Listing['currency'];
}) { return !!payment && serialize(listing.currency) === serialize(payment.currency); }
export function currencyLabel(listing: Listing, payment?: {
    currency: Listing['currency'];
    symbol: string;
}) { return listing.source === 'mock' ? 'demo tokens' : currencyMatches(listing, payment) ? payment!.symbol : 'token units'; }
const transferAbi = parseAbi(['function transfer(address to,uint256 value) returns (bool)']);
export function validateQuote(input: unknown, buyer: Hex, listing: Listing): Quote {
    if (!input || typeof input !== 'object')
        failure('INVALID_INPUT');
    const quote = input as Quote;
    if (quote.buyer !== buyer || serialize(quote.listing) !== serialize(listing) || !/^[0-9a-f-]{36}$/.test(quote.orderId) ||
        !/^[0-9a-f-]{36}$/.test(quote.requestId) || !/^(0|[1-9][0-9]*)$/.test(quote.afterBlock) || !Number.isSafeInteger(quote.expiresAt))
        failure('INVALID_INPUT');
    if (quote.state === 'paid' || quote.state === 'expired') {
        if (quote.transaction !== null || (quote.state === 'paid' && !keyPattern.test(quote.transactionHash ?? '')))
            failure('INVALID_INPUT');
    }
    else if (quote.state === 'awaiting-payment') {
        const transaction = quote.transaction;
        if (quote.transactionHash || !transaction || transaction.chainId !== listing.currency.chainId || transaction.to !== listing.currency.token || transaction.value !== '0x0')
            failure('INVALID_INPUT');
        let decoded;
        try {
            decoded = decodeFunctionData({ abi: transferAbi, data: transaction.data });
        }
        catch {
            return failure('INVALID_INPUT');
        }
        if (decoded.functionName !== 'transfer' || decoded.args[0].toLowerCase() !== listing.seller || decoded.args[1] !== BigInt(listing.amount))
            failure('INVALID_INPUT');
    }
    else
        failure('INVALID_INPUT');
    return quote;
}
export class PaymentAttempt {
    state: 'review' | 'sending' | 'submitted' | 'unknown' | 'paid' = 'review';
    hash: Hex | undefined;
    readonly quote: Quote;
    constructor(quote: Quote) {
        this.quote = quote;
        if (quote.state === 'paid')
            this.state = 'paid';
    }
    async send(wallet: WalletBridge) {
        if (this.state !== 'review' || this.quote.state !== 'awaiting-payment' || !this.quote.transaction)
            failure('INTENT_CONFLICT');
        if (Date.now() + 60000 >= this.quote.expiresAt)
            failure('ORDER_NOT_PAYABLE');
        this.state = 'sending';
        try {
            await wallet.switchChain?.(this.quote.transaction.chainId);
            const context = await wallet.getContext();
            if (context.account.toLowerCase() !== this.quote.buyer)
                failure('ACCOUNT_CHANGED');
            if (BigInt(await context.provider.request({ method: 'eth_chainId' })) !== BigInt(this.quote.transaction.chainId))
                failure('WRONG_CHAIN');
            const latest = await wallet.getContext();
            if (latest.account.toLowerCase() !== this.quote.buyer || latest.provider !== context.provider)
                failure('ACCOUNT_CHANGED');
            if (Date.now() + 60000 >= this.quote.expiresAt)
                failure('ORDER_NOT_PAYABLE');
        }
        catch (error) {
            this.state = 'review';
            throw error;
        }
        try {
            const hash = await wallet.sendTransaction(this.quote.transaction, this.quote.buyer);
            if (!keyPattern.test(hash))
                failure('WRITE_STATUS_UNKNOWN');
            this.hash = hash;
            this.state = 'submitted';
            return hash;
        }
        catch (error) {
            this.state = errorCode(error) === 'USER_REJECTED' ? 'review' : 'unknown';
            throw error;
        }
    }
}
export async function withWalletLock<T>(operation: () => Promise<T>, locks: Pick<LockManager, 'request'> | undefined): Promise<T> {
    if (!locks)
        failure('DEPENDENCY_UNAVAILABLE');
    return locks.request('common-ground.wallet', { mode: 'exclusive', ifAvailable: true }, async (lock) => { if (!lock)
        failure('WRITE_STATUS_UNKNOWN'); return operation(); });
}
export interface PaymentJournal {
    read(orderId: string): {
        attempted?: boolean;
        hash?: Hex;
    } | undefined;
    write(orderId: string, state: {
        attempted?: boolean;
        hash?: Hex;
    }): void;
}
export interface Recovery {
    buyer: Hex;
    orderId: string;
    requestId: string;
    listingKey: Hex;
    hash?: Hex;
    attempted?: boolean;
}
export function mergeRecovery(records: Recovery[], incoming: Recovery, resetPreflight = false): Recovery[] {
    const same = (row: Recovery) => row.buyer === incoming.buyer && (row.requestId === incoming.requestId || !!incoming.orderId && row.orderId === incoming.orderId);
    const prior = records.find(same);
    if (prior?.hash && incoming.hash && prior.hash !== incoming.hash)
        failure('INTENT_CONFLICT');
    const next = { ...incoming, ...(prior?.hash ? { attempted: true, hash: prior.hash } : prior?.attempted && !resetPreflight ? { attempted: true } : {}) };
    const rest = records.filter(row => !same(row));
    if (rest.length >= 100)
        failure('LIMIT_EXCEEDED');
    return [...rest, next];
}
export async function sendPaymentOnce(attempt: PaymentAttempt, wallet: WalletBridge, journal: PaymentJournal, locks: Pick<LockManager, 'request'> | undefined) {
    return withWalletLock(async () => {
        const prior = journal.read(attempt.quote.orderId);
        if (prior?.attempted || prior?.hash)
            failure('WRITE_STATUS_UNKNOWN');
        journal.write(attempt.quote.orderId, { attempted: true });
        try {
            const hash = await attempt.send(wallet);
            journal.write(attempt.quote.orderId, { attempted: true, hash });
            return hash;
        }
        catch (error) {
            if (attempt.state === 'review')
                journal.write(attempt.quote.orderId, {});
            throw error;
        }
    }, locks);
}
export interface Download {
    packageId: string;
    contentHash: Hex;
    packageSchema: 'private-strategy/1';
    strategy: Json;
    terms: string;
}
export function verifyDownload(input: unknown, expected: {
    packageId: string;
    contentHash: Hex;
}, validate?: (input: unknown) => Json): Download {
    if (!validate)
        failure('DEPENDENCY_UNAVAILABLE');
    if (!input || typeof input !== 'object')
        failure('INTEGRITY_FAILED');
    const payload = input as Download;
    if (payload.packageId !== expected.packageId || payload.contentHash !== expected.contentHash || payload.packageSchema !== 'private-strategy/1' || typeof payload.terms !== 'string')
        failure('INTEGRITY_FAILED');
    const canonical = serialize({ packageSchema: payload.packageSchema, strategy: payload.strategy, terms: payload.terms });
    if (!canonical || keccak256(toBytes('strategyhub:private-package:v1\n' + canonical)) !== expected.contentHash)
        failure('INTEGRITY_FAILED');
    const checked = validate(payload.strategy);
    if (serialize(checked) !== serialize(payload.strategy))
        failure('INTEGRITY_FAILED');
    return payload;
}
export class MemorySession {
    private generation = 0;
    token: string | undefined;
    wallet: Hex | undefined;
    expiresAt = 0;
    clear() { this.generation++; this.token = undefined; this.wallet = undefined; this.expiresAt = 0; }
    version() { return this.generation; }
    accept(version: number, result: {
        token: string;
        wallet: Hex;
        expiresAt: number;
    }, expected: Hex) {
        if (version !== this.generation || result.wallet !== expected)
            failure('ACCOUNT_CHANGED');
        if (!/^[\w-]{43}$/.test(result.token) || !walletPattern.test(result.wallet) || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Date.now())
            failure('AUTH_INVALID');
        this.token = result.token;
        this.wallet = result.wallet;
        this.expiresAt = result.expiresAt;
    }
    require(wallet: Hex) {
        if (this.wallet !== wallet || !this.token || Date.now() >= this.expiresAt) {
            this.clear();
            failure('AUTH_REQUIRED');
        }
        return this.token;
    }
}
