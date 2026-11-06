import type { Hex, PublicClient } from 'viem';
import { address, entityKey } from '../codec.ts';
import { fail, StorageError } from '../errors.ts';

export const SEPOLIA_CHAIN_ID = 11155111;
export const PAYMENT_CONFIRMATIONS = 2;
export type PaymentClient = Pick<PublicClient, 'getChainId' | 'getBlockNumber' | 'getBlock' | 'getTransaction' | 'getTransactionReceipt'>;

export async function verifyMembershipPayment(client: PaymentClient, expected: {
  transactionHash: Hex; buyer: Hex; creator: Hex; priceWei: string; chainId?:number; input?:Hex;
}): Promise<number> {
  const hash = entityKey(expected.transactionHash);
  const buyer = address(expected.buyer);
  const creator = address(expected.creator);
  if (buyer === creator || !/^[1-9][0-9]{0,77}$/.test(expected.priceWei) || BigInt(expected.priceWei) >= 2n ** 256n) fail('INVALID_INPUT');
  try {
    if (await client.getChainId() !== (expected.chainId??SEPOLIA_CHAIN_ID)) fail('WRONG_CHAIN');
    const [receipt, transaction, head] = await Promise.all([
      client.getTransactionReceipt({ hash }), client.getTransaction({ hash }), client.getBlockNumber(),
    ]);
    if (receipt.status !== 'success' || receipt.transactionHash.toLowerCase() !== hash ||
        transaction.hash.toLowerCase() !== hash || !transaction.to || address(transaction.from) !== buyer ||
        address(transaction.to) !== creator || transaction.value !== BigInt(expected.priceWei) || transaction.input !== (expected.input??'0x') ||
        transaction.blockHash !== receipt.blockHash || transaction.blockNumber !== receipt.blockNumber ||
        head < receipt.blockNumber || head - receipt.blockNumber + 1n < BigInt(PAYMENT_CONFIRMATIONS)) fail('PAYMENT_UNVERIFIED');
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (block.hash !== receipt.blockHash) fail('PAYMENT_UNVERIFIED');
    const timestamp = Number(block.timestamp) * 1000;
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0) fail('PAYMENT_UNVERIFIED');
    return timestamp;
  } catch (error) {
    if (error instanceof StorageError) throw error;
    if (error && typeof error === 'object' && 'name' in error && /NotFound/.test(String(error.name))) fail('PAYMENT_UNVERIFIED');
    fail('NETWORK_UNAVAILABLE', 'Payment receipt verification is unavailable. Recover the original payment when the RPC responds.');
  }
}
