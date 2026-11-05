import { keccak256, toBytes, type Hex } from 'viem';
import type { Json } from '../contracts.ts';
import { address, entityKey, requestId } from '../codec.ts';
import { fail, StorageError } from '../errors.ts';
import type { EventDTO, EventRepository } from './contracts.ts';
import { latestEvent } from './state.ts';
import { verifyMembershipPayment, type PaymentClient } from './sepolia.ts';

export const MEMBERSHIP_MS = 30 * 24 * 60 * 60 * 1000;
export interface KeyBox { publicKey: string; salt: string; iv: string; ciphertext: string }
export interface EncryptionIdentity { publicKey: string; backup: { iv: string; ciphertext: string } }
export interface SignalContent { title: string; body: string }
export interface EncryptedSignal {
  iv: string; ciphertext: string; creatorKey: Hex; creatorBox: KeyBox;
  source: 'ai-proposal' | 'rule-engine' | 'manual'; sourceVersionKey?: Hex;
}
export interface PaidMember { wallet: Hex; expiresAt: number; lastClaim: Hex }

function ordered(rows: EventDTO[]) {
  return [...rows].sort((a, b) => BigInt(a.createdAtBlock) < BigInt(b.createdAtBlock) ? -1 :
    BigInt(a.createdAtBlock) > BigInt(b.createdAtBlock) ? 1 : a.key.localeCompare(b.key));
}

