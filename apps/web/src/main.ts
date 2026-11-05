import serialize from 'canonicalize';
import { keccak256, toBytes, type Hex } from 'viem';
import type { CommunityDTO, StrategySummaryDTO, VersionDTO, Json, StrategyDocumentV1 } from '../../../src/integrations/arkiv/index.ts';
import type { EventDTO, Listing, Profile, VoteSummary } from '../../../src/integrations/arkiv/community/index.ts';
import type { Order } from '../../../src/integrations/arkiv/marketplace/contracts.ts';
import { compose, type AppIntegration } from './integration.ts';
import { escape as e, short, checkedText, errorCode, failure, keyPattern, walletPattern, formatAmount, parseAmount, validateQuote, PaymentAttempt, verifyDownload, withWalletLock, sendPaymentOnce, currencyMatches, currencyLabel, mergeRecovery, type Quote } from './core.ts';
import { MarketClient } from './market.ts';
import { button, link, tag, avatar, strategyRows, communityCards, communityCreation, listingCards, threadRows, messageRows, sortThreads, empty, heading, notice, field, errors } from './ui.ts';
import { icon, mark, garden } from './icons.ts';
import type { PreviewData } from './preview.ts';
import {createInjectedWallet} from './wallet.ts';
import {validateBuilderDocument} from './strategy-document.ts';
interface PendingWrite {
    account: Hex;
    requestId: string;
    kind: string;
    scope?: Hex;
    expected: Record<string, Json>;
    entityKey?: Hex;
    txHash?: Hex;
}
interface Recovery {
    buyer: Hex;
    orderId: string;
    requestId: string;
    listingKey: Hex;
    hash?: Hex;
    attempted?: boolean;
}
const app = document.querySelector<HTMLElement>('#app')!;
const integration = {wallet:createInjectedWallet(),validateStrategyDocument:validateBuilderDocument,...window.__COMMON_GROUND__};
class Application {
    api = compose(integration);
    market = new MarketClient();
    account: Hex | undefined;
    generation = 0;
    pageSerial = 0;
    busy = false;
    preview: PreviewData | undefined;
    rooms: CommunityDTO[] = [];
    loadedStrategies: StrategySummaryDTO[] = [];
    strategyCursor: number | null = null;
    communityCursor: number | null = null;
    historyCursor: number | null = null;
    skipped = 0;
    profiles = new Map<string, Profile>();
    pending: PendingWrite | undefined;
    activeCommunity: CommunityDTO | undefined;
    activeVersion: VersionDTO | undefined;
    activeListing: Listing | undefined;
    membership: Awaited<ReturnType<typeof this.api.community.getMembership>> | undefined;
    votes: Record<Hex, VoteSummary> = {};
    sortOrder: 'new' | 'top' = 'new';
    attempt: PaymentAttempt | undefined;
    polling = false;
    pollFailures = 0;
    nextPoll = 0;
    sellerDraft: {
        fingerprint: string;
        requestId: string;
        upload?: {
            packageId: string;
            contentHash: Hex;
            terms: string;
            seller: Hex;
        };
    } | undefined;
    renderedRoute = '';
    lastHidden: {
        room: Hex;
        key: Hex;
        owner: Hex;
    } | undefined;
    dialog: HTMLDialogElement | undefined;
    constructor(readonly host: AppIntegration) { }
    async start() {
        try {
            const stored = localStorage.getItem('common-ground.pending-write');
            if (stored) {
                const p = JSON.parse(stored) as PendingWrite;
                if (walletPattern.test(p.account) && /^[0-9a-f-]{36}$/.test(p.requestId) && ['profile', 'membership', 'ban', 'hidden', 'moderator', 'vote', 'thread', 'reply', 'message', 'listing', 'delisted', 'community', 'community-update', 'version'].includes(p.kind) && p.expected && typeof p.expected === 'object')
                    this.pending = p;
            }
        }
        catch { }
        if (new URLSearchParams(location.search).get('preview') === '1') {
            const url = '/community/preview.js';
            this.preview = (await import(url)).preview as PreviewData;
            this.rooms = this.preview.communities;
            for (const p of this.preview.profiles)
                this.profiles.set(p.wallet, p);
        }
        app.innerHTML = this.shell();
        document.querySelector('.skip-link')?.addEventListener('click', event => { event.preventDefault(); document.querySelector<HTMLElement>('#main')!.focus(); });
        window.addEventListener('pagehide', () => { this.generation++; this.market.session.clear(); this.sellerDraft = undefined; this.closeDialog(); });
        app.addEventListener('click', event => {
            const target = (event.target as Element).closest<HTMLElement>('[data-action]');
            if (target) {
                event.preventDefault();
                void this.action(target).catch(error => this.report(error));
            }
        });
        app.addEventListener('submit', event => { event.preventDefault(); const form = event.target as HTMLFormElement; void this.submit(form).catch(error => this.report(error)); });
        window.addEventListener('hashchange', () => { this.closeDialog(); void this.render(); });
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.nextPoll = 0;
                void this.poll();
            }
        });
        window.addEventListener('online', () => { this.nextPoll = 0; void this.poll(); });
        window.addEventListener('focus', () => { this.nextPoll = 0; void this.poll(); });
        if (this.host.wallet) {
            this.host.wallet.subscribe(() => void this.accountChanged());
            try {
                this.account = (await this.host.wallet.getContext()).account.toLowerCase() as Hex;
            }
            catch { }
        }
        this.updateChrome();
        await this.render();
        setInterval(() => void this.poll(), 1000);
    }
    shell() {
        return `<header class="topbar"><a class="brand" href="/" aria-label="Poros home"><span class="brand-mark">${mark}</span><span>Poros<small>COMMUNITY</small></span></a><nav class="primary-nav" aria-label="Workspace"><a href="/">Home</a><a href="/community" aria-current="page">Communities</a></nav><form class="global-search" data-form="search">${icon('search')}<input name="q" aria-label="Find a strategy by name prefix" placeholder="Find your next idea…"><kbd>↵</kbd></form><div class="header-actions"><span class="source-badge">${this.preview ? 'DESIGN PREVIEW' : 'RABDI · TESTNET'}<i></i></span><button class="button wallet-button" data-action="connect">${icon('wallet')}<span id="wallet-label">Connect wallet</span></button></div></header>
    ${this.preview ? `<div class="preview-banner">${icon('info')}<span>Read-only design preview. Every profile, strategy and price here is illustrative.</span><button data-action="live">Switch to real Rabdi ${icon('arrow')}</button></div>` : ''}
    <div class="app-layout"><aside class="sidebar"><span class="nav-label">POROS COMMUNITY</span><nav aria-label="Main navigation">${[['/discover', 'grid', 'Discover'], ['/communities', 'people', 'Communities'], ['/profile/me', 'user', 'Your profile']].map(([route, glyph, label]) => `<a href="#${route}" data-nav="${route}">${icon(glyph!)}<span>${label}</span></a>`).join('')}</nav><div class="sidebar-divider"></div><div class="nav-label nav-label-row">OPEN ROOMS <a href="#/communities" aria-label="Browse communities">${icon('plus')}</a></div><div id="rooms" class="room-links"></div><div class="sidebar-bottom"><div class="sidebar-note">${icon('leaf')}<p>Better ideas grow<br>in good company.</p></div><button class="settings-button" data-action="setup">${icon('settings')} Connection details</button><small>Built in public. Stored on Arkiv.</small></div></aside><main id="main" tabindex="-1"><div id="pending"></div><div id="content"></div></main></div><footer><span>POROS COMMUNITY</span><p>Ideas are public. Trading decisions are yours.</p><button data-action="${this.preview ? 'live' : 'preview'}">${this.preview ? 'Return to Rabdi' : 'Explore the design preview'} ${icon('arrow')}</button></footer>`;
    }
    label(wallet: string) { return this.profiles.get(wallet)?.displayName ?? short(wallet); }
    updateChrome() {
        const walletLabel = document.querySelector('#wallet-label');
        if (walletLabel)
            walletLabel.textContent = this.account ? short(this.account) : 'Connect wallet';
        document.querySelectorAll<HTMLElement>('[data-nav]').forEach(item => {
            const route = this.route()[0];
            const active = item.dataset.nav === ('/' + route) || (route === 'community' || route === 'thread') && item.dataset.nav === '/communities' || route === 'listing' && item.dataset.nav === '/marketplace' || route === 'strategies' && item.dataset.nav === '/discover';
            item.classList.toggle('active', !!active);
            if (active)
                item.setAttribute('aria-current', 'page');
            else
                item.removeAttribute('aria-current');
        });
        document.querySelector('#rooms')!.innerHTML = this.rooms.length ? this.rooms.slice(0, 5).map((room, i) => `<a href="#/community/${room.communityKey}"><span class="room-dot dot-${i % 3}"></span>${e(room.name)}</a>`).join('') : '<a href="#/communities">' + icon('plus') + ' Find a community</a>';
        document.querySelector('#pending')!.innerHTML = this.pending ? `<div class="pending-bar">${icon('info')}<span>A write needs verification. ${e(short(this.pending.requestId))}</span>${button('reconcile', 'Check status', 'secondary')}</div>` : '';
        if (this.lastHidden && this.lastHidden.owner === this.account)
            document.querySelector('#pending')!.insertAdjacentHTML('beforeend', `<div class="pending-bar">${icon('shield')}<span>Content hidden from the community view.</span>${button('unhide', 'Undo hide', 'secondary', `data-key="${this.lastHidden.key}" data-room="${this.lastHidden.room}"`)}</div>`);
    }
    route() { return (location.hash.slice(1).split('?')[0] || '/discover').split('/').filter(Boolean); }
    async accountChanged() {
        let current: Hex | undefined;
        try { current = (await this.host.wallet!.getContext()).account.toLowerCase() as Hex; }
        catch { }
        // Chain switches keep the same author and must preserve an in-flight draft.
        if (current === this.account) return;
        this.generation++;
        this.market.session.clear();
        this.attempt = undefined;
        this.sellerDraft = undefined;
        this.membership = undefined;
        this.activeVersion = undefined;
        this.closeDialog();
        this.account = current;
        this.updateChrome();
        await this.render();
    }
    async requireAccount() {
        if (this.preview)
            failure('PREVIEW_ONLY');
        if (!this.host.wallet)
            failure('WALLET_REQUIRED');
        const current = (await this.host.wallet.getContext()).account.toLowerCase() as Hex;
        if (this.account !== current) {
            await this.accountChanged();
            failure('ACCOUNT_CHANGED');
        }
        return current;
    }
    ensureGeneration(generation: number) {
        if (this.generation !== generation)
            failure('ACCOUNT_CHANGED');
    }
    async profilesFor(actors: string[]) {
        if (this.preview)
            return;
        await Promise.all([...new Set(actors)].slice(0, 12).map(async (actor) => {
            if (!this.profiles.has(actor)) {
                try {
                    const profile = await this.api.community.getProfile({ wallet: actor as Hex });
                    if (profile)
                        this.profiles.set(actor, profile);
                }
                catch { }
            }
        }));
    }
    async getCommunities() { if (this.preview)
        return this.preview.communities; const result = await this.api.strategies.listCommunities(); this.rooms = result.items; this.communityCursor = result.nextOffset; this.skipped = result.skipped; return result.items; }
    async getStrategies(q?: string) { this.strategyCursor = null; if (this.preview)
        return this.loadedStrategies = this.preview.strategies.filter(row => !q || row.name.toLowerCase().startsWith(q.toLowerCase())); if (!this.host.validateStrategyDocument)
        return this.loadedStrategies = []; const result = await this.api.strategies.listStrategies(q ? { namePrefix: q } : {}); this.strategyCursor = result.nextOffset; this.skipped += result.skipped; return this.loadedStrategies = result.items; }
    async getListing(key: Hex) { return this.preview ? this.preview.listings.find(row => row.key === key) ?? failure('NOT_FOUND') : this.api.community.getListing({ listingKey: key }); }
    async getCommunity(key: Hex) { return this.preview ? this.preview.communities.find(row => row.communityKey === key) ?? failure('NOT_FOUND') : this.api.strategies.getCommunity({ communityKey: key }); }
    async getVersion(key: Hex) { return this.preview ? this.preview.versions.find(row => row.versionKey === key) ?? failure('NOT_FOUND') : this.api.strategies.getVersion({ versionKey: key }); }
    async getEvents(type: 'thread' | 'message' | 'reply', key: Hex, threadKey?: Hex) {
        if (this.preview)
            return this.preview.events.filter(row => row.type === type && row.scope === key && (!threadKey || row.data.threadKey === threadKey));
        return type === 'thread' ? this.api.community.listThreads({ communityKey: key }) : type === 'message' ? this.api.community.listMessages({ communityKey: key }) : this.api.community.listReplies({ communityKey: key, threadKey: threadKey! });
    }
    async votesFor(room:Hex,rows:EventDTO[]) {
        if (this.preview) return Object.fromEntries(rows.map(row=>[row.key,{score:0,up:0,down:0,viewerVote:0}])) as Record<Hex,VoteSummary>;
        return this.api.community.getVoteSummaries({communityKey:room,contentKeys:rows.map(row=>row.key),...(this.account?{viewer:this.account}:{})});
    }
    async render() {
        const serial = ++this.pageSerial;
        const generation = this.generation;
        const [route = 'discover', id, thread] = this.route();
        this.activeCommunity = undefined;
        this.membership = undefined;
        this.updateChrome();
        const content = document.querySelector<HTMLElement>('#content')!;
        content.setAttribute('aria-busy', 'true');
        let html = '';
        const routeKey = location.hash || '#/discover';
        const changed = this.renderedRoute !== routeKey;
        if (!content.innerHTML || changed)
            content.innerHTML = route === 'discover' ? this.discoverHTML([], this.rooms, '', true) : '<div class="loading-view"><span></span>Gathering the ideas…</div>';
        if (changed)
            window.scrollTo(0, 0);
        this.renderedRoute = routeKey;
        try {
            if (['marketplace','listing','purchases'].includes(route))
                html = heading('Not available yet', 'Private checkout is not live.', 'Creator memberships are being built with Arkiv-only storage.', link('/discover', 'Back to Discover'));
            else if (route === 'discover')
                html = await this.discover();
            else if (route === 'create-community')
                html = heading('Poros community', 'Create your community.', 'Start a public space for your trading ideas.') + `<section class="paper-panel">${communityCreation(!!this.preview, this.account, !!this.host.wallet)}</section>`;
            else if (route === 'publish-draft')
                html = await this.publicDraftView();
            else if (route === 'communities') {
                const rooms = await this.getCommunities();
                html = heading('Find your people', 'A room for every thesis.', 'Explore public communities. Share the reasoning, not just the result.', button('new-community', icon('plus') + ' Create community')) + `<div class="community-grid">${communityCards(rooms)}</div>${this.communityCursor !== null ? button('more-communities', 'Load more communities', 'secondary') : ''}${this.skipped ? notice('Some unverified records were skipped.') : ''}` + (rooms.length ? '' : empty('Make space for a conversation', 'Create a public community for the market or idea you care about.', button('new-community', 'Create the first community', 'secondary')));
            }
            else if (route === 'community' || route === 'thread')
                html = await this.communityView(id, route === 'thread' ? thread : undefined);
            else if (route === 'strategies')
                html = await this.strategyView(id);
            else if (route === 'marketplace') {
                const rows = this.preview ? this.preview.listings : await this.api.community.listListings();
                await this.profilesFor(rows.map(row => row.seller));
                html = heading('The strategy marketplace', 'Knowledge worth sharing.', 'Discover private strategy packages. Review the terms before buying.', button('sell', icon('plus') + ' Sell a strategy')) + notice('Payment unlocks a copy of the private code. It does not start a trade or guarantee performance.') + `<div class="listing-grid">${listingCards(rows, w => this.label(w), this.host.payment)}</div>` + (rows.length ? '' : empty('Your next strategy starts here', 'There are no listings in the current Rabdi view. Be the first to share your work.', button('sell', 'List a private strategy', 'secondary')));
            }
            else if (route === 'listing')
                html = await this.listingView(id);
            else if (route === 'profile')
                html = await this.profileView(id);
            else if (route === 'purchases')
                html = await this.purchasesView();
            else
                html = heading('Off the path', 'This page is not here.', 'Return to the commons and find a new idea.', link('/discover', 'Back to Discover'));
            if (serial !== this.pageSerial || generation !== this.generation)
                return;
            content.innerHTML = html;
            content.removeAttribute('aria-busy');
            this.updateChrome();
            document.title = (content.querySelector('h1')?.textContent ?? 'Discover') + ' — Poros Community';
            if (changed)
                content.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
        }
        catch (error) {
            if (serial !== this.pageSerial || generation !== this.generation)
                return;
            content.removeAttribute('aria-busy');
            const code = errorCode(error);
            const warning = `<div class="route-error" role="alert">${notice(errors[code] ?? 'This page could not be loaded. Your last view has been preserved.', 'warning')}${button('refresh', icon('refresh') + ' Try again', 'secondary')}</div>`;
            if (content.querySelector('.loading-view'))
                content.innerHTML = heading('A connection needs attention', 'Let’s try that again.', 'No sample data has replaced this live request.') + warning;
            else {
                content.querySelector('.route-error')?.remove();
                content.insertAdjacentHTML('afterbegin', warning);
            }
        }
    }
    async discover() {
        const q = new URLSearchParams(location.hash.split('?')[1] ?? '').get('q') ?? '';
        const rooms = await this.getCommunities();
        const rows = await this.getStrategies(q);
        await this.profilesFor(rows.map(row => row.creator));
        return this.discoverHTML(rows, rooms, q);
    }
    discoverHTML(rows: StrategySummaryDTO[], rooms: CommunityDTO[], q = '', loading = false) {
        return `<section class="hero"><div class="hero-copy"><span class="eyebrow"><span class="little-star">✳</span> IDEAS GROW BETTER TOGETHER</span><h1>Good strategies.<br><em>Common ground.</em></h1><p>A place to build trading ideas in public.<br>Find your people, share your reasoning,<br class="desktop-break"> and make the next version better.</p><div class="hero-actions">${link('/communities', 'Find your community ' + icon('right'))}${button('new-community', icon('plus') + ' Create community', 'secondary')}${button('publish', 'Share a strategy', 'text-button')}</div><div class="hero-footnote"><span class="small-mark">${mark}</span><span>Yours to create. Ours to explore.</span></div></div><div class="hero-art">${garden}<span class="art-caption">FROM A LITTLE IDEA TO A CLEARER STRATEGY ↗</span></div></section>
    <div class="principles"><span>${icon('user')} Wallet-owned identity</span><span>${icon('fork')} Source-pinned versions</span><span>${icon('shield')} Exclusive signals are encrypted</span></div>
    <div class="discovery-columns"><section class="discovery-feed"><div class="section-title"><div><span class="eyebrow">THE IDEA EXCHANGE</span><h2>Something worth building on.</h2></div><a href="#/communities" class="text-link">Explore ${icon('arrow')}</a></div><div class="feed-tabs"><span class="selected">Public strategies</span><a href="#/communities">Communities</a></div>
    ${q ? notice('Showing names starting with “' + q + '”.') : ''}${this.skipped ? notice('Some unverified records were skipped.') : ''}
    ${loading ? '<div class="loading-view feed-loading"><span></span>Reading the public commons…</div>' : rows.length ? `<div class="strategy-list">${strategyRows(rows, w => this.label(w))}</div>` : empty(this.host.validateStrategyDocument ? 'The first idea could be yours.' : 'A little space for your next idea.', this.host.validateStrategyDocument ? 'No strategies match this current view. Publish a public strategy or explore the communities.' : 'Public communities are connected to Rabdi. Strategy documents open when the team’s graph validator is connected.', this.preview ? '' : button('preview', 'Take a look around ' + icon('arrow'), 'secondary'))}
    ${this.strategyCursor !== null ? button('more-strategies', 'Load more strategies', 'secondary') : ''}<div class="section-title small-title"><h2>Find a good conversation.</h2><a href="#/communities" class="text-link">All rooms ${icon('arrow')}</a></div><div class="community-grid compact">${communityCards(rooms.slice(0, 3))}</div>${rooms.length ? '' : `<a class="first-room" href="#/communities">${icon('people')}<span><strong>The commons are open.</strong><small>Create a community around your trading thesis.</small></span>${icon('arrow')}</a>`}</section>
    <aside class="field-notes"><div class="field-note"><span class="eyebrow">A NOTE FROM THE COMMONS</span><span class="quote-mark">“</span><h3>Show the thinking.<br>Not just the trade.</h3><p>The best part of an idea is what happens when someone builds on it.</p><a href="#/communities">Join a conversation ${icon('arrow')}</a><span class="note-flower">✳</span></div><div class="connection-card"><span class="eyebrow">YOUR WORKSPACE</span><div><span class="status-dot ${this.preview ? '' : 'live-dot'}"></span>${this.preview ? 'Read-only preview' : 'Public Rabdi reads'}</div><div>${icon('wallet')}${this.host.wallet ? 'Browser wallet available' : 'Open in Chrome with MetaMask'}</div><div>${icon('people')}Anyone can create a community</div><button class="text-link" data-action="setup">Connection details ${icon('arrow')}</button></div></aside></div>`;
    }
    async communityView(id?: string, thread?: string) {
        const serial = this.pageSerial;
        if (!id || !keyPattern.test(id))
            failure('INVALID_INPUT');
        const room = await this.getCommunity(id as Hex);
        const threads = await this.getEvents('thread', room.communityKey);
        const messages = thread ? [] : await this.getEvents('message', room.communityKey);
        const membership = !this.preview && this.account ? await this.api.community.getMembership({ communityKey: room.communityKey, wallet: this.account }) : undefined;
        if (serial !== this.pageSerial)
            failure('STALE_VIEW');
        this.membership = membership;
        const owner = !!this.account && room.owner === this.account;
        const joined = owner || this.membership?.event?.data.state === 'joined';
        const canPost = joined && !this.membership?.banned && !this.preview;
        const canModerate = !this.preview && !!this.account && await this.api.community.isModerator({communityKey:room.communityKey,wallet:this.account});
        this.votes = await this.votesFor(room.communityKey,threads);
        await this.profilesFor([...threads, ...messages].map(row => row.actor));
        if (serial !== this.pageSerial)
            failure('STALE_VIEW');
        this.activeCommunity = room;
        const membershipButton = this.preview ? '' : owner ? tag('Community owner', 'green') : button('membership', this.membership?.banned ? 'Posting restricted' : joined ? 'Leave community' : 'Join community', joined ? 'secondary' : 'primary', this.membership?.banned ? 'disabled' : '');
        const top = `<a href="#/communities" class="back-link">← All communities</a>` + heading('THE OPEN ROOMS', room.name, room.description, membershipButton) + `<div class="community-meta">${tag('Public community', 'green')}<span>Owned by <a href="#/profile/${room.owner}">${e(this.label(room.owner))}</a></span><code>${e(short(room.communityKey))}</code>${owner ? button('edit-community', 'Edit details', 'text-button') + button('moderate', 'Moderation', 'text-button') : ''}${canModerate&&!owner?tag('Moderator','green'):''}</div>${this.preview?'':notice('Votes and moderation are public Arkiv transactions. Each action uses tGLM gas.')}`;
        if (thread) {
            if (!keyPattern.test(thread))
                failure('INVALID_INPUT');
            const parent = threads.find(row => row.key === thread);
            if (!parent)
                failure('NOT_FOUND');
            const replies = await this.getEvents('reply', room.communityKey, thread as Hex);
            Object.assign(this.votes,await this.votesFor(room.communityKey,replies));
            await this.profilesFor(replies.map(row => row.actor));
            if (serial !== this.pageSerial)
                failure('STALE_VIEW');
            return top + `<div class="thread-detail">${threadRows([parent], w => this.label(w), canModerate,this.votes,canPost)}<h2>Keep the conversation going.</h2>${replies.length ? messageRows(replies, w => this.label(w), canModerate,this.votes,canPost) : '<p class="muted">No replies yet. Add another perspective.</p>'}<form data-form="reply" class="composer">${field('body', 'Your reply', { area: true, required: true, placeholder: 'Build on the idea…', hint: 'Public text · up to 2,000 UTF-8 bytes' })}<button class="button primary" ${canPost ? '' : 'disabled'}>Post reply ${icon('right')}</button>${!canPost ? '<p class="muted">' + (this.preview ? 'Preview conversations are read-only.' : 'Join with a connected wallet to reply.') + '</p>' : ''}</form></div>`;
        }
        return top + `<div class="community-columns"><section><div class="section-title"><h2>The discussion.</h2>${button('new-thread', icon('plus') + ' Start a thread', 'secondary', canPost ? '' : 'disabled')}</div><div class="feed-tabs" role="group" aria-label="Discussion order">${button('sort-new','New','secondary',`aria-pressed="${this.sortOrder==='new'}"`)}${button('sort-top','Top','secondary',`aria-pressed="${this.sortOrder==='top'}"`)}</div><div id="threads">${threads.length ? threadRows(sortThreads(threads,this.votes,this.sortOrder), w => this.label(w), canModerate,this.votes,canPost) : empty('Start with a question', 'Good discussion starts with a clear idea or an honest uncertainty.')}</div></section><aside class="chat-panel"><div class="chat-heading"><h2>${icon('message')} The common room</h2><span class="status-dot"></span></div><p class="chat-disclosure">Public, on-chain messages. Each send uses tGLM gas.</p><div id="chat-error"></div><div id="messages" class="chat-messages">${messages.length ? messageRows(messages, w => this.label(w), canModerate) : '<p class="muted">The room is quiet. Say hello.</p>'}</div><form data-form="message" class="chat-compose"><label class="sr-only" for="chat-body">Your public message</label><textarea id="chat-body" name="body" rows="2" required placeholder="Add to the conversation…" ${canPost ? '' : 'disabled'}></textarea><button class="button primary" ${canPost ? '' : 'disabled'}>Send ${icon('right')}</button></form><small>${this.preview ? 'Read-only illustrative messages.' : canPost ? 'Messages are public. Never share private code.' : 'Join this community to send a message.'}</small></aside></div>`;
    }
    async strategyView(id?: string) {
        const serial = this.pageSerial;
        if (!id || !keyPattern.test(id))
            failure('INVALID_INPUT');
        const version = await this.getVersion(id as Hex);
        const root = version.rootVersionKey ?? version.versionKey;
        const history = this.preview ? { versions: this.preview.versions.filter(row => row.strategyId === version.strategyId), tipVersionKeys: [version.versionKey], complete: true, nextOffset: null } : await this.api.strategies.listVersions({ rootVersionKey: root });
        await this.profilesFor([version.creator]);
        if (serial !== this.pageSerial)
            failure('STALE_VIEW');
        this.activeVersion = version;
        this.historyCursor = history.nextOffset;
        const writable = !!this.host.validateStrategyDocument && !this.preview;
        return `<a href="#/discover" class="back-link">← All public strategies</a><p><a class="button secondary strategy-transfer" draggable="true" href="/?strategy=${version.versionKey}">Open in builder · drag to canvas</a> ${this.preview ? '' : button('share-strategy','Share in a community','secondary')}</p>` + heading('PUBLIC STRATEGY', version.document.name, version.document.description, button('fork', icon('fork') + ' Fork this version', 'primary', writable ? '' : 'disabled')) + `<div class="community-meta">${tag(version.document.category)}${tag(version.document.license)}<span>by <a href="#/profile/${version.creator}">${e(this.label(version.creator))}</a></span>${this.account === version.creator ? button('revise', 'Publish a revision', 'secondary', writable && history.complete && history.tipVersionKeys.length === 1 ? '' : 'disabled') : ''}</div>${version.lineageStatus !== 'verified' ? notice('Some ancestors are missing. This is not a fully verified version history.', 'warning') : ''}${!history.complete ? notice('The version history is incomplete. Revision is blocked.', 'warning') : ''}<div class="detail-columns"><section class="paper-panel"><div class="section-title"><h2>${icon('code')} The strategy document</h2>${tag(this.preview ? 'Illustrative' : 'Read-back verified', 'green')}</div><pre class="code-panel">${e(JSON.stringify(version.document, null, 2))}</pre>${notice('A stored strategy is public data. It is not permission to trade.')}</section><aside><div class="paper-panel"><span class="eyebrow">PINNED TO THIS VERSION</span><dl><dt>Version key</dt><dd><code>${e(version.versionKey)}</code></dd><dt>Content hash</dt><dd><code>${e(version.contentHash)}</code></dd><dt>Execution network</dt><dd>Chain ${version.document.executionChainId}</dd><dt>Expiry block</dt><dd>${e(version.expiresAtBlock)}</dd></dl></div><div class="paper-panel"><h2>Version history</h2>${history.versions.map((row, i) => `<a class="history-row ${row.versionKey === version.versionKey ? 'selected' : ''}" href="#/strategies/${row.versionKey}"><span class="version-dot"></span><span>${i === 0 ? 'Root publication' : 'Revision'}<small>${e(short(row.versionKey))}</small></span>${icon('arrow')}</a>`).join('')}${this.historyCursor !== null ? button('more-history', 'Load more versions', 'secondary') : ''}<p class="muted">Forks preserve the selected source, including older versions.</p></div></aside></div>`;
    }
    async profileView(id?: string) {
        const wallet = id === 'me' ? this.account : id;
        if (!wallet)
            return heading('YOUR WALLET IDENTITY', 'Make yourself at home.', 'Connect a wallet to create your public profile.', button('connect', icon('wallet') + ' Connect wallet'));
        if (!walletPattern.test(wallet))
            failure('INVALID_INPUT');
        const profile = this.preview ? this.preview.profiles.find(row => row.wallet === wallet) ?? null : await this.api.community.getProfile({ wallet: wallet as Hex });
        if (profile)
            this.profiles.set(wallet, profile);
        const owned = this.account === wallet && !this.preview;
        return heading('WALLET-OWNED IDENTITY', profile?.displayName ?? 'An unwritten profile.', profile?.bio ?? 'This wallet has not created a public profile yet.', owned ? button('edit-profile', profile ? 'Edit profile' : 'Create profile') : '') + `<div class="profile-panel">${avatar(wallet)}<div><h2>${profile ? '@' + e(profile.handle) : 'Wallet identity'}</h2><code>${e(wallet)}</code><p class="muted">${e(profile?.userId ?? 'eip155:7794095:' + wallet)}</p></div>${tag('Wallet owned', 'green')}</div>` + notice('Handles can be shared by more than one wallet. Check the wallet address to identify a creator.') + `<section class="paper-panel"><h2>Find a person.</h2><form data-form="profile-search" class="inline-form">${field('handle', 'Exact handle', { placeholder: 'lowercase_handle', required: true, pattern: '[a-z0-9_]{3,32}' })}<button class="button secondary">Search ${icon('search')}</button></form><div id="profile-results"></div></section>`;
    }
    async publicDraftView() {
        if (this.preview) failure('PREVIEW_ONLY');
        const raw = sessionStorage.getItem('poros.public-draft');
        if (!raw || raw.length > 65536) return heading('Public strategy', 'Prepare a strategy in the builder.', 'Validate your draft and choose Publish to community.') + '<a class="button primary" href="/">Open builder</a>';
        const transfer = JSON.parse(raw);
        const document = validateBuilderDocument(transfer.document);
        this.activeVersion = transfer.sourceVersionKey ? await this.api.strategies.getVersion({versionKey:transfer.sourceVersionKey}) : undefined;
        const mode = this.activeVersion ? 'fork' : 'publish';
        return heading('Public strategy', 'Review your publication.', 'Your entire strategy will be public on Arkiv for 180 days. Review the license and document before approving.') +
            `<section class="paper-panel"><form data-form="publish" data-mode="${mode}" data-builder="true">${field('document','Strategy document',{area:true,required:true,value:JSON.stringify(document,null,2)})}${this.activeVersion ? notice('This fork references version ' + this.activeVersion.versionKey) : ''}<p class="form-error" role="alert"></p>${this.account ? '<button class="button primary">Publish public '+(mode === 'fork' ? 'fork' : 'strategy')+'</button>' : button('connect','Connect wallet')}</form></section>`;
    }
    async listingView(id?: string) {
        if (!id || !keyPattern.test(id))
            failure('INVALID_INPUT');
        const serial = this.pageSerial;
        const snapshot = this.attempt?.quote.listing.key === id;
        const listing = snapshot ? this.attempt!.quote.listing : await this.getListing(id as Hex);
        await this.profilesFor([listing.seller]);
        if (serial !== this.pageSerial)
            failure('STALE_VIEW');
        this.activeListing = listing;
        return `<a class="back-link" href="#/marketplace">← Marketplace</a>` + heading('PRIVATE STRATEGY PACKAGE', listing.title, listing.description) + `<div class="detail-columns"><section><div class="private-art">${mark}<div><span class="eyebrow">THE THINKING IS WORTH SOMETHING.</span><h2>Private code.<br>Clear commitments.</h2><p>The seller’s source code is encrypted.<br>Payment unlocks your copy.</p></div>${icon('lock')}</div><section class="paper-panel"><h2>Commercial terms</h2><p class="preserve">${e(listing.terms)}</p>${notice('Review these terms before paying. Buyers receive copyable code; this is not escrow or a performance guarantee.')}</section></section><aside><div class="checkout-card"><span class="eyebrow">ONE PRIVATE PACKAGE</span><div class="price">${e(formatAmount(listing.amount, listing.currency.decimals))}<span>${e(currencyLabel(listing, this.host.payment))}</span></div><p>by <a href="#/profile/${listing.seller}">${e(this.label(listing.seller))}</a></p><dl><dt>Payment network</dt><dd>${e(currencyMatches(listing, this.host.payment) ? this.host.payment!.networkName : 'Chain ' + listing.currency.chainId)}</dd><dt>Token contract</dt><dd><code>${e(listing.currency.token)}</code></dd><dt>Content commitment</dt><dd><code>${e(listing.contentHash)}</code></dd></dl>${tag(snapshot ? 'Frozen order snapshot' : listing.active ? 'Listing active' : 'Delisted', listing.active ? 'green' : '')}<div id="checkout-state">${this.checkoutState(listing)}</div>${this.account === listing.seller && !this.preview ? button('delist', 'Delist strategy', 'text-button') : ''}<small>Trading is a separate decision. No agent or swap starts here.</small></div></aside></div>`;
    }
    checkoutState(listing: Listing) {
        if (!this.preview && listing.active) {
            if (!this.account)
                return button('connect', icon('wallet') + ' Connect to continue', 'primary');
            if (!this.host.marketplaceReady || !this.host.payment || !this.host.validatePrivateStrategy)
                return notice('Private checkout is waiting for the team’s service and validation connections.') + button('setup', 'Connection details', 'secondary');
            if (!currencyMatches(listing, this.host.payment))
                return notice('This listing uses a payment currency that the current checkout does not support.');
            if (!this.market.session.token || this.market.session.wallet !== this.account || Date.now() >= this.market.session.expiresAt)
                return button('login', 'Sign in to marketplace', 'primary') + notice('This signature proves wallet ownership. It does not send a payment.');
        }
        const attempt = this.attempt?.quote.listing.key === listing.key ? this.attempt : undefined;
        if (attempt) {
            const q = attempt.quote;
            return `<div class="order-state"><strong>${attempt.state === 'paid' ? 'Payment verified' : attempt.state === 'submitted' ? 'Transaction submitted' : attempt.state === 'unknown' ? 'Check the original payment' : 'Review your order'}</strong><code>${e(short(q.orderId))}</code><p>${attempt.hash ? 'Transaction: ' + e(short(attempt.hash)) : 'Payment deadline: ' + e(new Date(q.expiresAt).toLocaleString())}</p>${attempt.state === 'review' && q.state === 'awaiting-payment' && Date.now() + 60000 < q.expiresAt ? button('pay', 'Review & pay ' + icon('right')) : ''}${attempt.hash ? button('settle', 'Verify original payment', 'secondary') : ''}${attempt.state === 'unknown' ? '<form data-form="recover-payment">' + field('hash', 'Original transaction hash', { required: true, placeholder: '0x…' }) + '<button class="button secondary">Verify this transaction</button></form>' : ''}${attempt.state === 'paid' ? button('download', 'Open purchased package', 'primary', `data-package="${listing.packageId}" data-hash="${listing.contentHash}"`) : ''}${!q.transaction && q.state === 'expired' ? notice('This order expired. Check for pending payments before creating a new order.') : ''}</div>`;
        }
        if (this.preview)
            return notice('This example cannot be purchased. No wallet or payment is simulated.');
        if (this.account === listing.seller)
            return button('download', 'Open your package', 'secondary', `data-package="${listing.packageId}" data-hash="${listing.contentHash}"`);
        if (!listing.active)
            return notice('This listing is no longer available for new purchases.');
        return button('quote', 'Review purchase ' + icon('right'), 'primary') + `<p class="muted">${this.host.marketplaceReady ? 'Sign in and request a frozen order before paying.' : 'Checkout becomes available when the team connects the private API and payment network.'}</p>`;
    }
    async purchasesView() {
        let html = heading('YOUR PURCHASES', 'Keep the good ideas close.', 'Sign in with the same wallet to recover your purchased strategy packages.');
        if (this.preview)
            return html + empty('Your library, without the noise.', 'Purchased packages will appear here. This design preview never creates a fake purchase.', link('/marketplace', 'Explore the marketplace', 'secondary'));
        if (!this.account || !this.host.marketplaceReady)
            return html + empty('Your library is waiting.', 'Connect your wallet and the private marketplace service to open your purchases.', button(!this.account ? 'connect' : 'setup', !this.account ? 'Connect wallet' : 'Connection details', 'secondary'));
        if (!this.market.session.token)
            return html + empty('A signature, then your library.', 'Marketplace sign-in proves wallet ownership. It does not authorize trades or payments.', button('login', 'Sign in to marketplace', 'secondary'));
        const account = await this.requireAccount();
        const orders = await this.market.post<Order[]>('/orders/list', {}, account);
        if (!Array.isArray(orders))
            failure('INVALID_INPUT');
        return html + (orders.length ? `<div class="purchase-list">${orders.map(order => `<article class="purchase-row"><div>${icon(order.transactionHash ? 'lock' : 'book')}</div><span><strong>${e(order.listing.title)}</strong><small>${e(short(order.orderId))} · ${e(formatAmount(order.listing.amount, order.listing.currency.decimals))} token units</small></span>${tag(order.transactionHash ? 'Previously settled' : 'Awaiting payment', order.transactionHash ? 'green' : '')}${order.transactionHash ? button('download', 'Open package', 'secondary', `data-package="${e(order.listing.packageId)}" data-hash="${e(order.listing.contentHash)}"`) : button('resume', 'Recover order', 'secondary', `data-order="${e(order.orderId)}"`)}</article>`).join('')}</div>` : empty('Room for your first discovery.', 'No orders are associated with this wallet yet.', link('/marketplace', 'Browse private strategies', 'secondary'))) + notice('Previously settled orders are checked again at download. A reorg or unavailable RPC can temporarily block delivery.');
    }
    async poll() {
        if (document.hidden || !navigator.onLine || this.polling || this.busy || this.dialog?.open || Date.now() < this.nextPoll || this.route()[0] !== 'community' || !this.activeCommunity)
            return;
        const room = this.activeCommunity;
        const serial = this.pageSerial;
        this.polling = true;
        try {
            const [messages, threads, membership, canModerate] = await Promise.all([this.getEvents('message', room.communityKey), this.getEvents('thread', room.communityKey), !this.preview && this.account ? this.api.community.getMembership({ communityKey: room.communityKey, wallet: this.account }) : undefined, !this.preview && this.account ? this.api.community.isModerator({communityKey:room.communityKey,wallet:this.account}) : false]);
            const votes = await this.votesFor(room.communityKey,threads);
            await this.profilesFor([...messages, ...threads].map(row => row.actor));
            if (serial !== this.pageSerial)
                return;
            const owner = room.owner === this.account;
            this.membership = membership;
            this.votes = votes;
            const canPost = !this.preview && !membership?.banned && (owner || membership?.event?.data.state === 'joined');
            document.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>('[data-form="message"] textarea,[data-form="message"] button,[data-action="new-thread"]').forEach(control => control.disabled = !canPost);
            const memberButton = document.querySelector<HTMLButtonElement>('[data-action="membership"]');
            if (memberButton) {
                memberButton.disabled = !!membership?.banned;
                memberButton.textContent = membership?.banned ? 'Posting restricted' : membership?.event?.data.state === 'joined' ? 'Leave community' : 'Join community';
            }
            document.querySelector('#messages')!.innerHTML = messageRows(messages, w => this.label(w), canModerate) || '<p class="muted">The room is quiet. Say hello.</p>';
            document.querySelector('#threads')!.innerHTML = threadRows(sortThreads(threads,votes,this.sortOrder), w => this.label(w), canModerate,votes,!!canPost) || empty('Start with a question', 'Add a perspective to this public community.');
            document.querySelector('#chat-error')!.innerHTML = '';
            this.pollFailures = 0;
        }
        catch (error) {
            if (serial === this.pageSerial) {
                document.querySelector('#chat-error')!.innerHTML = notice(errors[errorCode(error)] ?? 'The latest messages could not be loaded.', 'warning');
                this.pollFailures++;
            }
        }
        finally {
            this.polling = false;
            this.nextPoll = Date.now() + Math.min(60000, 10000 * 2 ** this.pollFailures);
        }
    }
    openDialog(title: string, body: string, subtitle = '') {
        this.closeDialog();
        const dialog = document.createElement('dialog');
        dialog.className = 'modal';
        dialog.innerHTML = `<div class="modal-header"><div><span class="eyebrow">COMMON GROUND</span><h2>${e(title)}</h2>${subtitle ? `<p>${e(subtitle)}</p>` : ''}</div><button class="icon-button" data-action="close" aria-label="Close dialog">${icon('close')}</button></div><div class="modal-body">${body}<div class="form-error" role="alert"></div></div>`;
        app.append(dialog);
        this.dialog = dialog;
        dialog.addEventListener('cancel', event => {
            if (this.busy)
                event.preventDefault();
            else
                this.closeDialog();
        });
        dialog.showModal();
    }
    closeDialog() {
        if (this.dialog) {
            this.dialog.close();
            this.dialog.remove();
            this.dialog = undefined;
        }
    }
    toast(message: string) { const zone = document.querySelector<HTMLElement>('#notifications')!; zone.textContent = message; zone.classList.add('visible'); setTimeout(() => zone.classList.remove('visible'), 6000); }
    report(error: unknown) {
        const code = errorCode(error);
        const message = errors[code] ?? 'This action could not be completed. Check the connection and try again.';
        const slot = this.dialog?.querySelector('.form-error') ?? document.querySelector('#content .form-error');
        if (slot)
            slot.textContent = message;
        if (['AUTH_REQUIRED', 'AUTH_INVALID'].includes(code) && this.dialog?.querySelector('[data-form="sell"]') && !this.dialog.querySelector('[data-action="login"]'))
            this.dialog.querySelector('form')!.insertAdjacentHTML('afterbegin', button('login', 'Sign in again', 'secondary'));
        this.toast(message);
        this.updateChrome();
    }
    async busyAction(operation: () => Promise<unknown>) {
        if (this.busy)
            return;
        this.busy = true;
        app.setAttribute('aria-busy', 'true');
        this.dialog?.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.disabled = true);
        try {
            await operation();
        }
        finally {
            this.busy = false;
            app.removeAttribute('aria-busy');
            this.dialog?.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.disabled = false);
        }
    }
    persistPending() {
        try {
            if (this.pending)
                localStorage.setItem('common-ground.pending-write', JSON.stringify(this.pending));
            else
                localStorage.removeItem('common-ground.pending-write');
        }
        catch {
            failure('DEPENDENCY_UNAVAILABLE');
        }
        this.updateChrome();
    }
    async write<T>(kind: string, expected: Record<string, Json>, operation: (requestId: string) => Promise<T>, scope?: Hex) {
        const account = await this.requireAccount();
        return withWalletLock(async () => {
            try {
                const stored = localStorage.getItem('common-ground.pending-write');
                if (stored)
                    this.pending = JSON.parse(stored);
            }
            catch {
                failure('DEPENDENCY_UNAVAILABLE');
            }
            if (this.pending)
                failure('WRITE_STATUS_UNKNOWN');
            const generation = this.generation;
            const requestId = crypto.randomUUID();
            this.pending = { account, requestId, kind, expected, ...(scope ? { scope } : {}) };
            this.persistPending();
            try {
                const result = await operation(requestId);
                this.pending = undefined;
                this.persistPending();
                this.ensureGeneration(generation);
                this.closeDialog();
                this.toast('Saved and verified on Rabdi.');
                await this.render();
                return result;
            }
            catch (error) {
                if (['WRITE_STATUS_UNKNOWN', 'WRITE_CONFIRMED_READ_PENDING'].includes(errorCode(error))) {
                    const detail = error as {
                        entityKey?: Hex;
                        txHash?: Hex;
                    };
                    this.pending = { account, requestId, kind, expected, ...(scope ? { scope } : {}), ...detail.entityKey ? { entityKey: detail.entityKey } : {}, ...detail.txHash ? { txHash: detail.txHash } : {} };
                }
                else
                    this.pending = undefined;
                this.persistPending();
                throw error;
            }
        }, navigator.locks);
    }
    async reconcile() {
        const pending = this.pending;
        if (!pending)
            return;
        if (await this.requireAccount() !== pending.account)
            failure('ACCOUNT_CHANGED');
        return withWalletLock(async () => {
            let stored: PendingWrite | undefined;
            try {
                const raw = localStorage.getItem('common-ground.pending-write');
                stored = raw ? JSON.parse(raw) : undefined;
            }
            catch {
                failure('DEPENDENCY_UNAVAILABLE');
            }
            if (!stored) {
                this.pending = undefined;
                this.updateChrome();
                return;
            }
            if (stored.account !== pending.account || stored.requestId !== pending.requestId) {
                this.pending = stored;
                this.updateChrome();
                failure('INTENT_CONFLICT');
            }
            if (pending.kind === 'community-update') {
                const item = await this.api.strategies.getCommunity({ communityKey: pending.scope! });
                if (item.owner !== pending.account || item.name !== pending.expected.name || item.description !== pending.expected.description)
                    failure('WRITE_STATUS_UNKNOWN');
            }
            else if (pending.kind === 'community' || pending.kind === 'version') {
                const found = await this.api.strategies.reconcileRequest({ creator: pending.account, requestId: pending.requestId });
                if (found.state === 'duplicates')
                    failure('DUPLICATE_REQUEST');
                if (found.state === 'absent') {
                    this.toast('No record found yet. The write remains locked; absence is not proof of failure.');
                    return;
                }
                if (pending.kind === 'community') {
                    const item = await this.api.strategies.getCommunity({ communityKey: found.entityKeys[0]! });
                    if (item.creator !== pending.account || item.name !== pending.expected.name || item.description !== pending.expected.description)
                        failure('INTEGRITY_FAILED');
                }
                else {
                    const item = await this.api.strategies.getVersion({ versionKey: found.entityKeys[0]! });
                    if (item.creator !== pending.account || item.contentHash !== pending.expected.contentHash)
                        failure('INTEGRITY_FAILED');
                }
            }
            else {
                const rows = await this.api.events.scan({ actor: pending.account, requestId: pending.requestId });
                if (rows.length > 1)
                    failure('DUPLICATE_REQUEST');
                if (!rows.length) {
                    this.toast('No record found yet. Check again after the network catches up.');
                    return;
                }
                const row = rows[0]!;
                if (row.type !== pending.kind || pending.scope && row.scope !== pending.scope || Object.entries(pending.expected).some(([key, value]) => serialize(row.data[key]) !== serialize(value)))
                    failure('INTEGRITY_FAILED');
            }
            this.pending = undefined;
            this.persistPending();
            this.closeDialog();
            this.toast('Stored data matches the original intent. No second transaction was sent.');
            await this.render();
        }, navigator.locks);
    }
    async requireMarket() {
        const account = await this.requireAccount();
        if (!this.host.marketplaceReady || !this.host.payment || !this.host.validatePrivateStrategy)
            failure('DEPENDENCY_UNAVAILABLE');
        this.market.session.require(account);
        return account;
    }
    setup() {
        this.openDialog('Community connections',
            '<p>Anyone can browse public communities. Connect MetaMask to create, join, and post.</p>' +
            notice(this.host.wallet ? 'A browser wallet is available. Connect and approve the switch to Rabdi.' : 'Open this page in Chrome with the MetaMask extension enabled, then reload.') +
            '<p>Rabdi is the Arkiv testnet. Community actions require tGLM for gas. Approve each transaction in your wallet.</p>' +
            '<p><a href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer">Get MetaMask</a> · <a href="https://hub.arkiv.network/" target="_blank" rel="noopener noreferrer">Arkiv Hub and testnet resources</a></p>' +
            notice('Keep your recovery phrase and private key in your wallet.') +
            (this.preview ? button('live', 'Use live community') : this.host.wallet ? button('connect', 'Connect MetaMask') : '')
        );
    }
    async action(target: HTMLElement) {
        const action = target.dataset.action;
        if (action === 'close') {
            if (!this.busy)
                this.closeDialog();
            return;
        }
        if (this.busy)
            return;
        if (target.closest('#content') && document.querySelector('#content')?.getAttribute('aria-busy') === 'true' && !['refresh', 'setup', 'preview'].includes(action ?? '')) {
            this.toast('Wait for this view to finish loading before starting an action.');
            return;
        }
        if (action === 'setup') {
            this.setup();
            return;
        }
        if (action === 'preview' || action === 'live') {
            const url = new URL(location.href);
            action === 'preview' ? url.searchParams.set('preview', '1') : url.searchParams.delete('preview');
            location.href = url.toString();
            return;
        }
        if (action === 'refresh') {
            await this.render();
            return;
        }
        if (action === 'sort-new' || action === 'sort-top') {
            this.sortOrder = action === 'sort-new' ? 'new' : 'top';
            await this.render();
            return;
        }
        if (action === 'vote' && target.dataset.key && this.activeCommunity) {
            const contentKey=target.dataset.key as Hex,room=this.activeCommunity;
            if(!keyPattern.test(contentKey)||!['1','-1'].includes(target.dataset.value??''))failure('INVALID_INPUT');
            const chosen=Number(target.dataset.value) as 1|-1;
            const value=this.votes[contentKey]?.viewerVote===chosen?0:chosen;
            await this.busyAction(()=>this.write('vote',{contentKey,value},requestId=>this.api.community.setVote({requestId,communityKey:room.communityKey,contentKey,value}),room.communityKey));
            return;
        }
        if (action === 'more-strategies' && this.strategyCursor !== null) {
            await this.busyAction(async () => {
                const serial = this.pageSerial;
                const q = new URLSearchParams(location.hash.split('?')[1] ?? '').get('q');
                const page = await this.api.strategies.listStrategies({ ...(q ? { namePrefix: q } : {}), page: { offset: this.strategyCursor! } });
                if (serial !== this.pageSerial)
                    return;
                this.strategyCursor = page.nextOffset;
                this.skipped += page.skipped;
                const known = new Set(this.loadedStrategies.map(row => row.rootVersionKey));
                this.loadedStrategies.push(...page.items.filter(row => !known.has(row.rootVersionKey)));
                await this.profilesFor(page.items.map(row => row.creator));
                if (serial !== this.pageSerial)
                    return;
                document.querySelector('#content')!.innerHTML = this.discoverHTML(this.loadedStrategies, this.rooms, q ?? '');
                this.updateChrome();
            });
            return;
        }
        if (action === 'more-communities' && this.communityCursor !== null) {
            await this.busyAction(async () => {
                const serial = this.pageSerial;
                const page = await this.api.strategies.listCommunities({ page: { offset: this.communityCursor! } });
                if (serial !== this.pageSerial)
                    return;
                const known = new Set(this.rooms.map(room => room.communityKey));
                const next = page.items.filter(room => !known.has(room.communityKey));
                this.rooms.push(...next);
                this.communityCursor = page.nextOffset;
                document.querySelector('.community-grid')!.insertAdjacentHTML('beforeend', communityCards(next));
                if (page.nextOffset === null)
                    target.remove();
                this.updateChrome();
            });
            return;
        }
        if (action === 'more-history' && this.historyCursor !== null && this.activeVersion) {
            await this.busyAction(async () => {
                const serial = this.pageSerial;
                const version = this.activeVersion!;
                const page = await this.api.strategies.listVersions({ rootVersionKey: version.rootVersionKey ?? version.versionKey, page: { offset: this.historyCursor! } });
                if (serial !== this.pageSerial)
                    return;
                this.historyCursor = page.nextOffset;
                target.insertAdjacentHTML('beforebegin', page.versions.map(row => `<a class="history-row" href="#/strategies/${row.versionKey}"><span class="version-dot"></span><span>${row.rootVersionKey ? 'Revision' : 'Root publication'}<small>${e(short(row.versionKey))}</small></span>${icon('arrow')}</a>`).join(''));
                if (page.nextOffset === null)
                    target.remove();
            });
            return;
        }
        if (action === 'connect') {
            if (this.preview)
                failure('PREVIEW_ONLY');
            if (!this.host.wallet) {
                this.setup();
                return;
            }
            await this.busyAction(async () => {
                await this.host.wallet!.connect();
                await this.host.wallet!.switchChain?.(7794095);
                await this.accountChanged();
            });
            return;
        }
        if (action === 'login') {
            await this.busyAction(async () => {
                if (!this.host.wallet || !this.host.marketplaceReady)
                    failure('DEPENDENCY_UNAVAILABLE');
                const generation = this.generation;
                const dialog = this.dialog;
                await this.market.login(this.host.wallet);
                this.ensureGeneration(generation);
                if (dialog?.open && dialog === this.dialog && dialog.querySelector('[data-form="sell"]')) {
                    dialog.querySelector('[data-action="login"]')?.replaceWith(document.createTextNode('Marketplace signed in'));
                    this.toast('Marketplace sign-in verified. Your draft is preserved.');
                    return;
                }
                this.closeDialog();
                this.toast('Marketplace sign-in verified.');
                await this.render();
            });
            return;
        }
        if (action === 'logout') {
            const wallet = this.market.session.wallet;
            try {
                if (wallet)
                    await this.market.post('/auth/logout', {}, wallet);
            }
            finally {
                this.market.session.clear();
                this.attempt = undefined;
                this.sellerDraft = undefined;
                this.closeDialog();
                await this.render();
            }
            return;
        }
        if (action === 'reconcile') {
            await this.busyAction(() => this.reconcile());
            return;
        }
        if (action === 'new-community') {
            location.hash = '/create-community';
            return;
        }
        if (action === 'edit-community' && this.activeCommunity) {
            const room = this.activeCommunity;
            this.openDialog('A clearer introduction.', `<form data-form="edit-community">${field('name', 'Community name', { required: true, value: room.name })}${field('description', 'Description', { area: true, value: room.description })}<button class="button primary">Update public details</button></form>`);
            return;
        }
        if (action === 'edit-profile') {
            const account = await this.requireAccount();
            const profile = await this.api.community.getProfile({ wallet: account });
            this.openDialog('A name for your ideas.', `<form data-form="profile" data-previous="${profile?.key ?? ''}">${field('handle', 'Handle', { value: profile?.handle, required: true, pattern: '[a-z0-9_]{3,32}', hint: '3–32 lowercase letters, digits or underscore. Handles are not unique.' })}${field('displayName', 'Display name', { value: profile?.displayName, required: true })}${field('bio', 'A little about you', { value: profile?.bio, area: true })}${notice('Your profile is public and belongs to your connected wallet.')}<button class="button primary">Save profile ${icon('right')}</button></form>`);
            return;
        }
        if (action === 'membership' && this.activeCommunity) {
            const room = this.activeCommunity;
            const state = this.membership?.event?.data.state === 'joined' ? 'left' : 'joined';
            const parent = this.membership?.event?.key;
            await this.busyAction(() => this.write('membership', { state }, requestId => this.api.community.setMembership({ requestId, communityKey: room.communityKey, state, ...(parent ? { previousKey: parent } : {}) }), room.communityKey));
            return;
        }
        if (action === 'new-thread') {
            this.openDialog('Give the room something to think about.', `<form data-form="thread">${field('title', 'Start with a clear title', { required: true, placeholder: 'What is the idea, question or assumption?' })}${field('body', 'Share the reasoning', { area: true, required: true, placeholder: 'Show your work. Invite another perspective.' })}${field('strategyVersionKey','Public strategy version (optional)',{placeholder:'0x…',hint:'Paste an Arkiv version key to attach a strategy others can open or drag into the builder.'})}${notice('Threads are public. Each publication uses Rabdi gas.')}<button class="button primary">Publish thread ${icon('right')}</button></form>`);
            return;
        }
        if (action === 'share-strategy' && this.activeVersion) {
            const version = this.activeVersion;
            const rooms = await this.getCommunities();
            this.openDialog('Share this strategy in a community', `<form data-form="share-strategy" data-version="${version.versionKey}"><label class="field"><span>Community</span><select name="communityKey" required>${rooms.map(room=>`<option value="${room.communityKey}">${e(room.name)}</option>`).join('')}</select></label>${field('title','Post title',{required:true,value:version.document.name})}${field('body','Explain your strategy',{area:true,required:true,value:version.document.description})}${notice('Join the selected community before posting. Readers can open this exact strategy version in the builder.')}<button class="button primary">Publish strategy post</button></form>`);
            return;
        }
        if (action === 'moderate') {
            this.openDialog('Keep the conversation thoughtful.', `<form data-form="ban">${field('wallet', 'Wallet to restrict', { required: true, placeholder: '0x…' })}<label class="field"><span>Action</span><select name="banned"><option value="true">Restrict posting</option><option value="false">Restore posting</option></select></label><button class="button primary">Apply ban</button></form><form data-form="moderator">${field('wallet','Moderator wallet',{required:true,placeholder:'0x…'})}<label class="field"><span>Action</span><select name="enabled"><option value="true">Appoint moderator</option><option value="false">Remove moderator</option></select></label><button class="button secondary">Update moderator</button></form>${notice('Moderators can hide content. Only the owner can ban or appoint. Records remain public on Arkiv; each action uses Rabdi gas.')}`);
            return;
        }
        if (action === 'hide' && target.dataset.key && this.activeCommunity) {
            const contentKey = target.dataset.key as Hex;
            const room = this.activeCommunity;
            this.openDialog('Hide this content?', `<p>This removes the content from the community’s visible feed. It remains public on the chain.</p>${button('confirm-hide', 'Hide content', 'primary', `data-key="${contentKey}"`)} ${button('unhide', 'Restore this content', 'secondary', `data-key="${contentKey}" data-room="${room.communityKey}"`)}`);
            return;
        }
        if ((action === 'confirm-hide' || action === 'unhide') && target.dataset.key) {
            const contentKey = target.dataset.key as Hex;
            const room = (target.dataset.room ?? this.activeCommunity?.communityKey) as Hex;
            const hidden = action === 'confirm-hide';
            const previous = this.lastHidden, generation = this.generation;
            this.lastHidden = hidden && this.account ? { key: contentKey, room, owner: this.account } : undefined;
            try {
                await this.busyAction(() => this.write('hidden', { contentKey, hidden }, requestId => this.api.community.setHidden({ requestId, communityKey: room, contentKey, hidden }), room));
            }
            catch (error) {
                if (generation === this.generation)
                    this.lastHidden = previous;
                throw error;
            }
            return;
        }
        if (action === 'publish' || action === 'fork' || action === 'revise') {
            if (this.preview)
                failure('PREVIEW_ONLY');
            if (!this.host.validateStrategyDocument) {
                this.setup();
                return;
            }
            const version = action === 'publish' ? undefined : this.activeVersion;
            this.openDialog(action === 'fork' ? 'Build on this exact version.' : action === 'revise' ? 'A better next version.' : 'Share the thinking.', `<form data-form="publish" data-mode="${action}">${field('document', 'Validated public strategy JSON', { area: true, required: true, value: version ? JSON.stringify(version.document, null, 2) : '', placeholder: 'Paste the public document exported by the strategy builder.', hint: 'The connected Dev 3 validator must accept the document.' })}${notice('This publishes the entire document publicly. Never paste purchased or private strategy code.')}<button class="button primary">Publish public ${action === 'fork' ? 'fork' : action === 'revise' ? 'revision' : 'strategy'} ${icon('right')}</button></form>`);
            return;
        }
        if (action === 'sell') {
            if (this.preview)
                failure('PREVIEW_ONLY');
            this.openDialog('Share your edge, on your terms.', `<form data-form="sell">${notice('Only public listing metadata goes on-chain. Source code uploads to the private encrypted vault.')}${!this.market.session.token ? button('login', 'Sign in to marketplace', 'secondary') : tag('Marketplace signed in', 'green')}${field('title', 'Listing title', { required: true, placeholder: 'A name for your strategy package' })}${field('description', 'Public description', { area: true, placeholder: 'Explain the approach without revealing the private code.' })}${field('strategy', 'Private strategy JSON', { area: true, required: true, placeholder: 'Paste the validated private payload. This stays out of public listings.' })}${field('terms', 'Commercial terms', { area: true, required: true, placeholder: 'What is the buyer allowed to do with this code?' })}${field('price', 'Price' + (this.host.payment ? ' · ' + this.host.payment.symbol : ''), { required: true, placeholder: '12.00', hint: this.host.payment ? this.host.payment.networkName : 'The team must configure an approved payment token before listing.' })}<button class="button primary">Upload privately & publish listing ${icon('right')}</button></form>`);
            return;
        }
        if (action === 'delist' && this.activeListing) {
            const listing = this.activeListing;
            await this.busyAction(() => this.write('delisted', { listingKey: listing.key }, requestId => this.api.community.delist({ listingKey: listing.key, requestId })));
            return;
        }
        if (action === 'quote' && this.activeListing) {
            await this.busyAction(async () => {
                const account = await this.requireMarket();
                return withWalletLock(async () => {
                    const listing = this.activeListing!;
                    const currency = this.host.payment!.currency;
                    if (serialize(currency) !== serialize(listing.currency))
                        failure('LISTING_UNAVAILABLE');
                    const existing = this.recoveries().reverse().find(row => row.buyer === account && row.listingKey === listing.key);
                    if (existing?.orderId) {
                        await this.resume(existing.orderId);
                        return;
                    }
                    const generation = this.generation;
                    const requestId = existing?.requestId ?? crypto.randomUUID();
                    this.saveRecovery({ buyer: account, orderId: '', requestId, listingKey: listing.key });
                    const result = await this.market.post<unknown>('/orders', { requestId, listingKey: listing.key }, account);
                    this.ensureGeneration(generation);
                    const quote = validateQuote(result, account, listing);
                    this.attempt = new PaymentAttempt(quote);
                    this.saveRecovery({ buyer: account, orderId: quote.orderId, requestId, listingKey: listing.key });
                    await this.render();
                }, navigator.locks);
            });
            return;
        }
        if (action === 'pay' && this.attempt) {
            const q = this.attempt.quote;
            if (serialize(q.listing.currency) !== serialize(this.host.payment?.currency))
                failure('LISTING_UNAVAILABLE');
            this.openDialog('Review before you pay.', `<dl><dt>Seller</dt><dd><code>${e(q.listing.seller)}</code></dd><dt>Amount</dt><dd>${e(formatAmount(q.listing.amount, q.listing.currency.decimals))} ${e(this.host.payment?.symbol)}</dd><dt>Network</dt><dd>${e(this.host.payment?.networkName)}</dd><dt>Terms</dt><dd class="preserve">${e(q.listing.terms)}</dd></dl>${notice('This sends a direct token transfer. It does not start trading. Gas is separate.')}<form data-form="pay"><label class="check-field"><input type="checkbox" required> I reviewed the seller, network, price and terms.</label><button class="button primary">Confirm in wallet ${icon('arrow')}</button></form>`);
            return;
        }
        if (action === 'settle') {
            await this.busyAction(() => this.settle());
            return;
        }
        if (action === 'resume' && target.dataset.order) {
            await this.busyAction(() => this.resume(target.dataset.order!));
            return;
        }
        if (action === 'download' && target.dataset.package && target.dataset.hash) {
            await this.busyAction(() => this.download(target.dataset.package!, target.dataset.hash as Hex));
            return;
        }
    }
    async submit(form: HTMLFormElement) {
        const data = new FormData(form);
        const value = (key: string) => String(data.get(key) ?? '');
        const kind = form.dataset.form;
        if (kind === 'search') {
            location.hash = '/discover?q=' + encodeURIComponent(value('q'));
            return;
        }
        await this.busyAction(async () => {
            if (kind === 'community') {
                const name = checkedText(value('name').trim(), 1, 80), description = checkedText(value('description'), 0, 4096);
                const result = await this.write('community', { name, description }, requestId => this.api.strategies.createCommunity({ requestId, name, description }));
                const communityKey = result.state === 'written' ? result.receipt.entityKey : result.entityKey;
                location.hash = '/community/' + communityKey;
            }
            else if (kind === 'edit-community') {
                const account = await this.requireAccount();
                const room = this.activeCommunity!;
                if (account !== room.owner || this.pending)
                    failure('NOT_OWNER');
                const name = checkedText(value('name').trim(), 1, 80), description = checkedText(value('description'), 0, 4096);
                await this.write('community-update', { name, description }, () => this.api.strategies.updateCommunity({ communityKey: room.communityKey, name, description }), room.communityKey);
            }
            else if (kind === 'profile') {
                const input = { handle: value('handle'), displayName: checkedText(value('displayName'), 1, 80), bio: checkedText(value('bio'), 0, 512) };
                await this.write('profile', input, requestId => this.api.community.saveProfile({ requestId, ...input, ...(form.dataset.previous ? { previousKey: form.dataset.previous as Hex } : {}) }));
            }
            else if (kind === 'thread' || kind === 'reply' || kind === 'message') {
                const room = this.activeCommunity!;
                const body = checkedText(value('body'), 1, kind === 'thread' ? 4096 : 2000);
                const expected: Record<string, Json> = { body };
                if (kind === 'thread')
                    expected.title = checkedText(value('title'), 1, 80);
                if (kind === 'thread' && value('strategyVersionKey').trim()) {
                    const versionKey = value('strategyVersionKey').trim();
                    if (!keyPattern.test(versionKey)) failure('INVALID_INPUT');
                    expected.strategyVersionKey = versionKey;
                }
                if (kind === 'reply')
                    expected.threadKey = this.route()[2]!;
                await this.write(kind, expected, requestId => kind === 'thread' ? this.api.community.createThread({ requestId, communityKey: room.communityKey, title: expected.title as string, body, ...(expected.strategyVersionKey ? {strategyVersionKey:expected.strategyVersionKey as Hex} : {}) }) : kind === 'reply' ? this.api.community.reply({ requestId, communityKey: room.communityKey, threadKey: expected.threadKey as Hex, body }) : this.api.community.sendMessage({ requestId, communityKey: room.communityKey, body }), room.communityKey);
            }
            else if (kind === 'share-strategy') {
                const communityKey = value('communityKey') as Hex, strategyVersionKey = form.dataset.version as Hex;
                if (!keyPattern.test(communityKey) || !keyPattern.test(strategyVersionKey)) failure('INVALID_INPUT');
                const expected = {title:checkedText(value('title'),1,80),body:checkedText(value('body'),1,4096),strategyVersionKey};
                const post = await this.write('thread',expected,requestId=>this.api.community.createThread({requestId,communityKey,...expected}),communityKey);
                location.hash = '/thread/' + communityKey + '/' + post.key;
            }
            else if (kind === 'ban') {
                const wallet = value('wallet').toLowerCase() as Hex;
                if (!walletPattern.test(wallet))
                    failure('INVALID_INPUT');
                const banned = value('banned') === 'true';
                const room = this.activeCommunity!;
                await this.write('ban', { wallet, banned }, requestId => this.api.community.setBan({ requestId, communityKey: room.communityKey, wallet, banned }), room.communityKey);
            }
            else if (kind === 'moderator') {
                const wallet=value('wallet').toLowerCase() as Hex;
                if(!walletPattern.test(wallet))failure('INVALID_INPUT');
                const enabled=value('enabled')==='true',room=this.activeCommunity!;
                await this.write('moderator',{wallet,enabled},requestId=>this.api.community.setModerator({requestId,communityKey:room.communityKey,wallet,enabled}),room.communityKey);
            }
            else if (kind === 'profile-search') {
                const handle = value('handle');
                const rows = this.preview ? this.preview.profiles.filter(row => row.handle === handle) : await this.api.community.searchProfiles({ handle });
                document.querySelector('#profile-results')!.innerHTML = rows.map(row => `<a class="profile-result" href="#/profile/${row.wallet}">${avatar(row.wallet)}<span>${e(row.displayName)}<small>@${e(row.handle)} · ${e(short(row.wallet))}</small></span>${icon('arrow')}</a>`).join('') || '<p class="muted">No matching public profiles in this view.</p>';
            }
            else if (kind === 'publish') {
                if (!this.host.validateStrategyDocument)
                    failure('DEPENDENCY_UNAVAILABLE');
                let input: unknown;
                try {
                    input = JSON.parse(checkedText(value('document'), 1, 65536));
                }
                catch {
                    return failure('INVALID_INPUT');
                }
                const document = this.host.validateStrategyDocument(input);
                if (serialize(input) !== serialize(document))
                    failure('INVALID_INPUT');
                const contentHash = keccak256(toBytes('strategyhub:content:v1\n' + serialize(document)));
                const mode = form.dataset.mode, version = this.activeVersion;
                const result = await this.write('version', { contentHash }, requestId => mode === 'fork' && version ? this.api.strategies.forkVersion({ requestId, sourceVersionKey: version.versionKey, document }) : mode === 'revise' && version ? this.api.strategies.publishVersion({ requestId, rootVersionKey: version.rootVersionKey ?? version.versionKey, expectedParentVersionKey: version.versionKey, document }) : this.api.strategies.publishStrategy({ requestId, document }));
                if (form.dataset.builder) sessionStorage.removeItem('poros.public-draft');
                location.hash = '/strategies/' + (result.state === 'written' ? result.receipt.entityKey : result.entityKey);
            }
            else if (kind === 'sell') {
                await this.sell(data);
            }
            else if (kind === 'pay') {
                const account = await this.requireMarket();
                if (!this.attempt || !this.host.wallet)
                    failure('INVALID_INPUT');
                const attempt = this.attempt;
                const q = attempt.quote;
                if (q.buyer !== account)
                    failure('ACCOUNT_CHANGED');
                try {
                    await sendPaymentOnce(attempt, this.host.wallet, {
                        read: orderId => this.recoveries().find(row => row.orderId === orderId && row.buyer === account),
                        write: (orderId, state) => this.saveRecovery({ buyer: account, orderId, requestId: q.requestId, listingKey: q.listing.key, ...state }, !state.attempted && !state.hash),
                    }, navigator.locks);
                }
                catch (error) {
                    if (attempt.state === 'unknown' || attempt.state === 'submitted') {
                        this.closeDialog();
                        await this.render();
                        failure('WRITE_STATUS_UNKNOWN');
                    }
                    throw error;
                }
                this.closeDialog();
                this.toast('Transfer submitted. Verify this original transaction; do not send another.');
                await this.render();
            }
            else if (kind === 'recover-payment') {
                const hash = value('hash') as Hex;
                if (!keyPattern.test(hash) || !this.attempt)
                    failure('INVALID_INPUT');
                this.attempt.hash = hash;
                await this.settle();
            }
        });
    }
    saveRecovery(recovery: Recovery, resetPreflight = false) {
        try {
            const rows = mergeRecovery(this.recoveries(), recovery, resetPreflight);
            localStorage.setItem('common-ground.orders', JSON.stringify(rows));
        }
        catch {
            failure('DEPENDENCY_UNAVAILABLE');
        }
    }
    recoveries(): Recovery[] {
        try {
            const rows = JSON.parse(localStorage.getItem('common-ground.orders') ?? '[]');
            return Array.isArray(rows) ? rows.filter(row => row && walletPattern.test(row.buyer) && keyPattern.test(row.listingKey) && typeof row.orderId === 'string' && typeof row.requestId === 'string') : [];
        }
        catch {
            return failure('DEPENDENCY_UNAVAILABLE');
        }
    }
    async resume(orderId: string) {
        const account = await this.requireMarket();
        const generation = this.generation;
        const order = await this.market.post<Order>('/orders/get', { orderId }, account);
        const result = await this.market.post<unknown>('/orders', { requestId: order.requestId, listingKey: order.listing.key }, account);
        this.ensureGeneration(generation);
        const quote = validateQuote(result, account, order.listing);
        this.attempt = new PaymentAttempt(quote);
        const local = this.recoveries().find(row => row.orderId === orderId && row.buyer === account);
        if (local?.attempted && !order.transactionHash) {
            this.attempt.hash = local.hash;
            this.attempt.state = local.hash ? 'submitted' : 'unknown';
        }
        else if (order.transactionHash)
            this.attempt.hash = order.transactionHash;
        location.hash = '/listing/' + order.listing.key;
        await this.render();
    }
    async settle() {
        const account = await this.requireMarket();
        const attempt = this.attempt;
        if (!attempt?.hash || attempt.quote.buyer !== account)
            failure('INVALID_INPUT');
        const generation = this.generation;
        const result = await this.market.post<{
            orderId: string;
            state: string;
            contentHash: Hex;
        }>('/orders/settle', { orderId: attempt.quote.orderId, transactionHash: attempt.hash }, account);
        this.ensureGeneration(generation);
        if (result.orderId !== attempt.quote.orderId || result.state !== 'paid' || result.contentHash !== attempt.quote.listing.contentHash)
            failure('INTEGRITY_FAILED');
        attempt.state = 'paid';
        this.closeDialog();
        this.toast('Payment verified. Your package is ready for an authorized download.');
        await this.render();
    }
    async download(packageId: string, contentHash: Hex) { const account = await this.requireMarket(); const generation = this.generation; const serial = this.pageSerial; const data = await this.market.post<unknown>('/packages/download', { packageId }, account); this.ensureGeneration(generation); if (serial !== this.pageSerial)
        return; const checked = verifyDownload(data, { packageId, contentHash }, this.host.validatePrivateStrategy); const json = JSON.stringify({ packageSchema: checked.packageSchema, strategy: checked.strategy, terms: checked.terms }, null, 2); this.openDialog('Your verified private package.', notice('Content commitment and strategy validation passed. This does not authorize agentic trading.') + `<p><code>${e(contentHash)}</code></p><pre class="code-panel private-code">${e(json)}</pre><p class="muted">Private content is held in this view’s memory. Closing it removes it from the page.</p>`); }
    async sell(data: FormData) {
        const account = await this.requireMarket();
        const generation = this.generation;
        const value = (key: string) => String(data.get(key) ?? '');
        let strategy: unknown;
        try {
            strategy = JSON.parse(checkedText(value('strategy'), 1, 65536));
        }
        catch {
            return failure('INVALID_INPUT');
        }
        const checked = this.host.validatePrivateStrategy!(strategy);
        if (serialize(checked) !== serialize(strategy))
            failure('INVALID_INPUT');
        const terms = checkedText(value('terms'), 1, 4096), title = checkedText(value('title'), 1, 80), description = checkedText(value('description'), 0, 2048);
        const amount = parseAmount(value('price'), this.host.payment!.currency.decimals);
        const fingerprint = serialize({ strategy: checked, terms })!;
        if (!this.sellerDraft || this.sellerDraft.fingerprint !== fingerprint)
            this.sellerDraft = { fingerprint, requestId: crypto.randomUUID() };
        const draft = this.sellerDraft;
        const expectedHash = keccak256(toBytes('strategyhub:private-package:v1\n' + serialize({ packageSchema: 'private-strategy/1', strategy: checked, terms })));
        if (!draft.upload) {
            const upload = await this.market.post<{
                packageId: string;
                contentHash: Hex;
                terms: string;
                seller: Hex;
            }>('/packages', { requestId: draft.requestId, strategy: checked, terms }, account);
            this.ensureGeneration(generation);
            if (upload.seller !== account || upload.contentHash !== expectedHash || upload.terms !== terms || typeof upload.packageId !== 'string')
                failure('INTEGRITY_FAILED');
            draft.upload = upload;
        }
        const upload = draft.upload;
        const currency = this.host.payment!.currency;
        await this.write('listing', { packageId: upload.packageId, contentHash: upload.contentHash, title, description, terms, currency: { ...currency }, amount }, requestId => this.api.community.publishListing({ requestId, packageId: upload.packageId, contentHash: upload.contentHash, title, description, terms, currency, amount }));
        this.sellerDraft = undefined;
    }
}
void new Application(integration).start();
