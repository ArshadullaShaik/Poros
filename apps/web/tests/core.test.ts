import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData, parseAbi, keccak256, toBytes, type Hex } from 'viem';
import serialize from 'canonicalize';
import { formatAmount, parseAmount, checkedText, PaymentAttempt, validateQuote, verifyDownload, MemorySession, sendPaymentOnce, currencyLabel, currencyMatches, mergeRecovery, withWalletLock, type Recovery } from '../src/core.ts';
import type { Listing } from '../../../src/integrations/arkiv/community/index.ts';
import type { WalletBridge } from '../src/integration.ts';
const buyer = ('0x' + 'a'.repeat(40)) as Hex;
const seller = ('0x' + 'b'.repeat(40)) as Hex;
const hash = ('0x' + 'c'.repeat(64)) as Hex;
const listing: Listing = { key: hash, seller, packageId: crypto.randomUUID(), contentHash: hash, title: 'Test', description: '', terms: 'Private', currency: { chainId: 31337, token: ('0x' + 'd'.repeat(40)) as Hex, decimals: 6 }, amount: '1000001', active: true, expiresAtBlock: '1000', source: 'arkiv' };
const quote = () => ({ orderId: crypto.randomUUID(), requestId: crypto.randomUUID(), buyer, listing, afterBlock: '10', expiresAt: Date.now() + 3600000, state: 'awaiting-payment' as const,
    transaction: { chainId: 31337, to: listing.currency.token, value: '0x0' as Hex, data: encodeFunctionData({ abi: parseAbi(['function transfer(address to,uint256 value) returns (bool)']), functionName: 'transfer', args: [seller, 1000001n] }) } });
const bridge = (send: () => Promise<Hex>) => { const provider = { request: async () => '0x7a69' }; return { getContext: async () => ({ account: buyer, provider }), sendTransaction: send } as unknown as WalletBridge; };
test('money uses exact base units and UTF-8 limits reject multibyte overflow', () => {
    assert.equal(parseAmount('1000000000.000001', 6), '1000000000000001');
    assert.equal(formatAmount('1000000000000001', 6), '1000000000.000001');
    assert.throws(() => parseAmount('0.0000001', 6));
    assert.throws(() => parseAmount('1e2', 6));
    assert.throws(() => checkedText('🙂'.repeat(21), 1, 80));
});
test('quotes reject changed seller calldata and paid/expired transfer injection', () => {
    assert.equal(validateQuote(quote(), buyer, listing).state, 'awaiting-payment');
    assert.throws(() => validateQuote({ ...quote(), state: 'paid', transactionHash: hash }, buyer, listing));
    assert.throws(() => validateQuote({ ...quote(), state: 'expired' }, buyer, listing));
    assert.throws(() => validateQuote({ ...quote(), buyer: seller }, buyer, listing));
    const wrong = quote();
    wrong.transaction.to = seller;
    assert.throws(() => validateQuote(wrong, buyer, listing));
    const changed = quote();
    changed.transaction.data = encodeFunctionData({ abi: parseAbi(['function transfer(address to,uint256 value) returns (bool)']), functionName: 'transfer', args: [buyer, 1000001n] });
    assert.throws(() => validateQuote(changed, buyer, listing));
    assert.equal(validateQuote({ ...quote(), state: 'paid', transaction: null, transactionHash: hash }, buyer, listing).transaction, null);
});
test('account or connector changes during payment preflight never reach the sender', async () => {
    let calls = 0, sends = 0;
    const provider = { request: async () => '0x7a69' };
    const wallet = { getContext: async () => ({ account: ++calls === 1 ? buyer : seller, provider }), sendTransaction: async () => { sends++; return hash; } } as unknown as WalletBridge;
    await assert.rejects(() => new PaymentAttempt(quote()).send(wallet));
    assert.equal(sends, 0);
});
test('payment uncertainty and successful submission both forbid another transfer', async () => {
    let count = 0;
    const uncertain = new PaymentAttempt(quote());
    const wallet = bridge(async () => { count++; throw new Error('disconnected'); });
    await assert.rejects(() => uncertain.send(wallet));
    await assert.rejects(() => uncertain.send(wallet));
    assert.equal(count, 1);
    assert.equal(uncertain.state, 'unknown');
    const paid = new PaymentAttempt(quote());
    await paid.send(bridge(async () => hash));
    await assert.rejects(() => paid.send(bridge(async () => hash)));
    const expired = new PaymentAttempt({ ...quote(), expiresAt: Date.now() - 1 });
    await assert.rejects(() => expired.send(bridge(async () => hash)));
});
test('session invalidation discards a late login response after account change', () => {
    const session = new MemorySession();
    const version = session.version();
    session.clear();
    assert.throws(() => session.accept(version, { token: 'x'.repeat(43), wallet: buyer, expiresAt: Date.now() + 10000 }, buyer));
    assert.equal(session.token, undefined);
});
test('a quote that becomes too old during network switching never reaches the sender', async () => {
    const q = quote();
    let sends = 0;
    const originalNow = Date.now;
    const wallet = bridge(async () => { sends++; return hash; });
    wallet.switchChain = async () => { Date.now = () => q.expiresAt - 30000; };
    try {
        await assert.rejects(() => new PaymentAttempt(q).send(wallet), error => (error as {
            code: string;
        }).code === 'ORDER_NOT_PAYABLE');
        assert.equal(sends, 0);
    }
    finally {
        Date.now = originalNow;
    }
});
function locks() { const held = new Set<string>(); return { request: async (name: string, _options: unknown, callback: (lock: unknown) => Promise<unknown>) => { if (held.has(name))
        return callback(null); held.add(name); try {
        return await callback({});
    }
    finally {
        held.delete(name);
    } } } as unknown as Pick<LockManager, 'request'>; }