export function envelopeRequestId(signalKey: Hex, recipient: Hex): string {
  const hash = keccak256(toBytes(`poros:signal-envelope:1:${signalKey}:${recipient}`)).slice(2, 34);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20)}`;
}

export function createCreatorMemberships(events: EventRepository, readers: {
  payments: PaymentClient; blockTimestamp: (block: bigint) => Promise<number>;
}) {
  async function typed(key: Hex, type: EventDTO['type']) {
    const record = await events.read(entityKey(key));
    if (record.type !== type || record.source !== 'arkiv') fail('UNTRUSTED_RECORD');
    return record;
  }
  async function current(type: 'creator-plan' | 'encryption-key', wallet: Hex, beforeBlock?: bigint) {
    const actor = address(wallet);
    const rows = await events.scan({ type, actor, subject: actor, scope: 'global' });
    return latestEvent(rows.filter(row => beforeBlock === undefined || BigInt(row.createdAtBlock) <= beforeBlock));
  }
  async function revise(type: 'creator-plan' | 'encryption-key', data: Record<string, Json>, request: string, previousKey?: Hex) {
    const actor = await events.actor();
    const existing = await events.scan({ actor, requestId: requestId(request) });
    if (!existing.length && (await current(type, actor))?.key !== previousKey) fail('CONCURRENT_UPDATE');
    return events.append({ type, actor, subject: actor, scope: 'global', requestId: request,
      data: { ...data, ...(previousKey ? { previousKey } : {}) } });
  }
  async function verifyClaim(claim: EventDTO) {
    const plan = await typed(entityKey(claim.data.planKey), 'creator-plan');
    if (plan.actor !== claim.subject || claim.actor === plan.actor) fail('UNTRUSTED_RECORD');
    const key = await typed(entityKey(claim.data.keyRecord), 'encryption-key');
    if (key.actor !== claim.actor || BigInt(key.createdAtBlock) > BigInt(claim.createdAtBlock)) fail('UNTRUSTED_RECORD');
    const [paidAt, activatedAt, planCreatedAt] = await Promise.all([
      verifyMembershipPayment(readers.payments, { transactionHash: entityKey(claim.data.transactionHash),
        buyer: claim.actor, creator: plan.actor, priceWei: String(plan.data.priceWei) }),
      readers.blockTimestamp(BigInt(claim.createdAtBlock)), readers.blockTimestamp(BigInt(plan.createdAtBlock)),
    ]);
    if (paidAt < planCreatedAt || activatedAt < paidAt) fail('PAYMENT_UNVERIFIED');
    return activatedAt;
  }
  const service = {
    getPlan: (creator: Hex) => current('creator-plan', creator),
    getKey: (wallet: Hex, beforeBlock?: bigint) => current('encryption-key', wallet, beforeBlock),
    readKey: (key: Hex) => typed(key, 'encryption-key'),
    readPlan: (key: Hex) => typed(key, 'creator-plan'),
    async retentionEvidence(records: EventDTO[]) {
      const found = new Map(records.map(row=>[row.key,row]));
      for (const record of found.values()) {
        if (!record.data.previousKey) continue;
        const parent = await typed(entityKey(record.data.previousKey),record.type);
        if (parent.actor !== record.actor || BigInt(parent.createdAtBlock) > BigInt(record.createdAtBlock)) fail('INTEGRITY_FAILED');
        if (!found.has(parent.key)) found.set(parent.key,parent);
        if (found.size > 500) fail('HISTORY_INCOMPLETE');
      }
      return [...found.values()];
    },
    publishPlan: (input: { priceWei: string; requestId: string; previousKey?: Hex }) =>
      revise('creator-plan', { priceWei: input.priceWei, termDays: 30 }, input.requestId, input.previousKey),
    registerKey: (input: { identity: EncryptionIdentity; requestId: string; previousKey?: Hex }) =>
      revise('encryption-key', input.identity as unknown as Record<string, Json>, input.requestId, input.previousKey),
    async members(creator: Hex, beforeBlock?: bigint): Promise<PaidMember[]> {
      const rows = ordered((await events.scan({ type: 'subscription', subject: address(creator), scope: 'global' }))
        .filter(row => beforeBlock === undefined || BigInt(row.createdAtBlock) <= beforeBlock));
      const seenPayments = new Set<string>();
      const members = new Map<Hex, PaidMember>();
      for (const claim of rows) {
        const transactionHash = String(claim.data.transactionHash);
        if (seenPayments.has(transactionHash)) continue;
        let activatedAt: number;
        try { activatedAt = await verifyClaim(claim); }
        catch (error) {
          if (error instanceof StorageError && ['PAYMENT_UNVERIFIED','INVALID_INPUT','UNTRUSTED_RECORD','NOT_FOUND_OR_EXPIRED'].includes(error.code)) continue;
          throw error;
        }
        seenPayments.add(transactionHash);
        const previous = members.get(claim.actor);
        members.set(claim.actor, { wallet: claim.actor, expiresAt: Math.max(previous?.expiresAt ?? 0, activatedAt) + MEMBERSHIP_MS, lastClaim: claim.key });
      }
      return [...members.values()];
    },
    async claim(input: { planKey: Hex; transactionHash: Hex; keyRecord: Hex; requestId: string }) {
      const buyer = await events.actor();
      const plan = await typed(input.planKey, 'creator-plan');
      const key = await typed(input.keyRecord, 'encryption-key');
      if (key.actor !== buyer) fail('KEY_REQUIRED');
      const prior = (await events.scan({ type: 'subscription', actor: buyer })).filter(row => row.data.transactionHash === input.transactionHash);
      if (prior.length) {
        if (prior.some(row => row.data.planKey !== plan.key || row.subject !== plan.actor)) fail('PAYMENT_REUSED');
        return ordered(prior)[0]!;
      }
      const paidAt = await verifyMembershipPayment(readers.payments, { transactionHash: input.transactionHash, buyer, creator: plan.actor, priceWei: String(plan.data.priceWei) });
      if (paidAt < await readers.blockTimestamp(BigInt(plan.createdAtBlock))) fail('PAYMENT_UNVERIFIED');
      return events.append({ type: 'subscription', actor: buyer, subject: plan.actor, scope: 'global', requestId: input.requestId,
        data: { planKey: plan.key, transactionHash: entityKey(input.transactionHash), keyRecord: key.key } });
    },
    async renewalEvidence(creator: Hex, buyer: Hex, now: number) {
      let expiresAt = 0;
      let records: EventDTO[] = [];
      const seen = new Set<string>();
      const claims = ordered(await events.scan({type:'subscription',subject:address(creator),actor:address(buyer),scope:'global'}));
      for (const claim of claims) {
        const hash = String(claim.data.transactionHash);
        if (seen.has(hash)) continue;
        let activatedAt: number;
        try { activatedAt = await verifyClaim(claim); }
        catch (error) {
          if (error instanceof StorageError && ['PAYMENT_UNVERIFIED','INVALID_INPUT','UNTRUSTED_RECORD','NOT_FOUND_OR_EXPIRED'].includes(error.code)) continue;
          throw error;
        }
        seen.add(hash);
        if (activatedAt >= expiresAt) records = [];
        records.push(claim, await typed(entityKey(claim.data.planKey),'creator-plan'), await typed(entityKey(claim.data.keyRecord),'encryption-key'));
        expiresAt = Math.max(expiresAt,activatedAt) + MEMBERSHIP_MS;
      }
      return {expiresAt:Math.max(now,expiresAt)+MEMBERSHIP_MS,records:expiresAt > now ? records : []};
    },
    async publishSignal(input: { encrypted: EncryptedSignal; requestId: string }) {
      const creator = await events.actor();
      const key = await typed(input.encrypted.creatorKey, 'encryption-key');
      if (key.actor !== creator) fail('NOT_OWNER');
      return events.append({ type: 'private-signal', actor: creator, subject: creator, scope: 'global', requestId: input.requestId,
        data: input.encrypted as unknown as Record<string, Json> });
    },
    async signals(creator: Hex) {
      return ordered(await events.scan({ type: 'private-signal', actor: address(creator), subject: address(creator), scope: 'global' })).reverse();
    },
    readSignal: (key: Hex) => typed(key, 'private-signal'),
    async recipients(signal: EventDTO) {
      const at = await readers.blockTimestamp(BigInt(signal.createdAtBlock));
      // Claims in the same block have no reliable transaction ordering in this event model.
      const before = BigInt(signal.createdAtBlock) - 1n;
      const members = await service.members(signal.actor, before);
      const recipients: { wallet: Hex; key: EventDTO }[] = [];
      for (const member of members.filter(member => member.expiresAt > at)) {
        const key = await service.getKey(member.wallet, before);
        if (!key) fail('KEY_REQUIRED', 'A subscriber encryption key is unavailable. Delivery remains pending.');
        recipients.push({ wallet: member.wallet, key });
      }
      return recipients;
    },
    async getEnvelope(signal: EventDTO, recipient: Hex) {
      const rows = await events.scan({ type: 'signal-envelope', actor: signal.actor, subject: address(recipient), scope: signal.key });
      return ordered(rows)[0];
    },
    async grantSignal(input: { signal: EventDTO; recipient: Hex; keyRecord: Hex; box: KeyBox }) {
      const creator = await events.actor();
      const signal = await typed(input.signal.key, 'private-signal');
      if (creator !== signal.actor) fail('NOT_OWNER');
      const key = await typed(input.keyRecord, 'encryption-key');
      if (key.actor !== address(input.recipient) || BigInt(key.createdAtBlock) > BigInt(signal.createdAtBlock)) fail('KEY_REQUIRED');
      const recipient = (await service.recipients(signal)).find(row => row.wallet === key.actor);
      if (!recipient || recipient.key.key !== key.key) fail('NOT_OWNER');
      return events.append({ type: 'signal-envelope', actor: creator, subject: key.actor, scope: signal.key,
        requestId: envelopeRequestId(signal.key, key.actor), data: { keyRecord: key.key, box: input.box as unknown as Json } });
    },
  };
  return service;
}

export type CreatorMemberships = ReturnType<typeof createCreatorMemberships>;
