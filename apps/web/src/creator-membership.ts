import {transactionLink} from './arkiv-display.ts';
import type { Hex } from 'viem';
import type { WalletBridge } from './integration.ts';
import type { EventDTO, EventRepository } from '../../../src/integrations/arkiv/community/contracts.ts';
import { createCreatorMemberships, type EncryptionIdentity, type EncryptedSignal, type KeyBox } from '../../../src/integrations/arkiv/community/memberships.ts';
import { createMembershipReaders } from '../../../src/integrations/arkiv/community/membership-network.ts';
import { verifyMembershipPayment } from '../../../src/integrations/arkiv/community/sepolia.ts';
import { StorageError } from '../../../src/integrations/arkiv/errors.ts';
import { createEncryptionIdentity, restoreEncryptionIdentity, supportsCreatorEncryption, encryptSignal, decryptSignal, sealContentKey, openContentKey } from './creator-crypto.ts';
import { clearMembershipPayment, readMembershipPayment, saveMembershipPayment, sendMembershipPayment } from './membership-payment.ts';
import { escape as e, errorCode, failure, formatAmount, parseAmount, keyPattern, withWalletLock } from './core.ts';
import { errors, field, notice } from './ui.ts';
import { MEMBER_STRATEGY_TYPE, memberStrategy } from './member-strategy.ts';
import type { SignalContent } from '../../../src/integrations/arkiv/community/memberships.ts';

