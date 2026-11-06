import type { Hex } from 'viem';
import type { Source } from './contracts.ts';
export type Kind = 'versions' | 'communities' | 'posts';
export type Value = string | number | boolean | bigint | Uint8Array;
export type Values = Record<string, Value>;
export interface StoredEntity {
  kind: Kind; key: Hex; creator: Hex; owner: Hex; createdAt: bigint; expiresAt: bigint;
  readonly: boolean; permissionlessExtension: boolean; values: Values;
}
export interface Filter { field: string; value: Exclude<Value, Uint8Array>; prefix?: boolean }
export interface EntityPage { entities: StoredEntity[]; blockNumber: bigint; rawCount: number; skipped: number }
export interface Inclusion { entityKey: Hex; txHash: Hex; expiresAt?: bigint }
export interface Writer {
  account: Hex; assertCurrent(): Promise<void>;
  create(kind: Kind, values: Values, readonly: boolean, durationDays?: number): Promise<Inclusion>;
  patch(entityKey: Hex, values: Values): Promise<Inclusion>;
  extend(entityKey: Hex, durationDays?: number): Promise<Inclusion>;
  delete(entityKey: Hex): Promise<Inclusion>;
}
// Internal test seam; callers use the public facade, never this transport contract.
export interface Backend {
  source: Source;
  get(key: Hex): Promise<StoredEntity>;
  query(kind: Kind, filters: Filter[], page: { offset: number; limit: number; afterKey?: Hex }): Promise<EntityPage>;
  currentBlock(): Promise<bigint>;
  writer(): Promise<Writer>;
}
