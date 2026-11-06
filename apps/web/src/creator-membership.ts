import {planChain,planCurrency} from '../../../src/integrations/arkiv/community/membership-intent.ts';
import type { Hex } from 'viem';
import type { WalletBridge } from './integration.ts';
import type { EventDTO, EventRepository } from '../../../src/integrations/arkiv/community/contracts.ts';
import { createCreatorMemberships } from '../../../src/integrations/arkiv/community/memberships.ts';
import { createMembershipReaders } from '../../../src/integrations/arkiv/community/membership-network.ts';
import { verifyMembershipPayment } from '../../../src/integrations/arkiv/community/sepolia.ts';
import { StorageError } from '../../../src/integrations/arkiv/errors.ts';
import { clearMembershipPayment, readMembershipPayment, saveMembershipPayment, sendMembershipPayment } from './membership-payment.ts';
import { escape as e, errorCode, failure, formatAmount, parseAmount, keyPattern, withWalletLock } from './core.ts';
import { errors, field, notice } from './ui.ts';
import { MEMBER_STRATEGY_TYPE, memberStrategy } from './member-strategy.ts';
import {createMemberContentClient,validateMemberDraft} from './member-content.ts';
import {canonical} from '../../../src/integrations/arkiv/codec.ts';
import type {SwarmMessagePointer} from '../../../src/integrations/arkiv/community/member-content.ts';
import {memberContentHash} from '../../../src/integrations/arkiv/community/member-content.ts';
import type { SignalContent } from '../../../src/integrations/arkiv/community/memberships.ts';

type WriteAction = { actor: Hex; requestId: string; arkivAttempted?:boolean; txHash?:Hex; entityKey?:Hex } & (
  | { kind: 'plan'; chainId?:7794095; priceWei: string; previousKey?: Hex }
  | { kind: 'claim'; planKey: Hex; transactionHash: Hex }
  | { kind: 'signal'; relay?:boolean; content?: SignalContent; pointer?:SwarmMessagePointer; uploadUncertain?:boolean }
);
const journalKey = (account: Hex) => 'poros.membership-write.' + account;
const actionButton = (action: string, text: string, extra = '') => `<button type="button" class="button secondary" data-member-action="${action}" ${extra}>${text}</button>`;

export class CreatorMembershipPanel {
  readonly service;
  readonly readers;
  private root?: HTMLElement;
  private creator?: Hex;
  private account?: Hex;
  private generation = 0;
  private busy = false;
  private events:EventRepository;
  private feedOffset=0;
  private signals = new Map<string, SignalContent>();
  private accessDeadline = 0;
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private onPageHide = () => this.lock();
  private onPageShow = (event: PageTransitionEvent) => { if (event.persisted && this.root) void this.load(); };

  private wallet: WalletBridge | undefined;
  private options: { openStrategy?: (entry: ReturnType<typeof memberStrategy>) => Promise<void>; getDraft?: () => unknown; saved?: () => void; readFeed?:boolean };

