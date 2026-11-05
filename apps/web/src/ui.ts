import type { CommunityDTO, StrategySummaryDTO } from '../../../src/integrations/arkiv/index.ts';
import type { EventDTO, Listing, VoteSummary } from '../../../src/integrations/arkiv/community/index.ts';
import type { Hex } from 'viem';
import { escape as e, short, formatAmount, currencyLabel } from './core.ts';
import { icon, mark } from './icons.ts';
export const button = (action: string, label: string, kind = 'primary', extra = '') => `<button class="button ${kind}" data-action="${action}" ${extra}>${label}</button>`;
export const link = (href: string, label: string, kind = 'primary') => `<a class="button ${kind}" href="#${href}">${label}</a>`;
export const avatar = (seed: string) => `<span class="avatar tone-${parseInt(seed.slice(-2), 16) % 4}">${e(seed.slice(-2).toUpperCase())}</span>`;
export const tag = (text: string, kind = '') => `<span class="tag ${kind}">${e(text)}</span>`;
export function strategyRows(rows: StrategySummaryDTO[], label: (wallet: string) => string) {
    return rows.map((row, i) => `<a class="strategy-row" href="#/strategies/${row.rootVersionKey}">
  <span class="strategy-glyph glyph-${i % 3}">${icon(['leaf', 'grid', 'fork'][i % 3]!)}</span><span class="strategy-name"><strong>${e(row.name)}</strong><small>by ${e(label(row.creator))} <span>·</span> ${e(short(row.rootVersionKey))}</small></span>
  ${tag(row.category)}<span class="chain-label">${row.source === 'mock' ? 'Example network' : 'Chain ' + row.executionChainId}</span><span class="row-arrow">${icon('arrow')}</span></a>`).join('');
}
export function communityCards(rows: CommunityDTO[]) { return rows.map((row, i) => `<a class="community-card" href="#/community/${row.communityKey}"><div class="community-card-top"><span class="community-symbol symbol-${i % 3}">${['₿', '$', '⌘'][i % 3]}</span>${icon('arrow')}</div><h3>${e(row.name)}</h3><p>${e(row.description)}</p><span class="card-bottom">Open conversation ${icon('right')}</span></a>`).join(''); }
export function listingCards(rows: Listing[], label: (wallet: string) => string, payment?: {
    currency: Listing['currency'];
    symbol: string;
}) { return rows.map(row => `<a class="listing-card" href="#/listing/${row.key}"><div class="listing-art">${mark}<span>${icon('lock')} PRIVATE STRATEGY</span></div><div class="listing-copy"><span class="eyebrow">${e(label(row.seller))}</span><h3>${e(row.title)}</h3><p>${e(row.description)}</p><div class="listing-bottom"><strong>${e(formatAmount(row.amount, row.currency.decimals))} <small>${e(currencyLabel(row, payment))}</small></strong>${tag(row.active ? 'Available' : 'Delisted', row.active ? 'green' : '')}</div></div></a>`).join(''); }
export function sortThreads(rows: EventDTO[], votes: Record<Hex, VoteSummary>, order: 'new'|'top') { return [...rows].sort((a,b)=>
  order==='top' && (votes[a.key]?.score??0)!==(votes[b.key]?.score??0)?(votes[b.key]?.score??0)-(votes[a.key]?.score??0):
  BigInt(a.createdAtBlock)>BigInt(b.createdAtBlock)?-1:BigInt(a.createdAtBlock)<BigInt(b.createdAtBlock)?1:b.key.localeCompare(a.key)); }
function voteControls(row:EventDTO,votes:Record<Hex,VoteSummary>,canVote:boolean){const vote=votes[row.key];if(!vote)return '';
  return `<div class="vote-controls" aria-label="Votes"><button type="button" data-action="vote" data-key="${row.key}" data-value="1" aria-label="Upvote" aria-pressed="${vote.viewerVote===1}" ${canVote?'':'disabled'}>▲</button><strong>${vote.score}</strong><button type="button" data-action="vote" data-key="${row.key}" data-value="-1" aria-label="Downvote" aria-pressed="${vote.viewerVote===-1}" ${canVote?'':'disabled'}>▼</button></div>`;}
