import type { Hex } from 'viem';
export type ErrorCode = 'INVALID_INPUT' | 'UNSUPPORTED_SCHEMA' | 'PAYLOAD_TOO_LARGE' |
  'WALLET_REQUIRED' | 'WRONG_CHAIN' | 'ACCOUNT_CHANGED' | 'USER_REJECTED' | 'NOT_OWNER' |
  'NOT_FOUND_OR_EXPIRED' | 'INTEGRITY_FAILED' | 'UNTRUSTED_RECORD' | 'STALE_PARENT' |
  'MULTIPLE_TIPS' | 'IDEMPOTENCY_CONFLICT' | 'DUPLICATE_REQUEST' | 'CONCURRENT_UPDATE' |
  'RATE_LIMITED' | 'INSUFFICIENT_GAS' | 'NETWORK_UNAVAILABLE' | 'TRANSACTION_FAILED' |
  'WRITE_STATUS_UNKNOWN' | 'WRITE_CONFIRMED_READ_PENDING' | 'HISTORY_INCOMPLETE' | 'DEPENDENCY_UNAVAILABLE' |
  'PAYMENT_UNVERIFIED' | 'PAYMENT_REUSED' | 'KEY_REQUIRED' | 'MEMBERSHIP_EXPIRED';
export class StorageError extends Error {
  code: ErrorCode; retryable: boolean; entityKey?: Hex; requestId?: string; txHash?: Hex; included?: boolean;
  constructor(code: ErrorCode, message: string = code, details: {
    retryable?: boolean; entityKey?: Hex; requestId?: string; txHash?: Hex; included?: boolean;
  } = {}) {
    super(message); this.name = 'StorageError'; this.code = code;
    this.retryable = details.retryable ?? false; Object.assign(this, details);
  }
}
export function fail(code: ErrorCode, message?: string): never { throw new StorageError(code, message); }
export function mapError(error: unknown, writing = false): StorageError {
  if (error instanceof StorageError) return error;
  let item = error; let code: ErrorCode | undefined; let txHash: Hex | undefined;
  for (let depth = 0; depth < 8 && item && typeof item === 'object'; depth++) {
    const e = item as Record<string, unknown>;
    const text = String(e.message ?? '').toLowerCase();
    if (e.code === 4001 || /userrejected/i.test(String(e.name))) code = 'USER_REJECTED';
    else if (e.name === 'NoEntityFoundError') code = 'NOT_FOUND_OR_EXPIRED';
    else if (/insufficient funds|insufficient balance/.test(text)) code ??= 'INSUFFICIENT_GAS';
    else if (e.status === 429 || e.code === 429 || /rate.limit|too many requests/.test(text)) code ??= 'RATE_LIMITED';
    else if (/\breverted\b/.test(text)) code ??= 'TRANSACTION_FAILED';
    if (typeof e.txHash === 'string' && /^0x[\da-f]{64}$/i.test(e.txHash)) txHash = e.txHash as Hex;
    item = e.cause;
  }
  if(writing && code === 'RATE_LIMITED')code='WRITE_STATUS_UNKNOWN';
  code ??= writing ? 'WRITE_STATUS_UNKNOWN' : 'NETWORK_UNAVAILABLE';
  return new StorageError(code, code, { txHash, retryable: ['RATE_LIMITED', 'NETWORK_UNAVAILABLE', 'WRITE_STATUS_UNKNOWN'].includes(code) });
}
