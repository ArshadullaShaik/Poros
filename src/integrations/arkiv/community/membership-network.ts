import { createPublicClient as arkivClient } from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { CHAIN_ID } from '../schema.ts';
import { fail } from '../errors.ts';
import type { EventDTO } from './contracts.ts';

export function createMembershipReaders(accessKey?: string) {
  const arkiv = arkivClient({ chain: rabdi({ accessKey: accessKey ?? '' }), transport: http(typeof window === 'undefined' ? undefined : '/api/arkiv-rpc', { timeout: 10000, retryCount: 0 }) });
  return {
    payments: createPublicClient({ chain: sepolia, transport: http('/api/sepolia-rpc', { timeout: 15000, retryCount: 0 }) }),
    async now() { return Number((await arkiv.getBlock()).timestamp) * 1000; },
    async assertRetention(records: EventDTO[], until: number) {
      if (await arkiv.getChainId() !== CHAIN_ID) fail('WRONG_CHAIN');
      const timing = await arkiv.getBlockTiming();
      if (!Number.isFinite(timing.blockDuration) || timing.blockDuration <= 0) fail('NETWORK_UNAVAILABLE');
      const now = await arkiv.getBlock({blockNumber:timing.currentBlock});
      const blocks = BigInt(Math.ceil((until - Number(now.timestamp) * 1000 + 86400000) / (timing.blockDuration * 1000)));
      if (records.some(record => BigInt(record.expiresAtBlock) <= timing.currentBlock + blocks)) {
        fail('INVALID_INPUT', 'A required membership record expires too soon. Wait for the current membership to end or ask the creator to publish a fresh plan and encryption key.');
      }
    },
    async blockTimestamp(blockNumber: bigint) {
      if (await arkiv.getChainId() !== CHAIN_ID) fail('WRONG_CHAIN');
      const block = await arkiv.getBlock({ blockNumber });
      const timestamp = Number(block.timestamp) * 1000;
      if (!Number.isSafeInteger(timestamp) || timestamp <= 0) fail('INTEGRITY_FAILED');
      return timestamp;
    },
  };
}
