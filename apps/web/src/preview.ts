import type { Hex } from 'viem';
import type { CommunityDTO, StrategySummaryDTO, VersionDTO } from '../../../src/integrations/arkiv/index.ts';
import type { EventDTO, Listing, Profile } from '../../../src/integrations/arkiv/community/index.ts';
const key = (n: number) => ('0x' + n.toString(16).padStart(64, '0')) as Hex;
const wallet = (n: number) => ('0x' + n.toString(16).padStart(40, '0')) as Hex;
export interface PreviewData {
    communities: CommunityDTO[];
    strategies: StrategySummaryDTO[];
    versions: VersionDTO[];
    events: EventDTO[];
    listings: Listing[];
    profiles: Profile[];
}
export const preview: PreviewData = {
    communities: [['Bitcoin trading', 'A place to question the thesis, share the research, and build better Bitcoin strategies.'], ['Stablecoin strategies', 'Discuss dollar-cost averaging, stablecoin pairs, and the risk behind the rules.'], ['The strategy workshop', 'Work in progress welcome. Share a draft, explain a decision, and build in public.']].map(([name, description], i) => ({ communityKey: key(i + 1), creator: wallet(i + 1), owner: wallet(i + 1), name: name!, description: description!, contentHash: key(100 + i), expiresAtBlock: '900000', source: 'mock' })),
    strategies: [['Weekly accumulation', 'dca'], ['A calmer rebalance', 'rebalance'], ['RSI with a safety net', 'signal']].map(([name, category], i) => ({ strategyId: key(200 + i), rootVersionKey: key(20 + i), creator: wallet(i + 1), name: name!, category: category as StrategySummaryDTO['category'], executionChainId: 31337, tokenIn: wallet(10), tokenOut: wallet(11), communityKey: key(i + 1), expiresAtBlock: '900000', source: 'mock' })),
    versions: [], events: [], listings: [], profiles: ['the_researcher', 'slow_and_steady', 'open_thesis'].map((handle, i) => ({ userId: 'eip155:7794095:' + wallet(i + 1), wallet: wallet(i + 1), handle, displayName: ['The Researcher', 'Slow & Steady', 'Open Thesis'][i]!, bio: 'An illustrative profile in the read-only design preview.', key: key(400 + i), source: 'mock' })),
};
preview.versions = preview.strategies.map((strategy, i) => ({ recordSchema: 'strategy-version/1', creator: strategy.creator, strategyId: strategy.strategyId, requestId: '00000000-0000-4000-8000-00000000000' + i, contentHash: key(500 + i), recordHash: key(600 + i), versionKey: strategy.rootVersionKey, owner: strategy.creator, createdAtBlock: String(120 + i), expiresAtBlock: '900000', source: 'mock', lineageStatus: 'verified', communityStatus: 'live', communityKey: strategy.communityKey,
    document: { documentSchema: 'strategy-document/1', graphSchema: 'preview-only/no-execution', name: strategy.name, description: ['A measured approach to adding exposure over time. Simple rules, clearly documented.', 'Keep allocations intentional. Revisit the balance before adding complexity.', 'A signal is only a starting point. Put a risk check between the idea and the action.'][i]!, license: 'MIT', executionChainId: 31337, tokenIn: strategy.tokenIn, tokenOut: strategy.tokenOut, category: strategy.category, graph: { notice: 'Read-only illustrative document. Not a trading graph.' } } }));
const event = (n: number, type: EventDTO['type'], community: number, data: EventDTO['data']): EventDTO => ({ eventSchema: 'social-event/1', type, actor: wallet(n % 3 + 1), subject: key(community), scope: key(community), requestId: '00000000-0000-4000-8000-' + String(n).padStart(12, '0'), data, hash: key(700 + n), key: key(800 + n), createdAtBlock: String(130 + n), expiresAtBlock: '900000', source: 'mock' });
preview.events = [
    event(1, 'thread', 1, { title: 'What would make you change your Bitcoin thesis?', body: 'Before sharing an entry, share your invalidation. What evidence would make you reconsider your strategy?' }),
    event(2, 'thread', 1, { title: 'Simple rules are easier to audit', body: 'I am working on a weekly accumulation strategy. The goal is to make every decision legible, including the reasons to do nothing.' }),
    event(3, 'thread', 2, { title: 'Where does your strategy stop?', body: 'A risk policy is part of the strategy. How are you thinking about position limits and market conditions?' }),
    event(4, 'thread', 3, { title: 'Show your work, especially the unfinished parts', body: 'Use this space for feedback on drafts. Explain one decision you are still unsure about.' }),
    event(5, 'reply', 1, { threadKey: key(801), body: 'I would start by writing the assumptions down, then define what breaks each one.' }),
    event(6, 'message', 1, { body: 'Welcome to the research room. What are you building?' }),
    event(7, 'message', 1, { body: 'A simpler accumulation strategy. Trying to keep the rules small enough to explain.' }),
    event(8, 'message', 1, { body: 'Love that. Share the reasoning alongside the draft.' }),
];
preview.listings = [{ key: key(50), seller: wallet(3), packageId: '00000000-0000-4000-8000-000000000050', contentHash: key(550), title: 'The guarded signal toolkit', description: 'An illustrative private strategy listing. Review the terms and code commitment before deciding to buy.', terms: 'Preview only. No purchase or execution is available.', currency: { chainId: 31337, token: wallet(10), decimals: 6 }, amount: '12000000', active: true, expiresAtBlock: '900000', source: 'mock' }];
