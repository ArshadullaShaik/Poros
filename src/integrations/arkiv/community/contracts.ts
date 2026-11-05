import type { Hex } from 'viem';
import type { Json, Source, ArkivStore } from '../contracts.ts';
export type EventType = 'profile' | 'membership' | 'ban' | 'hidden' | 'moderator' | 'vote' | 'thread' | 'reply' | 'message' | 'listing' | 'delisted' |
  'creator-plan' | 'encryption-key' | 'subscription' | 'private-signal' | 'signal-envelope';
export interface EventInput { type: EventType; actor: Hex; subject: string; scope: string; requestId: string; data: Record<string, Json> }
export interface EventRecord extends EventInput { eventSchema: 'social-event/1'; hash: Hex }
export interface EventDTO extends EventRecord { key: Hex; createdAtBlock: string; expiresAtBlock: string; source: Source; txHash?: Hex }
export interface EventFilter { type?: EventType; subject?: string; scope?: string; actor?: Hex; requestId?: string; afterBlock?: string }
export interface EventRepository {
  source: Source;
  actor(): Promise<Hex>;
  read(key: Hex): Promise<EventDTO>;
  scan(filter: EventFilter): Promise<EventDTO[]>;
  append(input: EventInput): Promise<EventDTO>;
}
export interface ProfileInput { requestId: string; handle: string; displayName: string; bio: string; previousKey?: Hex }
export interface Profile { userId: string; wallet: Hex; handle: string; displayName: string; bio: string; key: Hex; source: Source }
export interface VoteSummary { score: number; up: number; down: number; viewerVote: -1 | 0 | 1 }
export interface Currency { chainId: number; token: Hex; decimals: number }
export interface ListingInput {
  requestId: string; packageId: string; contentHash: Hex; title: string; description: string;
  terms: string; currency: Currency; amount: string;
}
export interface Listing { key: Hex; seller: Hex; packageId: string; contentHash: Hex; title: string; description: string;
  terms: string; currency: Currency; amount: string; active: boolean; expiresAtBlock: string; source: Source }
export interface HubOptions { events: EventRepository; strategies: ArkivStore }