type WriteAction = { actor: Hex; requestId: string } & (
  | { kind: 'plan'; priceWei: string; previousKey?: Hex }
  | { kind: 'key'; identity: EncryptionIdentity; previousKey?: Hex }
  | { kind: 'claim'; planKey: Hex; transactionHash: Hex; keyRecord: Hex }
  | { kind: 'signal'; encrypted: EncryptedSignal }
  | { kind: 'envelope'; signalKey: Hex; recipient: Hex; keyRecord: Hex; box: KeyBox }
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
  private identity?: { account: Hex; record: EventDTO; privateKey: CryptoKey };
  private generated?: Awaited<ReturnType<typeof createEncryptionIdentity>>;
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private signals = new Map<string, SignalContent>();
  private accessDeadline = 0;
  private onPageHide = () => this.lock();
  private onPageShow = (event: PageTransitionEvent) => { if (event.persisted && this.root) void this.load(); };

  private wallet: WalletBridge | undefined;
  private options: { openStrategy?: (entry: ReturnType<typeof memberStrategy>) => Promise<void>; getDraft?: () => unknown; saved?: () => void };

  constructor(wallet: WalletBridge | undefined, events: EventRepository, accessKey?: string,
    options: { openStrategy?: (entry: ReturnType<typeof memberStrategy>) => Promise<void>; getDraft?: () => unknown; saved?: () => void } = {}) {
    this.wallet = wallet;
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
    this.generation++;
    this.identity = undefined;
    this.generated = undefined;
    this.signals.clear();
    this.accessDeadline = 0;
    clearTimeout(this.expiryTimer);
    this.root?.replaceChildren();
  }
  detach() { this.generation++; clearTimeout(this.expiryTimer); this.signals.clear(); this.accessDeadline = 0; this.root = undefined; }
  async mount(root: HTMLElement, creator: Hex, account: Hex | undefined, preview: boolean) {
    if (this.account !== account) this.lock();
    if(this.account!==account)this.lastTransaction=undefined;
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
      event.dataTransfer.setData(MEMBER_STRATEGY_TYPE, JSON.stringify({versionId:card.dataset.signal,content}));
      event.dataTransfer.effectAllowed = 'copy';
      event.stopPropagation();
    });
    if (preview) { root.innerHTML = notice('Creator memberships are available in the live Rabdi view.'); return; }
    await this.load();
  }
  private lastTransaction?:Hex;
  private status(message: string) {
    const slot = this.root?.querySelector('[data-member-status]');
    if (slot) {slot.textContent = message;slot.insertAdjacentHTML('beforeend',' '+transactionLink(this.lastTransaction));}
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
    if (value.actor !== this.account || !/^[0-9a-f-]{36}$/.test(value.requestId) || !['plan','key','claim','signal','envelope'].includes(value.kind)) failure('INVALID_INPUT');
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
      case 'key': return this.service.registerKey(action);
      case 'claim': return this.service.claim(action);
      case 'signal': return this.service.publishSignal(action);
      case 'envelope': return this.service.grantSignal({...action,signal:await this.service.readSignal(action.signalKey)});
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
        this.lastTransaction=result.txHash;
        await this.checkAccount(action.actor);
        localStorage.removeItem(journalKey(action.actor));
        if (action.kind === 'claim') clearMembershipPayment(localStorage, action.actor);
        return result;
      } catch (error) {
        if (['USER_REJECTED','INVALID_INPUT','CONCURRENT_UPDATE'].includes(errorCode(error))) localStorage.removeItem(journalKey(action.actor));
        throw error;
      }
    }, navigator.locks);
  }
  private async load() {
    const root = this.root, creator = this.creator, account = this.account;
    if (!root || !creator) return;
    const generation = ++this.generation;
    clearTimeout(this.expiryTimer);
    this.signals.clear();
    this.accessDeadline = 0;
    root.innerHTML = '<h2>Creator membership</h2><p data-member-status role="status">Reading membership…</p>' + actionButton('refresh','Refresh membership');
    try {
      const [plan, key, members, now, supported] = await Promise.all([
        this.service.getPlan(creator), account ? this.service.getKey(account) : undefined,
        this.service.members(creator), this.readers.now(), supportsCreatorEncryption(),
      ]);
      if (generation !== this.generation || !root.isConnected) return;
      const owner = account === creator;
      const access = members.find(member => member.wallet === account && member.expiresAt > now);
      const pending = this.pending();
      const payment = account ? readMembershipPayment(localStorage,account) : undefined;
      const unlocked = key && this.identity?.record.key === key.key;
      let html = `<h2>Creator membership</h2><p>${members.filter(member=>member.expiresAt>now).length} active paid subscribers</p>`;
      html += plan ? `<p><strong>${e(formatAmount(String(plan.data.priceWei),18))} Sepolia ETH</strong> for 30 days</p>` : '<p>This creator has yet to publish a membership price.</p>';
      html += '<p>Members receive future creator-approved signals. Each signal includes its source and publication time.</p>';
      html += '<p data-member-status role="status"></p>' + actionButton('refresh','Refresh membership');
      if (!supported) { root.innerHTML = html + notice('Private access requires a browser with Web Crypto X25519 support. Use an up-to-date Chrome browser.'); return; }
      if (!account) { root.innerHTML = html + notice('Connect your wallet using the header to set up private access.'); return; }
      if (pending) html += notice('An Arkiv write needs recovery. Reuse its original request before starting another write.') + actionButton('recover-write','Recover '+pending.kind+' write');
      if (!key) html += '<section><h3>Set up private access</h3><p>Create a separate encryption key and keep its recovery code. The encrypted backup is stored on Arkiv for 180 days.</p>'+actionButton('create-key','Create encryption key')+'<div data-key-setup></div></section>';
      else if (!unlocked) html += `<form data-member-form="unlock"><h3>Unlock private access</h3>${field('recovery','Recovery code',{required:true,type:'password'})}<button class="button secondary">Unlock in this browser</button></form>`;
      else html += '<p>Private access unlocked in this tab.</p>' + actionButton('lock','Lock private access');
      if (owner && key) html += `<form data-member-form="plan"><h3>Membership price</h3>${field('price','Sepolia ETH for 30 days',{required:true,value:plan?formatAmount(String(plan.data.priceWei),18):'0.0001'})}<button class="button primary">${plan?'Update':'Publish'} membership price</button></form>`;
      if (payment) html += `<section><h3>Recover your payment</h3><p>Creator <code>${e(payment.creator)}</code> · ${e(formatAmount(payment.priceWei,18))} Sepolia ETH</p>${transactionLink(payment.hash,'sepolia')}<form data-member-form="claim">${field('hash','Original Sepolia transaction hash',{required:true,value:payment.hash,placeholder:'0x…'})}<button class="button primary">Verify payment and activate</button></form>${actionButton('failed-payment','Check and clear a failed transaction')}<p>An uncertain payment uses this original transaction for recovery.</p></section>`;
      else if (!owner && plan) html += `<form data-member-form="subscribe" data-plan="${plan.key}"><p>Pay <code>${e(creator)}</code> directly on Sepolia, chain 11155111. Access starts after the verified Arkiv claim.</p><label class="check-field"><input type="checkbox" name="reviewed" required> I reviewed the creator, price, network, and 30-day term.</label><button class="button primary" ${unlocked && !pending ? '' : 'disabled'}>${access?'Renew':'Subscribe'} · ${e(formatAmount(String(plan.data.priceWei),18))} Sepolia ETH</button></form>`;
      if (access) html += `<p>Membership expires ${e(new Date(access.expiresAt).toLocaleString())}.</p>`;
      if (owner && unlocked) html += `<form data-member-form="signal"><h3>Publish to your members</h3>${field('title','Title',{required:true})}${field('body','Reviewed signal or strategy instructions',{required:true,area:true})}<details><summary>Attach editable strategy rules</summary><p>Paste exported strategy JSON configured for virtual funds.</p>${field('strategy','Strategy JSON (optional)',{area:true})}${this.options.getDraft?actionButton('attach-draft','Attach current canvas'):''}</details><label class="field"><span>Source</span><select name="source"><option value="manual">Creator</option><option value="ai-proposal">AI proposal reviewed by creator</option><option value="rule-engine">Rule engine reviewed by creator</option></select></label><label class="check-field"><input name="approved" type="checkbox" required> I reviewed and approve this signal for my current members.</label><button class="button primary">Encrypt and publish</button></form>`;
      html += '<section data-private-feed><h3>Exclusive signals</h3>'+ (owner || access ? '<p>Unlock private access to read your signals.</p>' : '<p>An active paid membership gives access to future signals.</p>') + '</section>';
      html += '<p class="muted">Received signals can be saved or copied. Keep your recovery code safe. Poros cannot restore it.</p>';
      root.innerHTML = html;
      this.accessDeadline = owner ? Infinity : access ? performance.now() + Math.max(0,access.expiresAt-now) : 0;
      if (access) this.expiryTimer = setTimeout(()=>{
        void this.load();
      },Math.min(access.expiresAt-now,2147483647));
      if (unlocked && (owner || access)) await this.feed(generation, owner, access?.expiresAt);
    } catch(error) {
      if (generation === this.generation && root === this.root) this.status(errors[errorCode(error)] ?? 'Membership verification is unavailable. Try refreshing.');
    }
  }
  private async feed(generation: number, owner: boolean, expiresAt?: number) {
    const identity = this.identity;
    if (!identity || !this.creator) return;
    const signals = await this.service.signals(this.creator);
    const items: string[] = [];
    for (const signal of signals) {
      let box: KeyBox;
      if (owner) {
        if (signal.data.creatorKey !== identity.record.key) continue;
        box = signal.data.creatorBox as unknown as KeyBox;
      } else {
        const envelope = await this.service.getEnvelope(signal,identity.account);
        if (!envelope || envelope.data.keyRecord !== identity.record.key) continue;
        box = envelope.data.box as unknown as KeyBox;
      }
      const context = signal.actor + ':' + signal.requestId;
      const contentKey = await openContentKey(box,identity.privateKey,context+':'+identity.account);
      const content = await decryptSignal({iv:String(signal.data.iv),ciphertext:String(signal.data.ciphertext)},contentKey,context);
      const publishedAt = await this.readers.blockTimestamp(BigInt(signal.createdAtBlock));
      if (generation !== this.generation) return;
      this.signals.set(signal.key, content);
      items.push(`<article class="paper-panel member-strategy-card" draggable="true" data-signal="${signal.key}"><h3>${e(content.title)}</h3><p class="preserve">${e(content.body)}</p>${content.communityKey?`<a href="/community#/community/${content.communityKey}">Selected community</a>`:''}<small>${e(signal.data.source)} · ${e(new Date(publishedAt).toLocaleString())}</small><p>${content.strategy?'Editable strategy attached.':'Text instructions require 0G interpretation before editing.'} Drag onto the strategy canvas.</p>${this.options.openStrategy?actionButton('open-strategy','Load on canvas',`data-key="${signal.key}"`):`<a class="button secondary" href="/">Open strategy builder</a>`}${owner?actionButton('deliver','Complete delivery',`data-key="${signal.key}"`):''}</article>`);
    }
    if (!owner && (!expiresAt || expiresAt <= await this.readers.now())) return;
    if (generation !== this.generation || !this.root?.isConnected) return;
    this.root.querySelector('[data-private-feed]')!.innerHTML = '<h3>Exclusive signals</h3>'+(items.join('')||'<p>Your future signals will appear here.</p>');
  }
  private async action(action: string, key?: string) {
    if (action === 'refresh') { await this.load(); return; }
    if (action === 'lock') { this.lock(); await this.load(); return; }
    const account = await this.checkAccount();
    if (action === 'open-strategy' && key) {
      const content = this.signals.get(key);
      if (!content || performance.now() >= this.accessDeadline) failure('MEMBERSHIP_EXPIRED');
      await this.options.openStrategy?.(memberStrategy(content,key));
      this.status('Strategy sent to the canvas for review.');
    } else if (action === 'attach-draft' && this.options.getDraft) {
      const input = this.root?.querySelector<HTMLTextAreaElement>('[name="strategy"]');
      if (input) input.value = JSON.stringify(this.options.getDraft(),null,2);
    } else if (action === 'create-key') {
      const generation = this.generation;
      const generated = await createEncryptionIdentity(account);
      await this.checkAccount(account);
      if (generation !== this.generation) failure('ACCOUNT_CHANGED');
      this.generated = generated;
      const slot = this.root?.querySelector('[data-key-setup]');
      if (slot) slot.innerHTML = `<form data-member-form="register-key"><label class="field"><span>Save this recovery code privately</span><input readonly value="${e(this.generated.recoveryCode)}" autocomplete="off"></label><label class="check-field"><input name="saved" type="checkbox" required> I saved my recovery code securely.</label><button class="button primary">Register encrypted backup in wallet</button></form>`;
      this.status('Save your recovery code before registering.');
    } else if (action === 'recover-write') {
      const pending = this.pending();
      if (!pending) { await this.load(); return; }
      await this.write(pending,true);
      await this.load();
      this.status('Original write recovered and verified.');
    } else if (action === 'deliver' && key && keyPattern.test(key)) {
      await this.deliver(await this.service.readSignal(key as Hex));
      this.status('Delivery verified for the members active at publication.');
    } else if (action === 'failed-payment') {
      const payment = readMembershipPayment(localStorage,account);
      if (!payment?.hash) failure('PAYMENT_UNVERIFIED');
      const client = this.readers.payments;
      if (await client.getChainId() !== 11155111) failure('WRONG_CHAIN');
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
      case 'register-key': {
        const generated = this.generated;
        if (!generated || !data.has('saved')) failure('INVALID_INPUT');
        if (await this.service.getKey(account)) failure('CONCURRENT_UPDATE');
        const record = await this.write({...base,kind:'key',identity:generated.identity});
        if (generation !== this.generation) failure('ACCOUNT_CHANGED');
        this.identity = {account,record,privateKey:generated.privateKey}; this.generated = undefined;
        break;
      }
      case 'unlock': {
        const record = await this.service.getKey(account);
        if (!record) failure('KEY_REQUIRED');
        const privateKey = await restoreEncryptionIdentity(account,record.data as unknown as EncryptionIdentity,text('recovery'));
        await this.checkAccount(account);
        if (generation !== this.generation) failure('ACCOUNT_CHANGED');
        this.identity = {account,record,privateKey};
        form.reset(); break;
      }
      case 'plan': {
        if (creator !== account || !await this.service.getKey(account)) failure('KEY_REQUIRED');
        const plan = await this.service.getPlan(account);
        await this.write({...base,kind:'plan',priceWei:parseAmount(text('price'),18),previousKey:plan?.key}); break;
      }
      case 'subscribe': {
        if (!data.has('reviewed') || !this.identity || this.pending()) failure('KEY_REQUIRED');
        const plan = await this.service.getPlan(creator), key = await this.service.getKey(account);
        if (!plan || !key || key.key !== this.identity.record.key) failure('KEY_REQUIRED');
        if (plan.key !== form.dataset.plan) failure('CONCURRENT_UPDATE');
        const payment = {...base,buyer:account,creator,planKey:plan.key,keyRecord:key.key,priceWei:String(plan.data.priceWei),attempted:false};
        await sendMembershipPayment(this.wallet!,payment,localStorage,async()=>{
          if ((await this.service.getPlan(creator))?.key !== plan.key) failure('CONCURRENT_UPDATE');
          const creatorKey = await this.service.getKey(creator);
          if (!creatorKey || (await this.service.getKey(account))?.key !== key.key) failure('KEY_REQUIRED');
          await sealContentKey(new Uint8Array(32),String(creatorKey.data.publicKey),'key-check');
          await sealContentKey(new Uint8Array(32),String(key.data.publicKey),'key-check');
          const evidence = await this.service.renewalEvidence(creator,account,await this.readers.now());
          await this.readers.assertRetention(await this.service.retentionEvidence([plan,key,creatorKey,...evidence.records]),evidence.expiresAt);
        },navigator.locks);
        await this.load(); this.status('Payment submitted. After two confirmations, verify it and approve the Arkiv claim.'); return;
      }
      case 'claim': {
        const payment = readMembershipPayment(localStorage,account), hash = text('hash').trim().toLowerCase();
        if (!payment || !keyPattern.test(hash) || (payment.hash && payment.hash !== hash)) failure('INVALID_INPUT');
        const plan = await this.service.readPlan(payment.planKey);
        if (plan.actor !== payment.creator || plan.data.priceWei !== payment.priceWei) failure('INTEGRITY_FAILED');
        await verifyMembershipPayment(this.readers.payments,{transactionHash:hash as Hex,buyer:account,creator:payment.creator,priceWei:payment.priceWei});
        payment.hash = hash as Hex;
        saveMembershipPayment(localStorage,payment);
        await this.write({actor:account,requestId:payment.requestId,kind:'claim',planKey:payment.planKey,keyRecord:payment.keyRecord,transactionHash:payment.hash});
        break;
      }
      case 'signal': {
        if (!data.has('approved')) failure('INVALID_INPUT');
        const strategy = text('strategy').trim();
        await this.publishSignal({title:text('title'),body:text('body'),...(strategy?{strategy:JSON.parse(strategy)}:{})},text('source') as EncryptedSignal['source']);
        form.reset();
        break;
      }
    }
    await this.load();
    this.status('Saved and verified.');
    this.options.saved?.();
  }
  async publishPost(content: SignalContent) {
    if (this.busy) failure('CONCURRENT_UPDATE');
    this.busy = true;
    try {
      await this.publishSignal(content,'manual');
      await this.load();
      this.status('Exclusive post saved and delivery verified.');
    } finally { this.busy = false; }
  }
  private async publishSignal(content: SignalContent, source: EncryptedSignal['source']) {
    const account = await this.checkAccount(), identity = this.identity;
    if (account !== this.creator || !identity) failure('KEY_REQUIRED');
    const requestId = crypto.randomUUID(), context = account+':'+requestId;
    const encrypted = await encryptSignal(content,context);
    const box = await sealContentKey(encrypted.key,String(identity.record.data.publicKey),context+':'+account);
    const signal = await this.write({actor:account,requestId,kind:'signal',encrypted:{iv:encrypted.iv,ciphertext:encrypted.ciphertext,creatorKey:identity.record.key,creatorBox:box,source}});
    this.status('Post saved. Approve the remaining recipient transactions to finish delivery.');
    await this.deliver(signal);
  }
  private async deliver(signal: EventDTO) {
    const account = await this.checkAccount(), identity = this.identity;
    if (!identity || signal.actor !== account || signal.data.creatorKey !== identity.record.key) failure('KEY_REQUIRED');
    const context = account+':'+signal.requestId;
    const key = await openContentKey(signal.data.creatorBox as unknown as KeyBox,identity.privateKey,context+':'+account);
    const recipients = await this.service.recipients(signal);
    for (const recipient of recipients) {
      await this.checkAccount(account);
      if (await this.service.getEnvelope(signal,recipient.wallet)) continue;
      const box = await sealContentKey(key,String(recipient.key.data.publicKey),context+':'+recipient.wallet);
      await this.write({actor:account,requestId:crypto.randomUUID(),kind:'envelope',signalKey:signal.key,recipient:recipient.wallet,keyRecord:recipient.key.key,box});
    }
  }
}
