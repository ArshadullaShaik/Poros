export const POT_CLAIM_LIMIT = '1.2771';

export function zeroGPotPage() {
    return `<section class="pot-page" aria-labelledby="pot-title">
      <header class="pot-heading"><span class="eyebrow">A LITTLE HELP FROM THE COMMUNITY</span><h1 id="pot-title">0G Pot</h1><p>Keep good ideas going. Give a little compute, or get a little help when yours runs out.</p></header>
      <div class="pot-layout">
        <section class="pot-bank" aria-label="Community compute pot">
          <span class="pot-label">COMMUNITY PIGGY BANK</span>
          <svg class="pot-pig" viewBox="0 0 400 320" role="img" aria-labelledby="pot-pig-title">
            <title id="pot-pig-title">A pink piggy bank holding the community compute pot</title>
            <ellipse cx="207" cy="285" rx="126" ry="14" fill="#e8def5"/>
            <circle cx="190" cy="64" r="29" fill="#ffdd85" stroke="#dba542" stroke-width="3"/>
            <path d="M184 48v32m12-32v32" stroke="#b68028" stroke-width="4" stroke-linecap="round"/>
            <path d="M84 180c-34 2-35-34-18-35 15-1 12 22-2 20" fill="none" stroke="#d5789d" stroke-width="8" stroke-linecap="round"/>
            <path d="M118 229v39q0 10 11 10h16q8 0 9-9l4-29m91-6 3 36q0 8 9 8h17q10 0 10-10v-47" fill="#ed9cbb" stroke="#d5789d" stroke-width="4"/>
            <ellipse cx="202" cy="186" rx="120" ry="80" fill="#f7bdd2" stroke="#d5789d" stroke-width="4"/>
            <path d="M260 126q-6-50 27-40l4 53" fill="#f7bdd2" stroke="#d5789d" stroke-width="4" stroke-linejoin="round"/>
            <path d="m273 115 5-14 3 19" fill="#e88eaf"/>
            <rect x="296" y="164" width="48" height="47" rx="19" fill="#ee9fbb" stroke="#d5789d" stroke-width="4"/>
            <ellipse cx="310" cy="187" rx="4" ry="7" fill="#9f526f"/><ellipse cx="329" cy="187" rx="4" ry="7" fill="#9f526f"/>
            <circle cx="275" cy="157" r="5" fill="#49364f"/>
            <ellipse cx="266" cy="185" rx="12" ry="7" fill="#ee98b8"/>
            <path d="M169 118h53" stroke="#9f526f" stroke-width="7" stroke-linecap="round"/>
            <path d="m113 161 9-12m6-5 7-4" stroke="#ffe7f0" stroke-width="8" stroke-linecap="round"/>
          </svg>
          <span class="pot-total-label">Total compute donated</span><strong class="pot-total">—</strong>
          <p class="pot-bank-caption">The verified donation total will appear here.</p>
          <dl class="pot-totals"><div><dt>Available to share</dt><dd>—</dd></div><div><dt>Credits claimed</dt><dd>—</dd></div></dl>
        </section>
        <div class="pot-actions">
          <section class="paper-panel pot-action"><span class="pot-step">01 · GIVE</span><h2>Feed the piggy bank</h2><p>Share unused daily iAI staking compute credits before they expire at 00:00 UTC.</p>
            <button type="button" class="button primary" disabled aria-describedby="pot-donate-status">Donate compute</button><p id="pot-donate-status" class="pot-status">Coming soon. Daily allowance donations are not connected yet.</p>
          </section>
          <section class="paper-panel pot-action"><span class="pot-step">02 · RECEIVE</span><h2>A little extra when you need it</h2><p>Claim once per UTC day, up to <strong>${POT_CLAIM_LIMIT} extra compute credits</strong>, only after your own allowance is exhausted. The daily claim limit resets at 00:00 UTC.</p>
            <button type="button" class="button secondary" disabled aria-describedby="pot-claim-status">Claim up to ${POT_CLAIM_LIMIT} credits</button><p id="pot-claim-status" class="pot-status">Claims stay locked until your remaining allowance can be verified.</p>
          </section>
        </div>
      </div>
      <p class="pot-setup" role="status">Funding setup in progress. No donations or claims are being processed yet.</p>
    </section>`;
}
