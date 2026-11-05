import type { Hex } from 'viem';
import { createArkivStore, type StoreOptions, type Json, type WalletContext } from '../../../src/integrations/arkiv/index.ts';
import { createArkivEventRepository, createCommunityHub, type Currency } from '../../../src/integrations/arkiv/community/index.ts';
export interface Transfer {
    chainId: number;
    to: Hex;
    data: Hex;
    value: Hex;
}
export interface WalletBridge {
    connect(): Promise<void>;
    getContext(): Promise<WalletContext>;
    signMessage(message: string, expectedAccount: Hex): Promise<Hex>;
    sendTransaction(transaction: Transfer, expectedAccount: Hex): Promise<Hex>;
    switchChain?(chainId: number): Promise<void>;
    subscribe(listener: () => void): () => void;
}
export interface AppIntegration {
    wallet?: WalletBridge;
    accessKey?: string;
    validateStrategyDocument?: StoreOptions['validateStrategyDocument'];
    validatePrivateStrategy?: (input: unknown) => Json;
    payment?: {
        currency: Currency;
        symbol: string;
        networkName: string;
    };
    marketplaceReady?: boolean;
}
declare global {
    interface Window {
        __COMMON_GROUND__?: AppIntegration;
    }
}
export function compose(integration: AppIntegration) {
    const options: StoreOptions = { accessKey: integration.accessKey, validateStrategyDocument: integration.validateStrategyDocument,
        ...(integration.wallet ? { getWalletContext: () => integration.wallet!.getContext() } : {}) };
    const strategies = createArkivStore(options);
    const events = createArkivEventRepository(options);
    return { strategies, events, community: createCommunityHub({ events, strategies }) };
}
