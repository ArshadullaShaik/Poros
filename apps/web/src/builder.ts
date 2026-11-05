import { createArkivStore } from '../../../src/integrations/arkiv/index.ts';
import { validateBuilderDocument } from './strategy-document.ts';
export { builderDocument, validateBuilderDocument } from './strategy-document.ts';
export const publicStrategies = createArkivStore({ validateStrategyDocument: validateBuilderDocument });

export function strategyReference(text: string, origin: string): `0x${string}` {
  if (text.length > 2048) throw new Error('Drop a public strategy card.');
  const url = new URL(text, origin);
  const key = url.searchParams.get('strategy');
  if (url.origin !== origin || url.pathname !== '/' || !key || !/^0x[0-9a-f]{64}$/.test(key)) throw new Error('Drop a public strategy card.');
  return key as `0x${string}`;
}