  constructor(wallet: WalletBridge | undefined, events: EventRepository, accessKey?: string,
    options: { openStrategy?: (entry: ReturnType<typeof memberStrategy>) => Promise<void>; getDraft?: () => unknown; saved?: () => void; readFeed?:boolean } = {}) {
    this.wallet = wallet;
    this.events=events;
    this.options = options;
    this.readers = createMembershipReaders(accessKey);
    this.service = createCreatorMemberships(events, this.readers);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('pageshow', this.onPageShow);
  }
  dispose() {
    this.lock(); this.detach();
    window.removeEventListener('pagehide',this.onPageHide);
    window.removeEventListener('pageshow',this.onPageShow);
  }
  lock() {
    clearTimeout(this.expiryTimer);
    this.generation++;
    this.signals.clear();
    this.accessDeadline = 0;
    this.root?.replaceChildren();
  }
  detach() { clearTimeout(this.expiryTimer); this.generation++; this.signals.clear(); this.accessDeadline = 0; this.root = undefined; }
  async mount(root: HTMLElement, creator: Hex, account: Hex | undefined, preview: boolean,readFeed=true) {
    this.options.readFeed=readFeed;
    this.feedOffset=0;
    if (this.account !== account) this.lock();
    this.root = root; this.creator = creator; this.account = account;
    root.addEventListener('click', event => {
      const button = (event.target as Element).closest<HTMLElement>('[data-member-action]');
      if (!button) return;
      event.preventDefault(); event.stopPropagation();
      void this.run(() => this.action(button.dataset.memberAction!, button.dataset.key));
    });
    root.addEventListener('submit', event => {
      event.preventDefault(); event.stopPropagation();
      const form = event.target as HTMLFormElement;
      void this.run(() => this.submit(form));
    });
    root.addEventListener('dragstart', event => {
      const card = (event.target as Element).closest<HTMLElement>('[data-signal]');
      if (!card) return;
      const content = this.signals.get(card.dataset.signal!);
      if (!content || performance.now() >= this.accessDeadline || !event.dataTransfer) { event.preventDefault(); return; }
      event.dataTransfer.setData(MEMBER_STRATEGY_TYPE, JSON.stringify({versionId:card.dataset.signal,content,memberWallet:this.account,expiresAt:Number.isFinite(this.accessDeadline)?Date.now()+this.accessDeadline-performance.now():null}));
      event.dataTransfer.effectAllowed = 'copy';
      event.stopPropagation();
    });
    if (preview) { root.innerHTML = notice('Creator memberships are available in the live Rabdi view.'); return; }
    await this.load(this.options.readFeed!==false);
  }
  private status(message: string) {
    const slot = this.root?.querySelector('[data-member-status]');
    if (slot) slot.textContent = message;
  }
  private async checkAccount(expected = this.account): Promise<Hex> {
    if (!expected || !this.wallet) failure('WALLET_REQUIRED');
    if ((await this.wallet.getContext()).account.toLowerCase() !== expected || this.account !== expected) failure('ACCOUNT_CHANGED');
    return expected;
  }
  private pending(): WriteAction | undefined {
    if (!this.account) return;
    const raw = localStorage.getItem(journalKey(this.account));
    if (!raw) return;
    if (raw.length > 65536) failure('INVALID_INPUT');
    const value = JSON.parse(raw) as WriteAction;
    if (value.actor !== this.account || !/^[0-9a-f-]{36}$/.test(value.requestId)) failure('INVALID_INPUT');
    if (!['plan','claim','signal'].includes(value.kind) || (value.kind==='signal'&&!value.content&&!value.pointer)) throw new StorageError('WRITE_STATUS_UNKNOWN','An older pending write needs the previous recovery flow. Its saved state has been retained.');
    return value;
  }
  private async run(operation: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true;
    this.root?.setAttribute('aria-busy','true');
    this.status('Working… Review any wallet request.');
    try { await operation(); }
    catch (error) {
      const code = errorCode(error);
      const message = error instanceof StorageError && error.message !== code ? error.message : errors[code] ?? (error instanceof Error ? error.message : 'Unable to complete this action.');
      this.status(message + (['WRITE_STATUS_UNKNOWN','WRITE_CONFIRMED_READ_PENDING','NETWORK_UNAVAILABLE'].includes(code) ? ' Use Refresh membership to see recovery actions.' : ''));
    } finally { this.busy = false; this.root?.removeAttribute('aria-busy'); }
  }
  private async dispatch(action: WriteAction): Promise<EventDTO> {
    await this.checkAccount(action.actor);
    switch (action.kind) {
      case 'plan': return this.service.publishPlan(action);
      case 'claim': return this.service.claim({planKey:action.planKey,transactionHash:action.transactionHash,requestId:action.requestId});
      case 'signal': {
        if(action.relay){
          if(!action.content||!this.wallet)failure('INVALID_INPUT');
          return createMemberContentClient({wallet:this.wallet}).publish({publicationId:action.requestId,content:action.content,retryUncertain:action.uploadUncertain===true});
        }
        if(!action.pointer){
          if(!action.content||!this.wallet)failure('INVALID_INPUT');
          const generation=this.generation;
          const pointer=await createMemberContentClient({wallet:this.wallet}).upload({publicationId:action.requestId,content:action.content,retryUncertain:action.uploadUncertain===true});
          await this.checkAccount(action.actor);
          action={...action,pointer};delete action.content;delete action.uploadUncertain;
          localStorage.setItem(journalKey(action.actor),JSON.stringify(action));
          if(generation!==this.generation)failure('ACCOUNT_CHANGED');
        }
        if(action.arkivAttempted){
          const matches=await this.events.scan({actor:action.actor,requestId:action.requestId});
          if(matches.length>1)failure('DUPLICATE_REQUEST');
          let found=matches[0];
          if(!found&&action.entityKey){try{found=await this.events.read(action.entityKey);}catch(error){if(errorCode(error)!=='NOT_FOUND_OR_EXPIRED')throw error;}}
          if(found){
            if(found.actor!==action.actor||found.subject!==action.actor||found.type!=='private-signal'||found.scope!=='global'||found.requestId!==action.requestId||canonical(found.data)!==canonical(action.pointer))failure('INTEGRITY_FAILED');
            return found;
          }
          if(!action.txHash||!await this.readers.isFailedWrite(action.txHash))throw new StorageError('WRITE_STATUS_UNKNOWN','The original publication is still unconfirmed. Refresh to check it again; it will not be submitted twice.');
          delete action.txHash;delete action.entityKey;
        }
        localStorage.setItem(journalKey(action.actor),JSON.stringify({...action,arkivAttempted:true}));
        return this.service.publishSignal({pointer:action.pointer!,requestId:action.requestId});
      }
    }
  }
  private async write(action: WriteAction, recovery = false) {
    return withWalletLock(async () => {
      await this.checkAccount(action.actor);
      const prior = this.pending();
      if (prior && (!recovery || prior.requestId !== action.requestId)) failure('WRITE_STATUS_UNKNOWN');
      localStorage.setItem(journalKey(action.actor), JSON.stringify(action));
      try {
        const result = await this.dispatch(action);
        await this.checkAccount(action.actor);
        localStorage.removeItem(journalKey(action.actor));
        if (action.kind === 'claim') clearMembershipPayment(localStorage, action.actor);
        return result;
      } catch (error) {
        if(action.kind==='signal'){
          const saved=JSON.parse(localStorage.getItem(journalKey(action.actor))!);
          const details=error as StorageError;
          if(details.txHash)saved.txHash=details.txHash;
          if(details.entityKey)saved.entityKey=details.entityKey;
          if(!details.included&&['USER_REJECTED','INVALID_INPUT','CONCURRENT_UPDATE'].includes(errorCode(error)))saved.arkivAttempted=false;
          localStorage.setItem(journalKey(action.actor),JSON.stringify(saved));
        }
        if(action.kind==='signal'&&errorCode(error)==='UPLOAD_UNCERTAIN')localStorage.setItem(journalKey(action.actor),JSON.stringify({...action,uploadUncertain:true}));
        if (action.kind!=='signal'&&['USER_REJECTED','INVALID_INPUT','CONCURRENT_UPDATE'].includes(errorCode(error))) localStorage.removeItem(journalKey(action.actor));
        throw error;
      }
    }, navigator.locks);
  }
  private async load(readFeed = this.options.readFeed!==false) {
    const root = this.root, creator = this.creator, account = this.account;
    if (!root || !creator) return;
    clearTimeout(this.expiryTimer);
    const generation = ++this.generation;
    this.signals.clear();
    this.accessDeadline = 0;
    root.innerHTML = '<h2>Creator membership</h2><p data-member-status role="status">Reading membership…</p>' + actionButton('refresh','Refresh membership');
    try {
      const [plan, members, now] = await Promise.all([
        this.service.getPlan(creator), account ? this.service.members(creator) : undefined,
        this.readers.now(),
      ]);
      if (generation !== this.generation || !root.isConnected) return;
      const owner = account === creator;
      const memberList = members ?? [];
      const access = memberList.find(member => member.wallet === account && member.expiresAt > now);
      const pending = this.pending();
      const payment = account ? readMembershipPayment(localStorage,account) : undefined;
      let html = `<h2>Creator membership</h2><p>${memberList.filter(member=>member.expiresAt>now).length} active paid subscribers</p>`;
      html += plan ? `<p><strong>${e(formatAmount(String(plan.data.priceWei),18))} ${planCurrency(plan)}</strong> for 30 days</p>` : '<p>This creator has yet to publish a membership price.</p>';
      html += '<p>Membership includes creator messages published during your active term. There are no per-message purchases.</p>';
      html += '<p data-member-status role="status"></p>' + actionButton('refresh','Refresh membership');
      if (!account) { root.innerHTML = html + notice('Connect your wallet using the header to access membership.'); return; }
      if (pending) html += notice(pending.kind==='signal'&&pending.uploadUncertain?'The upload is uncertain. Retrying may use storage funds again.':'A saved write needs recovery. Reuse it before starting another write.') + actionButton('recover-write',pending.kind==='signal'&&pending.uploadUncertain?'Retry upload':'Recover '+pending.kind+' write');
      if (!owner && plan) html += `<form data-member-form="subscribe" data-plan="${plan?.key ?? ''}"><p>Pay <code>${e(creator)}</code> directly on ${planCurrency(plan)} · chain ${planChain(plan)}. ${planChain(plan)===7794095?'One payment approval; activation is automatic.':'Access starts after the verified Arkiv claim.'}</p><label class="check-field"><input type="checkbox" name="reviewed" required> I reviewed the creator, price, network, and 30-day term.</label><button class="button primary" ${pending || payment ? 'disabled' : ''}>${access?'Renew':'Subscribe'} · ${plan ? e(formatAmount(String(plan.data.priceWei),18))+' '+planCurrency(plan) : 'Membership not offered'}</button></form>`;
      if (owner) html += `<form data-member-form="plan"><h3>Membership price</h3>${field('price','Rabdi tGLM for 30 days',{required:true,value:plan&&planChain(plan)===7794095?formatAmount(String(plan.data.priceWei),18):'0.0001'})}<button class="button primary">${plan?'Update':'Publish'} membership price</button></form>`;
      if (payment) html += `<section><h3>Recover your payment</h3><p>Creator <code>${e(payment.creator)}</code> · ${e(formatAmount(payment.priceWei,18))} ${payment.chainId?'tGLM':'Sepolia ETH'}</p><form data-member-form="claim">${field('hash','Original transaction hash',{required:true,value:payment.hash,placeholder:'0x…'})}<button class="button primary">${payment.chainId?'Check activation':'Verify payment and activate'}</button></form>${actionButton('failed-payment','Check and clear a failed transaction')}<p>An uncertain payment uses this original transaction for recovery.</p></section>`;
      if (access) html += `<p>Membership expires ${e(new Date(access.expiresAt).toLocaleString())}.</p>`;
      if (owner) html += `<form data-member-form="signal"><h3>Publish to your members</h3>${field('title','Title',{required:true})}${field('body','Message to members',{required:true,area:true})}<label class="field"><span>Source</span><select name="source"><option value="manual">Creator</option><option value="ai-proposal">AI proposal reviewed by creator</option><option value="rule-engine">Rule engine reviewed by creator</option></select></label><label class="check-field"><input name="approved" type="checkbox" required> I reviewed and approve this message for my current members.</label><button class="button primary">Publish</button></form>`;
      if (owner || access) html += `<div data-private-feed></div>`;
      root.innerHTML = html;
      this.accessDeadline = owner ? Infinity : access ? performance.now() + Math.max(0,access.expiresAt-now) : 0;
      if (access) this.expiryTimer = setTimeout(()=>{
        void this.load();
      },Math.min(access.expiresAt-now,2147483647));
      if (readFeed && (owner || access)) await this.feed(generation, owner);
    } catch(error) {
      if (generation === this.generation && root === this.root) this.status(error instanceof Error&&error.message!==errorCode(error)?error.message:errors[errorCode(error)]??'Membership verification is unavailable. Try refreshing.');
    }
  }
  private async feed(generation: number, owner: boolean) {
    if (!this.creator || !this.account || !this.wallet) return;
    const eligible:EventDTO[]=[];
    let legacy=false;
    for(const signal of await this.service.signals(this.creator)){
      if(!owner&&!await this.service.canReadSignal({signal,wallet:this.account,now:await this.readers.now()}))continue;
      if(signal.data.format!=='swarm-message/1'){legacy=true;continue;}
      eligible.push(signal);
    }
    this.feedOffset=Math.min(this.feedOffset,Math.max(0,Math.floor((eligible.length-1)/20)*20));
    const page=eligible.slice(this.feedOffset,this.feedOffset+20);
    if(generation!==this.generation)return;
    const messages=await createMemberContentClient({wallet:this.wallet}).readMany(page.map(signal=>signal.key));
    const items:string[]=[];
    for(let index=0;index<messages.length;index++){
      const {content,expiresAt}=messages[index]!,signal=page[index]!;
      const now=await this.readers.now();
      const publishedAt=await this.readers.blockTimestamp(BigInt(signal.createdAtBlock));
      await this.checkAccount();
      if(generation!==this.generation||performance.now()>=this.accessDeadline||(!owner&&(!expiresAt||expiresAt<=now)))return;
      if(!owner)this.accessDeadline=Math.min(this.accessDeadline,performance.now()+expiresAt!-now);
      this.signals.set(signal.key,content);
      items.push(`<article class="paper-panel member-strategy-card" draggable="true" data-signal="${signal.key}"><h3>${e(content.title)}</h3><p class="preserve">${e(content.body)}</p>${content.communityKey?`<a href="/community#/community/${content.communityKey}">Selected community</a>`:''}<small>${e(content.source)} · ${e(new Date(publishedAt).toLocaleString())} · Stored encrypted on Swarm</small><p>${content.strategy?'Editable strategy attached.':'Text instructions require 0G interpretation before editing.'} Drag onto the strategy canvas.</p>${this.options.openStrategy?actionButton('open-strategy','Load on canvas',`data-key="${signal.key}"`):`<a class="button secondary" href="/">Open strategy builder</a>`}</article>`);
    }
    if(generation!==this.generation||!this.root?.isConnected||performance.now()>=this.accessDeadline)return;
    this.root.querySelector('[data-private-feed]')!.innerHTML='<h3>Members-only messages</h3>'+(items.join('')||'<p>Your future messages will appear here.</p>')+(this.feedOffset?actionButton('newer-messages','Newer messages'):'')+(this.feedOffset+20<eligible.length?actionButton('older-messages','Older messages'):'')+(legacy?'<p>Older encrypted messages require the previous recovery flow.</p>':'');
  }
  private async action(action: string, key?: string) {
    if(action==='older-messages'||action==='newer-messages'){this.feedOffset=Math.max(0,this.feedOffset+(action==='older-messages'?20:-20));await this.load();return;}
    if (action === 'refresh') { await this.load(); return; }
    if (action === 'lock') { this.lock(); await this.load(); return; }
    const account = await this.checkAccount();
    if (action === 'open-strategy' && key) {
      const content = this.signals.get(key);
      if (!content || performance.now() >= this.accessDeadline) failure('MEMBERSHIP_EXPIRED');
      const entry={...memberStrategy(content,key),memberWallet:account,expiresAt:Number.isFinite(this.accessDeadline)?Date.now()+this.accessDeadline-performance.now():null};
      await this.options.openStrategy?.(entry);
      this.status('Strategy sent to the canvas for review.');
    } else if (action === 'attach-draft' && this.options.getDraft) {
      const input = this.root?.querySelector<HTMLTextAreaElement>('[name="strategy"]');
      if (input) input.value = JSON.stringify(this.options.getDraft(),null,2);
    } else if (action === 'recover-write') {
      const pending = this.pending();
      if (!pending) { await this.load(); return; }
      await this.write(pending,true);
      await this.load(false);
      this.status('Original write recovered and verified.');

    } else if (action === 'failed-payment') {
      const payment = readMembershipPayment(localStorage,account);
      if (!payment?.hash) failure('PAYMENT_UNVERIFIED');
      const client = payment.chainId?this.readers.rabdiPayments:this.readers.payments;
      if (await client.getChainId() !== (payment.chainId??11155111)) failure('WRONG_CHAIN');
      const [receipt,transaction,head] = await Promise.all([client.getTransactionReceipt({hash:payment.hash}),client.getTransaction({hash:payment.hash}),client.getBlockNumber()]);
      if (receipt.status !== 'reverted' || head < receipt.blockNumber+1n || transaction.from.toLowerCase() !== account || transaction.to?.toLowerCase() !== payment.creator || transaction.value !== BigInt(payment.priceWei)) failure('PAYMENT_UNVERIFIED');
      const block = await client.getBlock({blockNumber:receipt.blockNumber});
      if (block.hash !== receipt.blockHash) failure('PAYMENT_UNVERIFIED');
      clearMembershipPayment(localStorage,account);
      await this.load(); this.status('The failed transaction was verified. You can review a fresh subscription.');
    }
  }
  private async submit(form: HTMLFormElement) {
    const account = await this.checkAccount(), creator = this.creator!;
    const generation = this.generation;
    const data = new FormData(form), text = (key: string) => String(data.get(key)??'');
    const base = {actor:account,requestId:crypto.randomUUID()};
    switch (form.dataset.memberForm) {
      case 'plan': {
        if (creator !== account) failure('KEY_REQUIRED');
        const plan = await this.service.getPlan(account);
        await this.write({...base,kind:'plan',chainId:7794095,priceWei:parseAmount(text('price'),18),previousKey:plan?.key}); break;
      }
      case 'subscribe': {
        if (!data.has('reviewed') || this.pending()) failure('KEY_REQUIRED');
        const plan = await this.service.getPlan(creator);
        if (!plan) failure('KEY_REQUIRED');
        if (plan.key !== form.dataset.plan) failure('CONCURRENT_UPDATE');
        const payment = {...base,...planChain(plan)===7794095?{chainId:7794095 as const}:{},buyer:account,creator,planKey:plan.key,priceWei:String(plan.data.priceWei),attempted:false};
        const sent=await sendMembershipPayment(this.wallet!,payment,localStorage,async()=>{
          if(payment.chainId)await createMemberContentClient({wallet:this.wallet!}).ready();
          if ((await this.service.getPlan(creator))?.key !== plan.key) failure('CONCURRENT_UPDATE');
          const evidence = await this.service.renewalEvidence(creator,account,await this.readers.now());
          await this.readers.assertRetention(await this.service.retentionEvidence([plan,...evidence.records]),evidence.expiresAt);
        },navigator.locks);
        if(sent.chainId){await createMemberContentClient({wallet:this.wallet!}).activate(sent);await this.checkAccount(account);clearMembershipPayment(localStorage,account);await this.load(false);this.status('Membership active.');return;}
        await this.load(false); this.status('Payment submitted. After two confirmations, verify it and approve the Arkiv claim.'); return;
      }
      case 'claim': {
        const payment = readMembershipPayment(localStorage,account), hash = text('hash').trim().toLowerCase();
        if (!payment || !keyPattern.test(hash) || (payment.hash && payment.hash !== hash)) failure('INVALID_INPUT');
        const plan = await this.service.readPlan(payment.planKey);
        if (plan.actor !== payment.creator || plan.data.priceWei !== payment.priceWei) failure('INTEGRITY_FAILED');
        if(payment.chainId){payment.hash=hash as Hex;saveMembershipPayment(localStorage,payment);await createMemberContentClient({wallet:this.wallet!}).activate(payment);await this.checkAccount(account);clearMembershipPayment(localStorage,account);break;}
        await verifyMembershipPayment(this.readers.payments,{transactionHash:hash as Hex,buyer:account,creator:payment.creator,priceWei:payment.priceWei});
        payment.hash = hash as Hex;
        saveMembershipPayment(localStorage,payment);
        await this.write({actor:account,requestId:payment.requestId,kind:'claim',planKey:payment.planKey,transactionHash:payment.hash});
        break;
      }
      case 'signal': {
        if (!data.has('approved')) failure('INVALID_INPUT');
        const strategy = text('strategy').trim();
        await this.publishSignal({title:text('title'),body:text('body'),...(strategy?{strategy:JSON.parse(strategy)}:{}),source:text('source') as SignalContent['source']});
        form.reset();
        break;
      }
    }
    await this.load(false);
    this.status('Saved and verified.');
    this.options.saved?.();
  }
  async publishPost(content: SignalContent) {
    if (this.busy) failure('CONCURRENT_UPDATE');
    this.busy = true;
    try {
      await this.publishSignal(content);
      await this.load(false);
      this.status('Exclusive post saved.');
    } catch(error) {
      if(errorCode(error)==='WRITE_STATUS_UNKNOWN')await this.load(false);
      throw error;
    } finally { this.busy = false; }
  }
  private async publishSignal(content: SignalContent) {
    content=validateMemberDraft(content);
    const account = await this.checkAccount();
    if (account !== this.creator) failure('KEY_REQUIRED');
    const pending=this.pending();
    if(pending){
      if(pending.kind==='signal'&&pending.uploadUncertain)throw new StorageError('WRITE_STATUS_UNKNOWN','An earlier upload is uncertain. Under Creator membership, choose Refresh membership, then Retry upload to review another storage upload.');
      if(pending.kind==='signal'&&(pending.content?canonical(pending.content)===canonical(content):pending.pointer?.payloadHash===memberContentHash(content))){
        await this.write(pending,true);
        this.status('Original post recovered.');
        return;
      }
      throw new StorageError('WRITE_STATUS_UNKNOWN',`An earlier ${pending.kind} write is saved. Under Creator membership, choose Refresh membership, then Recover ${pending.kind} write. Your current strategy has not been published.`);
    }
    const requestId = crypto.randomUUID();
    await this.write({actor:account,requestId,kind:'signal',content,relay:true});
    this.status('Post saved.');
  }
}
