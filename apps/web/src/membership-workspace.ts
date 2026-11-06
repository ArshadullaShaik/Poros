import type { Hex } from 'viem';
import type { EventRepository } from '../../../src/integrations/arkiv/community/contracts.ts';
import type { compose, WalletBridge } from './integration.ts';
import { CreatorMembershipPanel } from './creator-membership.ts';
import { escape as e, walletPattern, short, formatAmount } from './core.ts';
import type { memberStrategy } from './member-strategy.ts';

interface WorkspaceOptions {
  wallet?: WalletBridge;
  events: EventRepository;
  community: ReturnType<typeof compose>['community'];
  accessKey?: string;
  creator?: string;
  openStrategy?: (entry: ReturnType<typeof memberStrategy>) => Promise<void>;
  getDraft?: () => unknown;
  onCreators?: (creators: {id:string;name:string}[]) => void;
}

export function membershipCreatorCard(creator:string,name:string|undefined,detail:string,action:string){
  return `<article class="creator-discovery-card"><strong data-creator-name="${e(creator)}">${e(name??short(creator))}</strong><small><code title="${e(creator)}">${e(short(creator))}</code></small><p>${e(detail)}</p><a class="button secondary" href="/profile#/profile/${e(creator)}">View profile</a> <button type="button" class="button primary" data-creator="${e(creator)}">${e(action)}</button></article>`;
}