export function threadRows(rows: EventDTO[], label: (wallet: string) => string, owner = false, votes:Record<Hex,VoteSummary>={}, canVote=false) { return rows.map(row => `<article class="thread-row"><div class="thread-heading">${avatar(row.actor)}<span><a href="#/profile/${row.actor}">${e(label(row.actor))}</a><small>Block ${e(row.createdAtBlock)}</small></span>${owner ? button('hide', icon('close'), 'icon-button', `data-key="${row.key}" aria-label="Hide thread"`) : ''}</div><a class="thread-title" href="#/thread/${row.scope}/${row.key}">${e(row.data.title)}</a><p>${e(row.data.body)}</p><div class="thread-actions">${voteControls(row,votes,canVote)}<a class="text-link" href="#/thread/${row.scope}/${row.key}">${icon('message')} Open discussion ${icon('right')}</a></div></article>`).join(''); }
export function messageRows(rows: EventDTO[], label: (wallet: string) => string, owner = false, votes:Record<Hex,VoteSummary>={}, canVote=false) { return rows.map(row => `<article class="chat-message">${avatar(row.actor)}<div><div class="message-meta"><a href="#/profile/${row.actor}">${e(label(row.actor))}</a><small>Block ${e(row.createdAtBlock)}</small></div><p>${e(row.data.body)}</p>${voteControls(row,votes,canVote)}</div>${owner ? button('hide', icon('close'), 'icon-button', `data-key="${row.key}" aria-label="Hide message"`) : ''}</article>`).join(''); }
export function empty(title: string, description: string, action = '') { return `<div class="empty-state"><span class="empty-icon">${icon('leaf')}</span><h3>${e(title)}</h3><p>${e(description)}</p>${action}</div>`; }
export function heading(kicker: string, title: string, description: string, action = '') { return `<div class="page-heading"><div><span class="eyebrow">${e(kicker)}</span><h1 tabindex="-1">${e(title)}</h1><p>${e(description)}</p></div>${action}</div>`; }
export const notice = (text: string, kind = '') => `<div class="notice ${kind}">${icon('info')}<span>${e(text)}</span></div>`;
export const field = (name: string, label: string, options: {
    value?: string;
    area?: boolean;
    placeholder?: string;
    required?: boolean;
    hint?: string;
    type?: string;
    pattern?: string;
} = {}) => `<label class="field"><span>${e(label)}</span>${options.area ? `<textarea name="${name}" rows="${name === 'strategy' || name === 'document' ? 10 : 3}" ${options.required ? 'required' : ''} placeholder="${e(options.placeholder ?? '')}">${e(options.value ?? '')}</textarea>` : `<input name="${name}" type="${options.type ?? 'text'}" value="${e(options.value ?? '')}" ${options.required ? 'required' : ''} ${options.pattern ? `pattern="${e(options.pattern)}"` : ''} placeholder="${e(options.placeholder ?? '')}">`}${options.hint ? `<small>${e(options.hint)}</small>` : ''}</label>`;
export function communityCreation(preview: boolean, account: Hex | undefined, walletAvailable: boolean) {
    if (preview) return notice('Switch to live Rabdi to create your community.') + button('live', 'Use live community');
    if (!account) return notice('Connect MetaMask and select Rabdi to create a public community. Your wallet needs Rabdi tGLM for gas.') +
        (walletAvailable ? button('connect', 'Connect MetaMask') : notice('Open this page in Chrome with MetaMask enabled, then reload.'));
    return `<form data-form="community"><p>Creating as <code>${e(account)}</code></p>${field('name', 'Community name', {required: true, placeholder: 'Your community name'})}${field('description', 'What brings this community together?', {area: true, placeholder: 'Describe the discussions you want to host.'})}${notice('Community details are public on Arkiv for 180 days. Review and approve the Rabdi transaction in your wallet. Creation uses tGLM gas.')}<p class="form-error" role="alert"></p><button class="button primary">Create community</button></form>`;
}
export const errors: Record<string, string> = {
    ORDER_NOT_PAYABLE: 'This order is too close to its payment deadline. Do not approve an old wallet prompt. Recover any existing transaction before starting another order.',
    PREVIEW_ONLY: 'This is a read-only design preview. Switch to Rabdi to use real data.', WALLET_REQUIRED: 'Connect your MetaMask wallet to continue.', DEPENDENCY_UNAVAILABLE: 'This connection is not ready yet. Check connection details or try again shortly.',
    '-32002': 'A wallet request is already open. Check MetaMask to continue.',
    WRONG_CHAIN: 'Switch your wallet to the required network before continuing.', ACCOUNT_CHANGED: 'Your wallet changed. Sign in again before continuing.', USER_REJECTED: 'You cancelled the wallet request. Your draft is still here.', INVALID_INPUT: 'Check your input, byte limits, network and token configuration.',
    AUTH_REQUIRED: 'Sign in to the marketplace to continue.', AUTH_INVALID: 'Your sign-in could not be verified. Request a fresh sign-in.', INSUFFICIENT_GAS: 'Your wallet needs the native gas token for this network.',
    CONCURRENT_UPDATE: 'This record changed. Refresh and review the latest version before editing.', STALE_PARENT: 'A new strategy version exists. Review it before publishing a revision.', MULTIPLE_TIPS: 'This strategy has conflicting versions. Resolve the history before revising.',
    HISTORY_INCOMPLETE: 'The available history is incomplete or exceeds this release’s limit. Your last loaded view is preserved.', NOT_OWNER: 'Your current wallet does not have permission. Check membership and moderation status.',
    NOT_FOUND_OR_EXPIRED: 'This record is unavailable or has expired.', NOT_FOUND: 'This item is unavailable.', RATE_LIMITED: 'The read service is busy. Wait a moment, then refresh.', NETWORK_UNAVAILABLE: 'The network could not be reached. Your previous view is preserved.',
    WRITE_STATUS_UNKNOWN: 'The write outcome is uncertain. Check the original request before signing again.', WRITE_CONFIRMED_READ_PENDING: 'The transaction was included. Read-back verification is still pending.',
    INTEGRITY_FAILED: 'The content could not be verified. It has been blocked.', UNTRUSTED_RECORD: 'This record could not be trusted.', VAULT_INTEGRITY_FAILED: 'The private package could not be verified. Delivery is blocked.',
    PAYMENT_UNVERIFIED: 'Payment is not verified yet. Check the original transaction and retry verification; do not pay again.', PAYMENT_REUSED: 'That transaction is already bound to another order.', PAYMENT_REQUIRED: 'This wallet does not have verified access to that package.',
    LISTING_UNAVAILABLE: 'This listing is not available for a new checkout.', INTENT_CONFLICT: 'This action conflicts with an earlier attempt. Recover the original request first.', IDEMPOTENCY_CONFLICT: 'The original request has different content. Resolve it before creating a new action.',
    DUPLICATE_REQUEST: 'More than one record matches this request. Resolve the conflict before continuing.', UNSUPPORTED_SCHEMA: 'This strategy schema is not supported by the connected validator.', PAYLOAD_TOO_LARGE: 'This content exceeds the storage size limit.', LIMIT_EXCEEDED: 'This request exceeds the service limit.',
};
