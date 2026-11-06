import {tradingPairs} from '../../../src/features/builder/market/config.ts';
import {escape as e} from './core.ts';
import {field} from './ui.ts';

export function strategyQuestions() {
  const range = (side: string) => `<fieldset data-rule="${side}" disabled hidden><legend>When should it ${side}?</legend><p>Use an inclusive USD range. For one exact price, enter the same value twice.</p>${['min','max','amount'].map(key=>`<label class="field"><span>${key==='amount'?'How much USD per order?':key==='min'?'Minimum price (USD)':'Maximum price (USD)'}</span><input name="${side}-${key}" type="number" min="0.000001" max="${key==='amount'?20:1000000}" step="any" required></label>`).join('')}</fieldset>`;
  return `<fieldset class="strategy-questions"><legend>Make your strategy clear</legend>
    <label class="field"><span>Which market and network?</span><select name="pair" required><option value="">Choose a market</option>${tradingPairs.map(pair=>`<option value="${e(pair.id)}">${e(pair.network.name)} · ${e(pair.base.symbol)} / ${e(pair.quote.symbol)}${pair.base.native?' (native)':''}</option>`).join('')}</select></label>
    <label class="field"><span>What should the strategy do?</span><select name="side" required><option value="">Choose an action</option><option value="buy">Buy</option><option value="sell">Sell</option><option value="both">Buy and sell</option></select></label>
    ${range('buy')}${range('sell')}
    <p>Each selected action runs once per run when its range matches; a sell does not wait for a buy. Maximum $20 per order and 0.5% slippage. These questions describe fixed price rules; indicators, repeating orders, and leverage need a separate discussion.</p>
    ${field('body','Why this strategy, and what could go wrong?',{required:true,area:true,hint:'Explain your reasoning and risks. Put all executable conditions in the price ranges above.'})}
    <p>Answers appear in your post. Any attached strategy must match them. Readers review the rules in Trade before starting a run; posting never executes a trade.</p>
  </fieldset><p data-strategy-error role="alert"></p>`;
}

export function mountStrategyQuestions(form: HTMLFormElement) {
  const side = form.elements.namedItem('side') as HTMLSelectElement;
  const update = () => form.querySelectorAll<HTMLFieldSetElement>('[data-rule]').forEach(group=>{
    group.hidden = group.disabled = side.value !== 'both' && side.value !== group.dataset.rule;
  });
  side.addEventListener('change',update);
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
    const min=Number(value(action+'-min')),max=Number(value(action+'-max')),amount=Number(value(action+'-amount'));
    if(!Number.isFinite(min)||!Number.isFinite(max)||min<=0||max>1000000||min>max)throw new Error(`Enter a positive ${action} price range with minimum ≤ maximum, up to $1,000,000.`);
    if(!Number.isFinite(amount)||amount<=0||amount>20)throw new Error(`Enter a ${action} amount greater than $0 and no more than $20.`);
    return `${action.toUpperCase()} $${amount} USD notional of ${pair.base.symbol} when its USD reference price is between $${min} and $${max}, inclusive. Execute this action once per run.`;
  });
  const notes=value('body');
  if(!notes)throw new Error('Explain the reasoning and risks of your strategy.');
  const body=[`Market: ${pair.base.symbol} / ${pair.quote.symbol} on ${pair.network.name} (registered pair: ${pair.id}). Funding token: ${pair.quote.symbol}.`,...rules,'Fixed order cap: $20 USD. Maximum slippage: 0.5% (50 bps).','Reasoning and risks:\n'+notes].join('\n\n');
  // Keep the post within both Arkiv's byte cap and the interpreter's character cap.
  if(new TextEncoder().encode(body).length>4000)throw new Error('Shorten the reasoning: the complete strategy post must fit within 4,000 UTF-8 bytes.');
  return body;
}
