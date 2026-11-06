import type { Backend, Kind, StoredEntity, Values, Writer, Filter } from '../../../src/integrations/arkiv/backend.ts';
import type { ArkivStore, ValidateStrategyDocument } from '../../../src/integrations/arkiv/contracts.ts';
import { createStorageService } from '../../../src/integrations/arkiv/service.ts';
import { StorageError } from '../../../src/integrations/arkiv/errors.ts';
type Key = `0x${string}`;
export class MemoryBackend implements Backend {
  source = 'mock' as const; entities = new Map<Key, StoredEntity>(); block = 100n;
  account: Key | undefined; signed = 0; checks = 0; timeoutAfterCreate = false;
  failReadAfterCreate = false; changedAccount = false; unavailable = false; counter = 0;
  async currentBlock() { return this.block; }
  async get(key: Key) {
    if (this.unavailable) throw new StorageError('NETWORK_UNAVAILABLE');
    const e = this.entities.get(key);
    if (!e || e.expiresAt <= this.block) throw new StorageError('NOT_FOUND_OR_EXPIRED');
    return structuredClone(e);
  }
  async query(kind: Kind, filters: Filter[], page: {offset:number; limit:number; afterKey?:Key}) {
    if (this.unavailable) throw new StorageError('NETWORK_UNAVAILABLE');
    const rows = [...this.entities.values()].filter(e => e.kind === kind && e.expiresAt > this.block &&
      (!page.afterKey || e.key > page.afterKey) && filters.every(f => {
        const val = f.field === '$creator' ? e.creator : f.field === '$owner' ? e.owner : e.values[f.field];
        return f.prefix ? String(val).startsWith(String(f.value)) : val === f.value;
      })).sort((a,b) => a.key.localeCompare(b.key));
    const entities = rows.slice(page.offset, page.offset + page.limit).map(e => structuredClone(e));
    return { entities, blockNumber: this.block, rawCount: entities.length, skipped: 0 };
  }
  async writer(): Promise<Writer> {
    if (!this.account) throw new StorageError('WALLET_REQUIRED');
    const account = this.account;
    const guard = async (key?: Key) => {
      this.checks++;
      if (this.changedAccount || account !== this.account) throw new StorageError('ACCOUNT_CHANGED');
      if (key && (await this.get(key)).owner !== account) throw new StorageError('NOT_OWNER');
    };
    const receipt = (entityKey: Key) => ({ entityKey, txHash: `0x${(++this.signed).toString(16).padStart(64,'0')}` as Key });
    return {
      account, assertCurrent: () => guard(),
      create: async (kind, values, readonly, durationDays) => {
        await guard(); this.block++;
        const key = `0x${(++this.counter).toString(16).padStart(64,'0')}` as Key;
        const result = receipt(key);
        const addedBlocks = BigInt(durationDays ? durationDays * 7200 : 1_296_000);
        this.entities.set(key, { kind, key, creator: account, owner: account, createdAt: this.block,
          expiresAt: this.block+addedBlocks, readonly, permissionlessExtension: false, values:structuredClone(values) });
        if (this.timeoutAfterCreate) { this.timeoutAfterCreate=false; throw new StorageError('WRITE_STATUS_UNKNOWN', undefined, {txHash:result.txHash}); }
        if (this.failReadAfterCreate) this.unavailable=true;
        return { ...result, expiresAt:this.block+addedBlocks };
      },
      patch: async (key, values) => {
        await guard(key); const e = this.entities.get(key)!;
        if (e.readonly) throw new StorageError('TRANSACTION_FAILED');
        Object.assign(e.values,structuredClone(values)); this.block++; return receipt(key);
      },
      extend: async (key, durationDays) => { await guard(key); const e=this.entities.get(key)!; this.block++;
        const addedBlocks = BigInt(durationDays ? durationDays * 7200 : 1_296_000);
        e.expiresAt=this.block+addedBlocks; return {...receipt(key),expiresAt:e.expiresAt}; },
      delete: async key => { await guard(key); this.entities.delete(key);this.block++;return receipt(key); },
    };
  }
}
export function createMockArkivStore(options: { account?: Key; validateStrategyDocument?: ValidateStrategyDocument } = {}): {store:ArkivStore; backend:MemoryBackend} {
  const backend=new MemoryBackend(); backend.account=options.account;
  return {store:createStorageService(backend,options.validateStrategyDocument),backend};
}
