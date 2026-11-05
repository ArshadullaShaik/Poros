import type { Hex } from 'viem';
import type { WalletBridge } from './integration.ts';
import { failure, MemorySession } from './core.ts';
export class MarketClient {
    session = new MemorySession();
    private fetcher: typeof fetch;
    constructor(fetcher: typeof fetch = fetch) { this.fetcher = fetcher; }
    async post<T>(route: string, body: unknown, wallet?: Hex): Promise<T> {
        const token = wallet ? this.session.require(wallet) : undefined;
        const result = await this.fetcher('/api/community-marketplace' + route, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
        if (!result.headers.get('content-type')?.includes('application/json'))
            failure('DEPENDENCY_UNAVAILABLE');
        const data = await result.json();
        if (!result.ok) {
            if (data?.error === 'AUTH_REQUIRED' || data?.error === 'AUTH_INVALID')
                this.session.clear();
            failure(typeof data?.error === 'string' ? data.error : 'DEPENDENCY_UNAVAILABLE');
        }
        return data as T;
    }
    async login(wallet: WalletBridge) {
        const version = this.session.version();
        const account = (await wallet.getContext()).account.toLowerCase() as Hex;
        const challenge = await this.post<{
            challengeId: string;
            message: string;
            expiresAt: number;
        }>('/auth/challenge', { wallet: account });
        if (typeof challenge.message !== 'string' || challenge.message.length > 4096 || typeof challenge.challengeId !== 'string' || !Number.isSafeInteger(challenge.expiresAt) || challenge.expiresAt <= Date.now())
            failure('AUTH_INVALID');
        if ((await wallet.getContext()).account.toLowerCase() !== account || version !== this.session.version())
            failure('ACCOUNT_CHANGED');
        const signature = await wallet.signMessage(challenge.message, account);
        const result = await this.post<{
            token: string;
            wallet: Hex;
            expiresAt: number;
        }>('/auth/login', { challengeId: challenge.challengeId, signature });
        if ((await wallet.getContext()).account.toLowerCase() !== account)
            failure('ACCOUNT_CHANGED');
        this.session.accept(version, result, account);
        return account;
    }
}
