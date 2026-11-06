import {tradingPairs} from '../../../src/features/builder/market/config.ts';
import {escape as e} from './core.ts';
import {field} from './ui.ts';

export function strategyQuestions() {
  const rule = (side: string) => `<fieldset class="strategy-rule" data-rule="${side}" disabled hidden><legend>${side==='buy'?'Buy':'Sell'}</legend>
    <div class="strategy-rule-fields"><label class="field"><span>Target price ($)</span><input name="${side}-min" type="number" min="0.000001" max="1000000" step="any" placeholder="e.g. ${side==='buy'?'2000':'2500'}" required></label>
    <label class="field strategy-order-amount"><span class="strategy-amount-label">Order amount <output data-order-value for="${side}-order-amount">$0.10</output></span><input id="${side}-order-amount" data-order-amount name="${side}-amount" type="range" min="0.10" max="20" step="0.01" value="0.10" aria-valuetext="$0.10"><small class="strategy-amount-limits"><span>$0.10</span><span>$20</span></small></label></div>
    <label class="strategy-range-toggle"><input type="checkbox" data-range-toggle> Use a price range</label>
    <label class="field" data-range-upper hidden><span>Up to price ($)</span><input name="${side}-max" type="number" min="0.000001" max="1000000" step="any" disabled></label>
  </fieldset>`;
  return `<fieldset class="strategy-questions"><legend>Trading rules</legend><div class="strategy-question-pair">
    <label class="field"><span>Market</span><select name="pair" required><option value="">Choose a market</option>${tradingPairs.map(pair=>`<option value="${e(pair.id)}">${e(pair.network.name)} · ${e(pair.base.symbol)} / ${e(pair.quote.symbol)}${pair.base.native?' (native)':''}</option>`).join('')}</select></label>
    <label class="field"><span>Action</span><select name="side" required><option value="">Choose an action</option><option value="buy">Buy</option><option value="sell">Sell</option><option value="both">Buy and sell</option></select></label></div>
    <div class="strategy-rule-grid">${rule('buy')}${rule('sell')}</div>
    <p class="strategy-rule-note">Each action runs once at its target. Buy and sell trigger independently. Up to $20 per order · 0.5% slippage.</p>
    ${field('body','Reasoning & risks',{required:true,area:true,placeholder:'Why this trade? What could go wrong?'})}
    <p class="strategy-rule-note">Posting shares your rules; it does not place a trade.</p>
  </fieldset><p data-strategy-error role="alert"></p>`;
}

export function mountStrategyQuestions(form: HTMLFormElement) {
  const side = form.elements.namedItem('side') as HTMLSelectElement;
  const groups = form.querySelectorAll<HTMLFieldSetElement>('[data-rule]');
  const update = () => groups.forEach(group=>{
    group.hidden = group.disabled = side.value !== 'both' && side.value !== group.dataset.rule;
    const toggle=group.querySelector<HTMLInputElement>('[data-range-toggle]')!;
    const upper=group.querySelector<HTMLElement>('[data-range-upper]')!;
    const input=upper.querySelector<HTMLInputElement>('input')!;
    upper.hidden=!toggle.checked;
    input.disabled=group.disabled||!toggle.checked;
    input.required=!input.disabled;
    const amount=group.querySelector<HTMLInputElement>('[data-order-amount]')!;
    const selected='$'+Number(amount.value).toFixed(2);
    group.querySelector<HTMLOutputElement>('[data-order-value]')!.textContent=selected;
    amount.setAttribute('aria-valuetext',selected);
  });
  side.addEventListener('change',update);
  groups.forEach(group=>{
    group.querySelector('[data-range-toggle]')!.addEventListener('change',update);
    group.querySelector('[data-order-amount]')!.addEventListener('input',update);
  });
  form.addEventListener('reset',()=>queueMicrotask(update));
  update();
}

export function strategyPostBody(data: FormData) {
  const value = (key: string) => String(data.get(key) ?? '').trim();
  const pair = tradingPairs.find(pair=>pair.id===value('pair'));
  if(!pair)throw new Error('Choose a registered market and network.');
  const side = value('side');
  if(!['buy','sell','both'].includes(side))throw new Error('Choose buy, sell, or both.');
  const rules = (side==='both'?['buy','sell']:[side]).map(action=>{
    const min=Number(value(action+'-min')),upper=value(action+'-max'),max=upper===''?min:Number(upper),amount=Number(value(action+'-amount'));
    if(!Number.isFinite(min)||!Number.isFinite(max)||min<=0||max>1000000||min>max)throw new Error(`Enter a positive ${action} price range with minimum ≤ maximum, up to $1,000,000.`);
    if(!Number.isFinite(amount)||amount<0.1||amount>20)throw new Error(`Choose a ${action} amount between $0.10 and $20.`);
    return `${action.toUpperCase()} $${amount} USD notional of ${pair.base.symbol} when its USD reference price is between $${min} and $${max}, inclusive. Execute this action once per run.`;
  });
  const notes=value('body');
  if(!notes)throw new Error('Explain the reasoning and risks of your strategy.');
  const body=[`Market: ${pair.base.symbol} / ${pair.quote.symbol} on ${pair.network.name} (registered pair: ${pair.id}). Funding token: ${pair.quote.symbol}.`,...rules,'Fixed order cap: $20 USD. Maximum slippage: 0.5% (50 bps).','Reasoning and risks:\n'+notes].join('\n\n');
  // Keep the post within both Arkiv's byte cap and the interpreter's character cap.
  if(new TextEncoder().encode(body).length>4000)throw new Error('Shorten the reasoning: the complete strategy post must fit within 4,000 UTF-8 bytes.');
  return body;
}
