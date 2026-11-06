import { keccak256, toBytes, type Hex } from 'viem';
import type { Json } from '../contracts.ts';
import { address, entityKey, requestId } from '../codec.ts';
import { fail, StorageError } from '../errors.ts';
import type { EventDTO, EventRepository } from './contracts.ts';
import { latestEvent } from './state.ts';
import { verifyMembershipPayment, type PaymentClient } from './sepolia.ts';
import {validateSwarmPointer,type SwarmMessagePointer} from './member-content.ts';
import {membershipPaymentData,planChain,RABDI_PAYMENT_CHAIN,signalCreator,verifySignalAuthor} from './membership-intent.ts';

export const MEMBERSHIP_MS = 30 * 24 * 60 * 60 * 1000;
export interface KeyBox { publicKey: string; salt: string; iv: string; ciphertext: string }
export interface EncryptionIdentity { publicKey: string; backup: { iv: string; ciphertext: string } }
export interface SignalContent { title: string; body: string; source: 'ai-proposal' | 'rule-engine' | 'manual'; strategy?: Json; communityKey?: Hex }
export interface EncryptedSignal {
  title: string; body: string; source: 'ai-proposal' | 'rule-engine' | 'manual'; sourceVersionKey?: Hex;
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
  payments: PaymentClient; rabdiPayments?:PaymentClient; blockTimestamp: (block: bigint) => Promise<number>;
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
  async function claimRows(creator?:Hex,buyer?:Hex){
    const [legacy,relayed]=await Promise.all([
      events.scan({type:'subscription',scope:'global',...(creator?{subject:creator}:{}),...(buyer?{actor:buyer}:{})}),
      events.scan({type:'subscription-relay',...(creator?{scope:creator}:{}),...(buyer?{subject:buyer}:{})}),
    ]);return [...legacy,...relayed];
  }
  async function verifyClaim(claim: EventDTO) {
    const relayed=claim.type==='subscription-relay';
    const buyer=relayed?address(claim.subject):claim.actor,creator=address(relayed?claim.scope:claim.subject);
    const plan=await typed(entityKey(claim.data.planKey),'creator-plan');
    if(plan.actor!==creator||buyer===creator||claim.source!=='arkiv')fail('UNTRUSTED_RECORD');
    if(claim.data.keyRecord){const key=await typed(entityKey(claim.data.keyRecord),'encryption-key');if(key.actor!==buyer||BigInt(key.createdAtBlock)>BigInt(claim.createdAtBlock))fail('UNTRUSTED_RECORD');}
    const chainId=planChain(plan),native=chainId===RABDI_PAYMENT_CHAIN;
    if(relayed&&!native)fail('UNTRUSTED_RECORD');
    const client=native?readers.rabdiPayments:readers.payments;if(!client)fail('DEPENDENCY_UNAVAILABLE');
    const transactionHash=entityKey(claim.data.transactionHash);
    const input=native?membershipPaymentData({buyer,creator,planKey:plan.key,priceWei:String(plan.data.priceWei),requestId:requestId(claim.data.purchaseId)}):'0x';
    const [paidAt,indexedAt,planCreatedAt]=await Promise.all([
      verifyMembershipPayment(client,{transactionHash,buyer,creator,priceWei:String(plan.data.priceWei),chainId,input}),
      readers.blockTimestamp(BigInt(claim.createdAtBlock)),readers.blockTimestamp(BigInt(plan.createdAtBlock)),
    ]);
    if(paidAt<planCreatedAt||indexedAt<paidAt)fail('PAYMENT_UNVERIFIED');
    const activationBlock=native?(await client.getTransaction({hash:transactionHash})).blockNumber:BigInt(claim.createdAtBlock);
    if(activationBlock===null||activationBlock>BigInt(claim.createdAtBlock))fail('PAYMENT_UNVERIFIED');
    return {claim,buyer,creator,activatedAt:native?paidAt:indexedAt,activationBlock,amountWei:String(plan.data.priceWei),chainId};
  }
  async function verifiedClaims(rows:EventDTO[],beforeBlock?:bigint){
    const verified:Awaited<ReturnType<typeof verifyClaim>>[]=[];
    for(const claim of rows){try{const result=await verifyClaim(claim);if(beforeBlock===undefined||result.activationBlock<=beforeBlock)verified.push(result);}catch(error){
      if(error instanceof StorageError&&['PAYMENT_UNVERIFIED','INVALID_INPUT','UNTRUSTED_RECORD','NOT_FOUND_OR_EXPIRED'].includes(error.code))continue;throw error;
    }}
    return verified.sort((a,b)=>a.activationBlock<b.activationBlock?-1:a.activationBlock>b.activationBlock?1:a.claim.key.localeCompare(b.claim.key));
  }
  async function resolveClaims(rows:EventDTO[],beforeBlock?:bigint){
    const seen=new Set<string>(),members=new Map<string,PaidMember&{creator:Hex}>();
    for(const result of await verifiedClaims(rows,beforeBlock)){
      const {claim,buyer,creator,activatedAt}=result,hash=String(claim.data.transactionHash);if(seen.has(hash))continue;seen.add(hash);
      const id=creator+':'+buyer,previous=members.get(id);
      members.set(id,{creator,wallet:buyer,expiresAt:Math.max(previous?.expiresAt??0,activatedAt)+MEMBERSHIP_MS,lastClaim:claim.key});
    }return [...members.values()];
  }
  const service = {
    getPlan: (creator: Hex) => current('creator-plan', creator),
    async plans() {
      const rows = await events.scan({type:'creator-plan',scope:'global'});
      const plans: EventDTO[] = [];
      for (const creator of new Set(rows.map(row => row.actor))) {
        try {
          const plan = latestEvent(rows.filter(row => row.actor === creator && row.subject === creator));
          if (plan) plans.push(plan);
        } catch (error) {
          if (!(error instanceof StorageError) || !['INTEGRITY_FAILED','CONCURRENT_UPDATE','MULTIPLE_TIPS','HISTORY_INCOMPLETE'].includes(error.code)) throw error;
        }
      }
      return plans;
    },
    async subscriptions(wallet: Hex) {
      const rows = await claimRows(undefined,address(wallet));
      return (await resolveClaims(rows)).map(({creator,expiresAt,lastClaim}) => ({creator,expiresAt,lastClaim}));
    },
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
    publishPlan: (input: { priceWei: string; requestId: string; previousKey?: Hex; chainId?:7794095 }) =>
      revise('creator-plan', { priceWei: input.priceWei, termDays: 30,...(input.chainId?{chainId:input.chainId}:{}) }, input.requestId, input.previousKey),
    registerKey: (input: { identity: EncryptionIdentity; requestId: string; previousKey?: Hex }) =>
      revise('encryption-key', input.identity as unknown as Record<string, Json>, input.requestId, input.previousKey),
    async earnings(creator:Hex){
      const seen=new Set<string>(),payments:{wallet:Hex;transactionHash:Hex;amountWei:string;activatedAt:number;chainId:number}[]=[];
      let total=0n;const totals:Record<string,string>={};
      for(const result of await verifiedClaims(await claimRows(address(creator)))){
        const hash=entityKey(result.claim.data.transactionHash);if(seen.has(hash))continue;seen.add(hash);
        if(result.chainId===11155111)total+=BigInt(result.amountWei);totals[result.chainId]=(BigInt(totals[result.chainId]??'0')+BigInt(result.amountWei)).toString();
        payments.push({wallet:result.buyer,transactionHash:hash,amountWei:result.amountWei,activatedAt:result.activatedAt,chainId:result.chainId});
      }
      return {totalWei:total.toString(),totals,payments:payments.reverse()};
    },
    async members(creator:Hex,beforeBlock?:bigint):Promise<PaidMember[]>{return (await resolveClaims(await claimRows(address(creator)),beforeBlock)).map(({wallet,expiresAt,lastClaim})=>({wallet,expiresAt,lastClaim}));},
    async claim(input: { planKey: Hex; transactionHash: Hex; requestId: string; keyRecord?:Hex }) {
      const buyer = await events.actor();
      const plan = await typed(input.planKey, 'creator-plan');
      if(planChain(plan)!==11155111)fail('INVALID_INPUT','Rabdi purchases activate automatically.');
      if(input.keyRecord&&(await typed(input.keyRecord,'encryption-key')).actor!==buyer)fail('KEY_REQUIRED');
      const prior = (await events.scan({ type: 'subscription', actor: buyer })).filter(row => row.data.transactionHash === input.transactionHash);
      if (prior.length) {
        if (prior.some(row => row.data.planKey !== plan.key || row.subject !== plan.actor)) fail('PAYMENT_REUSED');
        return ordered(prior)[0]!;
      }
      const paidAt = await verifyMembershipPayment(readers.payments, { transactionHash: input.transactionHash, buyer, creator: plan.actor, priceWei: String(plan.data.priceWei) });
      if (paidAt < await readers.blockTimestamp(BigInt(plan.createdAtBlock))) fail('PAYMENT_UNVERIFIED');
      return events.append({ type: 'subscription', actor: buyer, subject: plan.actor, scope: 'global', requestId: input.requestId,
        data: { planKey: plan.key, transactionHash: entityKey(input.transactionHash),...(input.keyRecord?{keyRecord:input.keyRecord}:{}) } });
    },
    async renewalEvidence(creator: Hex, buyer: Hex, now: number) {
      let expiresAt = 0;
      let records: EventDTO[] = [];
      const seen = new Set<string>();
      const claims=await verifiedClaims(await claimRows(address(creator),address(buyer)));
      for(const result of claims){
        const {claim,activatedAt}=result;
        const hash=String(claim.data.transactionHash);if(seen.has(hash))continue;
        seen.add(hash);
        if (activatedAt >= expiresAt) records = [];
        records.push(claim, await typed(entityKey(claim.data.planKey),'creator-plan'));
        if(claim.data.keyRecord)records.push(await typed(entityKey(claim.data.keyRecord),'encryption-key'));
        expiresAt = Math.max(expiresAt,activatedAt) + MEMBERSHIP_MS;
      }
      return {expiresAt:Math.max(now,expiresAt)+MEMBERSHIP_MS,records:expiresAt > now ? records : []};
    },
    async publishSignal(input: { pointer: SwarmMessagePointer; requestId: string }) {
      const creator = await events.actor();
      const pointer=validateSwarmPointer(input.pointer);
      return events.append({ type: 'private-signal', actor: creator, subject: creator, scope: 'global', requestId: input.requestId,
        data: { ...pointer } });
    },
    async signals(creator:Hex){
      creator=address(creator);
      const [direct,relayed]=await Promise.all([events.scan({type:'private-signal',actor:creator,subject:creator,scope:'global'}),events.scan({type:'private-signal-relay',subject:creator,scope:'global'})]);
      const found=new Map<string,EventDTO>();
      for(const signal of ordered([...direct,...relayed])){try{await verifySignalAuthor(signal);}catch(error){if(error instanceof StorageError&&error.code==='UNTRUSTED_RECORD')continue;throw error;}
        const id=String(signal.data.publicationId??signal.requestId);if(!found.has(id))found.set(id,signal);
      }return [...found.values()].reverse();
    },
    async readSignal(key:Hex){const signal=await events.read(entityKey(key));await verifySignalAuthor(signal);return signal;},
    async canReadSignal({signal,wallet,now}:{signal:EventDTO;wallet:Hex;now:number}){
      const creator=await verifySignalAuthor(signal);if(address(wallet)===creator)return true;
      const current=(await service.members(creator)).find(member=>member.wallet===address(wallet));if(!current||current.expiresAt<=now)return false;
      const publishedAt=await readers.blockTimestamp(BigInt(signal.createdAtBlock));
      const historical=(await service.members(creator,BigInt(signal.createdAtBlock)-1n)).find(member=>member.wallet===address(wallet));return Boolean(historical&&historical.expiresAt>publishedAt);
    },
    async recipients(signal: EventDTO) {
      const at = await readers.blockTimestamp(BigInt(signal.createdAtBlock));
      const before = BigInt(signal.createdAtBlock) - 1n;
      const members = await service.members(signal.actor, before);
      return members.filter(member => member.expiresAt > at).map(member => ({ wallet: member.wallet }));
    },
    async getEnvelope(signal: EventDTO, recipient: Hex) {
      const rows = await events.scan({ type: 'signal-envelope', actor: signal.actor, subject: address(recipient), scope: signal.key });
      return ordered(rows)[0];
    },
    async grantSignal(input: { signal: EventDTO; recipient: Hex; keyRecord: Hex; box: KeyBox }) {
      const creator = await events.actor();
      const signal = await typed(input.signal.key, 'private-signal');
      if (creator !== signal.actor) fail('NOT_OWNER');
      const recipients = await service.recipients(signal);
      if (!recipients.find(row => row.wallet === input.recipient)) fail('NOT_OWNER');
      return events.append({ type: 'signal-envelope', actor: creator, subject: input.recipient, scope: signal.key,
        requestId: envelopeRequestId(signal.key, input.recipient), data: {keyRecord:input.keyRecord,box:input.box as unknown as Json} });
    },
  };
  return service;
}

export type CreatorMemberships = ReturnType<typeof createCreatorMemberships>;
