import type { Hex } from 'viem';
import type { EventDTO } from './contracts.ts';
import { entityKey } from '../codec.ts';
import { fail } from '../errors.ts';

export function latestEvent(rows: EventDTO[]): EventDTO | undefined {
  if (!rows.length) return undefined;
  const byKey = new Map(rows.map(row => [row.key, row]));
  const parents = new Set<Hex>();
  for (const row of rows) {
    if (!row.data.previousKey) continue;
    const parent = entityKey(row.data.previousKey);
    if (!byKey.has(parent)) fail('HISTORY_INCOMPLETE');
    parents.add(parent);
  }
  const tips = rows.filter(row => !parents.has(row.key));
  if (tips.length !== 1) fail('CONCURRENT_UPDATE');
  const visited = new Set<Hex>();
  let current = tips[0];
  while (current) {
    if (visited.has(current.key)) fail('INTEGRITY_FAILED');
    visited.add(current.key);
    const parent = current.data.previousKey ? byKey.get(entityKey(current.data.previousKey)) : undefined;
    if (parent && BigInt(parent.createdAtBlock) > BigInt(current.createdAtBlock)) fail('INTEGRITY_FAILED');
    current = parent;
  }
  if (visited.size !== rows.length) fail('CONCURRENT_UPDATE');
  return tips[0];
}
