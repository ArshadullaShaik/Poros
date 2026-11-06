import type { EIP1193Provider, Hex, Transport } from 'viem';
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Source = 'arkiv' | 'mock';
export type Category = 'dca' | 'rebalance' | 'signal' | 'other';
export interface StrategyDocumentV1 {
  documentSchema: 'strategy-document/1'; graphSchema: string; name: string;
  description: string; license: 'MIT' | 'Apache-2.0' | 'CC0-1.0';
  executionChainId: number; tokenIn: Hex; tokenOut: Hex; category: Category; graph: Json;
}
export type ValidateStrategyDocument = (input: unknown) => StrategyDocumentV1;
export interface VersionRecord {
  recordSchema: 'strategy-version/1'; creator: Hex; strategyId: Hex; requestId: string;
  rootVersionKey?: Hex; parentVersionKey?: Hex; forkSourceVersionKey?: Hex;
  forkSourceContentHash?: Hex; communityKey?: Hex; contentHash: Hex; recordHash: Hex;
  document: StrategyDocumentV1;
}
export interface VersionDTO extends VersionRecord {
  versionKey: Hex; owner: Hex; createdAtBlock: string; expiresAtBlock: string; source: Source;
  lineageStatus: 'verified' | 'missing-ancestor'; communityStatus: 'none' | 'live' | 'unavailable';
}
export interface StrategySummaryDTO {
  strategyId: Hex; rootVersionKey: Hex; creator: Hex; name: string; category: Category;
  executionChainId: number; tokenIn: Hex; tokenOut: Hex; communityKey?: Hex;
  forkSourceVersionKey?: Hex; expiresAtBlock: string; source: Source;
}
export interface CommunityDTO {
  communityKey: Hex; creator: Hex; owner: Hex; name: string; description: string;
  contentHash: Hex; expiresAtBlock: string; source: Source;
}
export interface PostDTO {
  postKey: Hex; communityKey: Hex; strategyVersionKey?: Hex; creator: Hex; body: string;
  recordHash: Hex; createdAtBlock: string; expiresAtBlock: string; source: Source;
}
export interface PageInput { offset?: number; limit?: number }
export interface Page<T> {
  items: T[]; offset: number; limit: number; nextOffset: number | null;
  blockNumber: string; skipped: number; source: Source;
}
export interface HistoryDTO {
  versions: VersionDTO[]; tipVersionKeys: Hex[]; complete: boolean; nextOffset: number | null; source: Source;
}
export interface WriteReceipt<T> {
  value: T; txHash: Hex; entityKey: Hex; expiresAtBlock: string; source: Source; readBackVerified: true;
}
export type CreateResult<T> = { state: 'written'; receipt: WriteReceipt<T> } | {
  state: 'recovered'; value: T; entityKey: Hex; source: Source; txHash?: Hex; readBackVerified: true;
};
export type RenewResult = { state: 'unchanged'; entityKey: Hex; expiresAtBlock: string; source: Source }
  | { state: 'extended'; receipt: WriteReceipt<{ entityKey: Hex; expiresAtBlock: string }> };
export interface StrategyFilters {
  creator?: Hex; category?: Category; executionChainId?: number; communityKey?: Hex;
  namePrefix?: string; page?: PageInput;
}
export interface WalletContext {
  account: Hex; provider: EIP1193Provider; requestRabdiSwitch?: () => Promise<void>;
}
export interface StoreOptions {
  publicTransport?: Transport; accessKey?: string;
  getWalletContext?: () => Promise<WalletContext>;
  validateStrategyDocument?: ValidateStrategyDocument;
}
export interface ArkivStore {
  listStrategies(input?: StrategyFilters): Promise<Page<StrategySummaryDTO>>;
  getVersion(input: { versionKey: Hex }): Promise<VersionDTO>;
  listVersions(input: { rootVersionKey: Hex; page?: PageInput }): Promise<HistoryDTO>;
  publishStrategy(input: { requestId: string; document: unknown; communityKey?: Hex }): Promise<CreateResult<VersionDTO>>;
  publishVersion(input: { requestId: string; rootVersionKey: Hex; expectedParentVersionKey: Hex; document: unknown }): Promise<CreateResult<VersionDTO>>;
  forkVersion(input: { requestId: string; sourceVersionKey: Hex; document: unknown; communityKey?: Hex }): Promise<CreateResult<VersionDTO>>;
  listCommunities(input?: { creator?: Hex; page?: PageInput }): Promise<Page<CommunityDTO>>;
  getCommunity(input: { communityKey: Hex }): Promise<CommunityDTO>;
  createCommunity(input: { requestId: string; name: string; description: string; durationDays?: number }): Promise<CreateResult<CommunityDTO>>;
  updateCommunity(input: { communityKey: Hex; name: string; description: string }): Promise<WriteReceipt<CommunityDTO>>;
  listPosts(input: { communityKey: Hex; page?: PageInput }): Promise<Page<PostDTO>>;
  createPost(input: { requestId: string; communityKey: Hex; strategyVersionKey?: Hex; body: string }): Promise<CreateResult<PostDTO>>;
  extendOwnedEntity(input: { entityKey: Hex; durationDays?: number }): Promise<RenewResult>;
  deleteOwnedEntity(input: { entityKey: Hex }): Promise<{ entityKey: Hex; txHash: Hex; source: Source; readBackMissing: true }>;
  reconcileRequest(input: { creator: Hex; requestId: string }): Promise<{ state: 'absent' | 'one' | 'duplicates'; entityKeys: Hex[]; source: Source }>;
}