test('journal mutation and reconciliation exclude other accounts through the same global lock', async () => {
    const manager = locks();
    let release!: () => void, enter!: () => void, sends = 0;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    const reconciling = withWalletLock(async () => { enter(); await released; }, manager);
    await entered;
    const otherQuote = { ...quote(), buyer: seller };
    await assert.rejects(() => sendPaymentOnce(new PaymentAttempt(otherQuote), bridge(async () => { sends++; return hash; }), { read: () => undefined, write: () => { } }, manager));
    release();
    await reconciling;
    assert.equal(sends, 0);
});
test('stale second-tab attempts cannot pay a journaled order and simultaneous wallet calls are excluded', async () => {
    const q = quote(), manager = locks();
    let record: {
        attempted?: boolean;
        hash?: Hex;
    } | undefined;
    let sends = 0;
    const journal = { read: () => record, write: (_id: string, state: {
            attempted?: boolean;
            hash?: Hex;
        }) => { record = state; } };
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    const wallet = bridge(async () => { sends++; enter(); await released; return hash; });
    const first = sendPaymentOnce(new PaymentAttempt(q), wallet, journal, manager);
    await entered;
    await assert.rejects(() => sendPaymentOnce(new PaymentAttempt(q), wallet, journal, manager));
    release();
    await first;
    await assert.rejects(() => sendPaymentOnce(new PaymentAttempt(q), wallet, journal, manager));
    assert.equal(sends, 1);
    assert.deepEqual(record, { attempted: true, hash });
});
test('missing cross-tab locks or failed durable recovery prevent any transfer', async () => {
    let sends = 0;
    const wallet = bridge(async () => { sends++; return hash; });
    const journal = { read: () => undefined, write: () => { throw Error('storage blocked'); } };
    await assert.rejects(() => sendPaymentOnce(new PaymentAttempt(quote()), wallet, journal, undefined));
    await assert.rejects(() => sendPaymentOnce(new PaymentAttempt(quote()), wallet, journal, locks()));
    assert.equal(sends, 0);
});
test('a delayed quote response cannot erase a submitted payment journal or enable a second send', async () => {
    const q = quote();
    const identity = { buyer, orderId: q.orderId, requestId: q.requestId, listingKey: q.listing.key };
    let records: Recovery[] = [];
    let sends = 0;
    const journal = { read: (orderId: string) => records.find(row => row.orderId === orderId), write: (_id: string, state: {
            attempted?: boolean;
            hash?: Hex;
        }) => { records = mergeRecovery(records, { ...identity, ...state }, !state.attempted && !state.hash); } };
    const wallet = bridge(async () => { sends++; return hash; }), manager = locks();
    await sendPaymentOnce(new PaymentAttempt(q), wallet, journal, manager);
    records = mergeRecovery(records, identity);
    await assert.rejects(() => sendPaymentOnce(new PaymentAttempt(q), wallet, journal, manager));
    assert.equal(sends, 1);
    assert.equal(records[0]!.hash, hash);
    assert.equal(records[0]!.attempted, true);
    records = mergeRecovery(records, identity, true);
    assert.equal(records[0]!.hash, hash);
});
test('known pre-send rejection can reset its claim but recovery capacity never evicts another payment', () => {
    const q = quote();
    const identity = { buyer, orderId: q.orderId, requestId: q.requestId, listingKey: q.listing.key };
    assert.equal(mergeRecovery([{ ...identity, attempted: true }], identity, true)[0]!.attempted, undefined);
    const full = Array.from({ length: 100 }, () => ({ ...identity, orderId: crypto.randomUUID(), requestId: crypto.randomUUID(), attempted: true }));
    assert.throws(() => mergeRecovery(full, identity));
    assert.equal(full.length, 100);
});
test('an unapproved token never inherits the configured symbol or network identity', () => {
    const approved = { currency: listing.currency, symbol: 'USDC' };
    assert.equal(currencyLabel(listing, approved), 'USDC');
    const unsupported = { ...listing, currency: { ...listing.currency, token: buyer } };
    assert.equal(currencyLabel(unsupported, approved), 'token units');
    assert.equal(currencyMatches(unsupported, approved), false);
});
test('private delivery verifies the exact commercial envelope and rejects changed terms/validator transformation', () => {
    const envelope = { packageSchema: 'private-strategy/1' as const, strategy: { rule: 'private' }, terms: 'Buyer license' };
    const commitment = keccak256(toBytes('strategyhub:private-package:v1\n' + serialize(envelope)));
    const payload = { ...envelope, packageId: listing.packageId, contentHash: commitment };
    const expected = { packageId: listing.packageId, contentHash: commitment };
    assert.deepEqual(verifyDownload(payload, expected, input => input as {
        rule: string;
    }).strategy, { rule: 'private' });
    assert.throws(() => verifyDownload({ ...payload, terms: 'different' }, expected, input => input as {
        rule: string;
    }));
    assert.throws(() => verifyDownload(payload, expected, () => ({ rule: 'transformed' })));
    assert.throws(() => verifyDownload(payload, expected));
});
