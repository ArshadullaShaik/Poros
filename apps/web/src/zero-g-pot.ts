export const POT_CLAIM_LIMIT = '1.2771';
const SCALE = 10_000;
const CLAIM = 12_771;
export type PotDemo = {day:string; own:number; donated:number; available:number; claimed:number; received:boolean};
export function freshPotDemo(now = new Date()): PotDemo {
    return {day:now.toISOString().slice(0,10),own:12_710,donated:300_000,available:200_000,claimed:100_000,received:false};
}
export function updatePotDemo(state:PotDemo, action:'donate'|'use'|'claim', amount = '', now = new Date()):PotDemo {
    const next = {...(state.day === now.toISOString().slice(0,10) ? state : freshPotDemo(now))};
    if (action === 'use') next.own = 0;
    if (action === 'donate') {
        if (!/^\d{1,6}(\.\d{1,4})?$/.test(amount)) throw new Error('Enter a positive amount with up to four decimal places.');
        const units = Math.round(Number(amount)*SCALE);
        if (units <= 0 || units > next.own) throw new Error('Donate an amount within your remaining allowance.');
        next.own -= units; next.donated += units; next.available += units;
    }
    if (action === 'claim') {
        if (next.own > 0) throw new Error('Use your own daily allowance before claiming.');
        if (next.received) throw new Error('You have already claimed today. Come back after 00:00 UTC.');
        if (next.available <= 0) throw new Error('The pot is empty. Try again after a donation.');
        const units = Math.min(CLAIM,next.available);
        next.available -= units; next.claimed += units; next.own += units; next.received = true;
    }
    return next;
}
const credits = (units:number) => (units/SCALE).toFixed(4);
let demo = freshPotDemo();
const pig = String.raw`     |      |                         |      |
     |      |             /\          |      |
     |     /\            /::\         |      |
     |    /::\__________/::::\        |      |
     |   /.-'     ====      '-.       |      |
     | .'      . . . . .       '.     |      |
     |/     .'           '.   (o)\    |      |
     /     /    __    __   \      \   |      |
    /     ;    /  \  /  \  ;      \  |      |
   ;      |    |()|  |()|  |   .   ; |      |
   |      ;    \__/  \__/  ;   :   | |      |
   |       '.            .'    :   | |      |
  [o]        '----------'     .:  [o]      [o]
   |   .                       :   |        |
   |   :     .----.   .----.    .   |        |
   ;   :.   ( iAI  ) ( iAI  )       ;        |
    \     .--'----.---'----.----.  /         |
     \   ( iAI  )( iAI  )( iAI  )/          |
      \   '---.----'---.----'---'/           |
       '.    ( iAI  )( iAI  ) .'             |
         '-.  '----'  '----'.-'              |
          / '-------------' \               |
         /___/         \___\                |

                . . . . . .`;
export function zeroGPotPage() {
    if (demo.day !== new Date().toISOString().slice(0,10)) demo = freshPotDemo();
    return `<section class="pot-page" aria-labelledby="pot-title">
      <header class="pot-heading"><div><h1 id="pot-title">Community credit pot</h1><span class="pot-preview">MOCK DEMO</span></div><p>Pool spare iAI credits for other builders.</p></header>
      <div class="pot-layout">
        <section class="pot-bank" aria-label="0G Pot simulated balance">
          <div class="pot-art" role="img" aria-label="ASCII piggy bank suspended by strings and filled with decorative iAI coins"><pre aria-hidden="true">${pig}</pre></div>
          <span class="pot-total-label">Available credits</span>
          <strong class="pot-total">${credits(demo.available)}</strong>
          <dl class="pot-totals">
            <div><dt>Donated today</dt><dd>${credits(demo.donated)}</dd></div>
            <div><dt>Claimed today</dt><dd>${credits(demo.claimed)}</dd></div>
          </dl>

        </section>
        <div class="pot-actions">
          <div class="pot-balance"><span>Your demo allowance</span><strong>${credits(demo.own)} <small>credits</small></strong></div>
          <section class="pot-action"><h2>Donate credits</h2><p>Share unused credits before the daily reset.</p>
            <form id="pot-donate"><label class="sr-only" for="pot-amount">Credits to donate</label><div class="pot-donate-row"><input id="pot-amount" name="amount" type="number" min="0.0001" max="${credits(demo.own)}" step="0.0001" placeholder="0.0000" required ${demo.own === 0 ? 'disabled' : ''}><button type="submit" class="button primary" ${demo.own === 0 ? 'disabled' : ''}>Donate</button></div></form>
          </section>
          <section class="pot-action"><h2>Claim credits</h2><p>Up to <strong>${POT_CLAIM_LIMIT} credits</strong>, once per UTC day, after your own allowance runs out.</p>
            <button id="pot-claim" type="button" class="button secondary" ${demo.own > 0 || demo.received || demo.available <= 0 ? 'disabled' : ''}>${demo.received ? 'Claimed today' : 'Claim credits'}</button>
            <p class="pot-status">${demo.received ? 'Your next claim opens at 00:00 UTC.' : demo.own > 0 ? 'Available when your allowance reaches zero.' : 'Your demo account is eligible.'}</p>
          </section>
          <div class="pot-demo-tools"><span>Try the claim flow</span><button id="pot-use" type="button" ${demo.own === 0 ? 'disabled' : ''}>Use remaining demo allowance</button></div>
          <p id="pot-feedback" class="pot-feedback" role="status" aria-live="polite"></p>
        </div>
      </div>
      <footer class="pot-setup">Simulated credits only · Resets at 00:00 UTC or on page reload · No wallet transactions</footer>
    </section>`;
}
export function mountZeroGPot(root:HTMLElement) {
    const apply = (action:'donate'|'claim'|'use', amount = '') => {
        try {
            demo = updatePotDemo(demo,action,amount);
            root.innerHTML = zeroGPotPage();
            mountZeroGPot(root);
            const feedback = root.querySelector<HTMLElement>('#pot-feedback')!;
            feedback.textContent = action === 'donate' ? 'Demo donation added to the pot.' : action === 'claim' ? 'Demo credits added to your allowance.' : 'Allowance used up. You can now try claiming if you have not claimed today.';
            feedback.tabIndex = -1; feedback.focus();
        } catch (error) {
            root.querySelector<HTMLElement>('#pot-feedback')!.textContent = error instanceof Error ? error.message : 'Please try again.';
        }
    };
    root.querySelector('#pot-donate')?.addEventListener('submit',event => {
        event.preventDefault(); apply('donate',root.querySelector<HTMLInputElement>('#pot-amount')!.value);
    });
    root.querySelector('#pot-claim')?.addEventListener('click',() => apply('claim'));
    root.querySelector('#pot-use')?.addEventListener('click',() => apply('use'));
}