export function mountMembershipWorkspace(root: HTMLElement, options: WorkspaceOptions) {
  const names = new Map<string,string>();
  const activeCreators = new Set<string>();
  let account: Hex | undefined;
  let generation = 0;
  let selected: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let accountRead = 0;
  const panel = new CreatorMembershipPanel(options.wallet,options.events,options.accessKey,{
    openStrategy:options.openStrategy,getDraft:options.getDraft,saved:() => { void refreshLists(); },
  });
  root.innerHTML = `<p>Choose a creator and buy their 30-day membership. Members do not pay to open individual messages.</p><p data-workspace-status role="status"></p><section><h3>Your subscriptions</h3><div data-subscriptions-list>Connect your wallet to load saved memberships.</div></section><section><h3>Creator memberships</h3><div data-plan-list>Reading creator plans…</div></section><form data-creator-search><label class="field"><span>Find a creator by handle</span><input name="creator" required placeholder="creator_handle"></label><button class="button secondary">Find creator</button></form><div data-creator-results></div><p class="muted">Names identify profiles. The connected wallet verifies ownership and receives membership payments. You can also search with a full wallet address.</p><div data-creator-panel></div>`;
  const status = (message: string) => { root.querySelector('[data-workspace-status]')!.textContent = message; };
  const card = (creator: string, detail: string, action='View membership') => membershipCreatorCard(creator,names.get(creator),detail,action);

  async function loadNames(creators: string[]) {
    for (let offset=0;offset<creators.length;offset+=4) {
      await Promise.all(creators.slice(offset,offset+4).map(async creator => {
        try {
          const profile = await options.community.getProfile({wallet:creator as Hex});
          if (disposed || !profile) return;
          names.set(creator,profile.displayName+' (@'+profile.handle+')');
          root.querySelectorAll<HTMLElement>('[data-creator-name]').forEach(label => {
            if(label.dataset.creatorName === creator) label.textContent = names.get(creator)!;
          });
        } catch { /* Wallet identity remains available when a profile cannot be read. */ }
      }));
    }
  }
  function selectCreator(creator: string) {
    if (disposed) return;
    if (!walletPattern.test(creator)) throw new Error('Enter a complete Ethereum wallet address.');
    selected = creator.toLowerCase();
    panel.detach();
    const slot = root.querySelector('[data-creator-panel]')!;
    slot.innerHTML = `<h3 tabindex="-1" data-creator-name="${e(selected)}">${e(names.get(selected) ?? short(selected))}</h3><a href="/community#/profile/${selected}">View creator profile</a><section class="paper-panel"></section>`;
    slot.querySelector<HTMLElement>('h3')!.focus();
    void panel.mount(slot.querySelector('section')!,selected as Hex,account,false);
  }

  async function refreshLists() {
    if (disposed) return;
    const current = ++generation;
    clearTimeout(timer);
    const connected = account;
    activeCreators.clear();
    root.querySelector('[data-plan-list]')!.textContent = 'Reading creator plans…';
    root.querySelector('[data-subscriptions-list]')!.textContent = connected ? 'Verifying saved memberships…' : 'Connect your wallet to load saved memberships.';
    options.onCreators?.([]);
    const plans = async () => {
      try {
        const rows = await panel.service.plans();
        if (disposed || current !== generation) return;
        root.querySelector('[data-plan-list]')!.innerHTML = rows.length
          ? rows.map(plan => card(plan.actor,formatAmount(String(plan.data.priceWei),18)+' Sepolia ETH / 30 days',plan.actor===connected?'Manage membership':activeCreators.has(plan.actor)?'Open messages':'Buy membership')).join('')
          : '<p>No creator has published a membership price yet.</p>';
        void loadNames(rows.map(row=>row.actor));
      } catch {
        if (!disposed && current === generation) root.querySelector('[data-plan-list]')!.textContent = 'Creator plans could not be loaded. Reload this page to try again.';
      }
    };
    const subscriptions = async () => {
      if (!connected) return;
      try {
        const [rows,now] = await Promise.all([panel.service.subscriptions(connected),panel.readers.now()]);
        if (disposed || current !== generation) return;
        const active = rows.filter(row => row.expiresAt > now);
        for(const row of active)activeCreators.add(row.creator);
        root.querySelector('[data-subscriptions-list]')!.innerHTML = rows.length
          ? rows.map(row => card(row.creator,(row.expiresAt > now?'Active until ':'Expired ')+new Date(row.expiresAt).toLocaleString(),row.expiresAt>now?'Open messages':'Renew membership')).join('')
          : '<p>This wallet has no verified creator memberships yet.</p>';
        void loadNames(rows.map(row=>row.creator));
        root.querySelectorAll<HTMLButtonElement>('button[data-creator]').forEach(button=>{
          if(activeCreators.has(button.dataset.creator??'')&&button.dataset.creator!==connected)button.textContent='Open messages';
        });
        options.onCreators?.(active.map(row => ({id:row.creator,name:short(row.creator)})));
        if (active.length) timer = setTimeout(() => { void refreshLists(); },Math.min(...active.map(row=>row.expiresAt-now),2147483647));
      } catch {
        if (!disposed && current === generation) root.querySelector('[data-subscriptions-list]')!.textContent = 'Membership verification is unavailable. Reload this page to try again.';
      }
    };
    await Promise.all([plans(),subscriptions()]);
  }

  async function accountChanged() {
    const read = ++accountRead;
    let next: Hex | undefined;
    try { next = (await options.wallet?.getContext())?.account.toLowerCase() as Hex | undefined; } catch { /* A disconnected wallet has no account. */ }
    if (disposed || read !== accountRead) return;
    if (next !== account) {
      panel.lock();
      account = next;
      if (selected) selectCreator(selected);
      await refreshLists();
    }
  }

  const click = async (event: MouseEvent) => {
    const target = (event.target as Element).closest<HTMLElement>('[data-creator]');
    if (!target) return;
    event.preventDefault(); event.stopPropagation();
    try {
      if (target.dataset.creator) selectCreator(target.dataset.creator);
      if (!disposed) status('');
    } catch (error) { if (!disposed) status(error instanceof Error?error.message:'Unable to open membership.'); }
  };
  const submit = async (event: SubmitEvent) => {
    if (!(event.target as HTMLFormElement).matches('[data-creator-search]')) return;
    event.preventDefault(); event.stopPropagation();
    try {
      const query = String(new FormData(event.target as HTMLFormElement).get('creator')).trim();
      if (walletPattern.test(query)) selectCreator(query);
      else {
        status('Finding creator…');
        const profiles = await options.community.searchProfiles({handle:query.replace(/^@/,'').toLowerCase()});
        if(disposed)return;
        for(const profile of profiles) names.set(profile.wallet,profile.displayName+' (@'+profile.handle+')');
        root.querySelector('[data-creator-results]')!.innerHTML = profiles.length ? profiles.map(profile=>card(profile.wallet,short(profile.wallet))).join('') : '<p>No profile matches this handle.</p>';
      }
      if(!disposed)status('');
    }
    catch (error) { if(!disposed)status((error as Error).message); }
  };
  root.addEventListener('click',click);
  root.addEventListener('submit',submit);
  const unsubscribe = options.wallet?.subscribe(() => { void accountChanged(); });
  void (async () => {
    await accountChanged();
    if (disposed) return;
    if (options.creator && walletPattern.test(options.creator)) selectCreator(options.creator);
    if (!account) await refreshLists();
  })();
  return {
    dispose() {
      disposed = true; generation++; clearTimeout(timer);
      unsubscribe?.(); panel.dispose();
      root.removeEventListener('click',click); root.removeEventListener('submit',submit);
      options.onCreators?.([]);
    },
  };
}
