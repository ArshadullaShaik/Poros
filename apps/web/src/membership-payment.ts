import type { Hex } from 'viem';
import type { WalletBridge } from './integration.ts';
import { failure, keyPattern, walletPattern, withWalletLock } from './core.ts';

export interface MembershipPayment {
  buyer: Hex;
  creator: Hex;
  planKey: Hex;
  priceWei: string;
  requestId: string;
  attempted: boolean;
  hash?: Hex;
}
type Journal = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const storageKey = (buyer: Hex) => 'poros.membership-payment.' + buyer;

export function readMembershipPayment(storage: Journal, buyer: Hex): MembershipPayment | undefined {
  const raw = storage.getItem(storageKey(buyer));
  if (!raw) return;
  const value = JSON.parse(raw) as MembershipPayment;
  if (value.buyer !== buyer || !walletPattern.test(value.creator) || value.creator === buyer ||
      !keyPattern.test(value.planKey) ||
      !/^[1-9][0-9]{0,77}$/.test(value.priceWei) || BigInt(value.priceWei) >= 2n ** 256n ||
      !/^[0-9a-f-]{36}$/.test(value.requestId) || typeof value.attempted !== 'boolean' ||
      (value.hash !== undefined && !keyPattern.test(value.hash))) failure('INVALID_INPUT');
  return value;
}
export function saveMembershipPayment(storage: Journal, payment: MembershipPayment) {
  storage.setItem(storageKey(payment.buyer), JSON.stringify(payment));
}
export function clearMembershipPayment(storage: Journal, buyer: Hex) {
  storage.removeItem(storageKey(buyer));
}

export async function sendMembershipPayment(wallet: WalletBridge, payment: MembershipPayment, storage: Journal,
  preflight: () => Promise<void>, locks: LockManager) {
  return withWalletLock(async () => {
    if (readMembershipPayment(storage, payment.buyer)) failure('WRITE_STATUS_UNKNOWN');
    const original = await wallet.getContext();
    if (original.account.toLowerCase() !== payment.buyer) failure('ACCOUNT_CHANGED');
    await wallet.switchChain?.(11155111);
    await preflight();
    const current = await wallet.getContext();
    if (current.account.toLowerCase() !== payment.buyer || current.provider !== original.provider) failure('ACCOUNT_CHANGED');
    if (BigInt(await current.provider.request({method:'eth_chainId'})) !== 11155111n) failure('WRONG_CHAIN');
    const attempt = {...payment, attempted:true};
    saveMembershipPayment(storage, attempt);
    try {
      attempt.hash = await wallet.sendTransaction({chainId:11155111,to:payment.creator,data:'0x',value:('0x'+BigInt(payment.priceWei).toString(16)) as Hex},payment.buyer);
      saveMembershipPayment(storage, attempt);
      return attempt;
    } catch (error) {
      if (!attempt.hash && error && typeof error === 'object' && 'code' in error && error.code === 4001) {
        clearMembershipPayment(storage, payment.buyer);
      }
      throw error;
    }
  }, locks);
}
