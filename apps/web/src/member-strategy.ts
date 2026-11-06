import type { SignalContent } from '../../../src/integrations/arkiv/community/memberships.ts';
import { validatePriceStrategy } from '../../../src/features/builder/market/config.ts';
import { keyPattern } from './core.ts';

export const MEMBER_STRATEGY_TYPE = 'application/x-poros-member-strategy';

export function memberStrategy(content: SignalContent, versionId: string) {
  if (!keyPattern.test(versionId) || typeof content.title !== 'string' || !content.title.trim() ||
      typeof content.body !== 'string' || !content.body.trim() ||
      new TextEncoder().encode(content.title).length > 100 || new TextEncoder().encode(content.body).length > 4096) {
    throw new Error('The member strategy is invalid.');
  }
  if (content.strategy !== undefined) {
    const checked = validatePriceStrategy(content.strategy);
    if (!checked.valid || !checked.strategy.riskPolicy.paperTradingOnly) throw new Error('Load valid virtual-fund strategy rules.');
    return {id:versionId, versionId, name:content.title, strategy:checked.strategy};
  }
  return {id:versionId, versionId, name:content.title, text:content.body};
}

export function readMemberStrategy(raw:string):ReturnType<typeof memberStrategy>;
export function readMemberStrategy(raw:string,access:{wallet:string;now?:number}):ReturnType<typeof memberStrategy>&{memberWallet:string;expiresAt:number|null};
export function readMemberStrategy(raw: string, access?:{wallet:string;now?:number}) {
  if (raw.length > 16000) throw new Error('The member strategy is too large.');
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Drop a member strategy card.');
  const entry=memberStrategy(value.content, value.versionId);
  if(!access)return entry;
  if(value.memberWallet!==access.wallet||(!Number.isFinite(value.expiresAt)&&value.expiresAt!==null)||
    (value.expiresAt!==null&&value.expiresAt<=(access.now??Date.now())))throw new Error('Member access expired or the wallet changed. Refresh your messages.');
  return {...entry,memberWallet:value.memberWallet,expiresAt:value.expiresAt as number|null};
}
