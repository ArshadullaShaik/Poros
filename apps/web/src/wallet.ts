import {stringToHex,type EIP1193Provider,type Hex} from 'viem';
import {sepolia} from 'viem/chains';
import {rabdi} from '../../../src/integrations/arkiv/index.ts';
import type {WalletBridge,Transfer} from './integration.ts';
import {failure,keyPattern,walletPattern} from './core.ts';

interface InjectedProvider {
    request(args:{method:string;params?:unknown[]}):Promise<unknown>;
    on?(event:string,listener:()=>void):void;
    removeListener?(event:string,listener:()=>void):void;
}
declare global {interface Window {ethereum?:InjectedProvider}}

export function createInjectedWallet(provider:InjectedProvider|undefined=typeof window==='undefined'?undefined:window.ethereum):WalletBridge|undefined {
    if(!provider)return undefined;
    const account=async()=>{
        const accounts=await provider.request({method:'eth_accounts'});
        const wallet=Array.isArray(accounts)?accounts[0]:undefined;
        if(typeof wallet!=='string'||!walletPattern.test(wallet.toLowerCase()))failure('ACCOUNT_CHANGED');
        return wallet.toLowerCase() as Hex;
    };
    const requireAccount=async(expected:Hex)=>{if(await account()!==expected.toLowerCase())failure('ACCOUNT_CHANGED');};
    const switchChain=async(chainId:number)=>{
        if(!Number.isSafeInteger(chainId)||chainId<=0)failure('INVALID_INPUT');
        const chainHex=`0x${chainId.toString(16)}`;
        if(BigInt(String(await provider.request({method:'eth_chainId'})))===BigInt(chainId))return;
        try {
            await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:chainHex}]});
        } catch(error) {
            if(!error||typeof error!=='object'||!('code' in error)||error.code!==4902)throw error;
            const chain=chainId===7794095?rabdi({accessKey:''}):chainId===sepolia.id?sepolia:undefined;
            if(!chain)throw error;
            await provider.request({method:'wallet_addEthereumChain',params:[{
                chainId:chainHex,chainName:chain.name,nativeCurrency:chain.nativeCurrency,
                rpcUrls:[...chain.rpcUrls.default.http],blockExplorerUrls:[chain.blockExplorers.default.url],
            }]});
            await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:chainHex}]});
        }
        if(BigInt(String(await provider.request({method:'eth_chainId'})))!==BigInt(chainId))failure('WRONG_CHAIN');
    };
    return {
        async connect(){await provider.request({method:'eth_requestAccounts'});await account();},
        async getContext(){return {account:await account(),provider:provider as EIP1193Provider,requestRabdiSwitch:()=>switchChain(7794095)};},
        async signMessage(message:string,expectedAccount:Hex){await requireAccount(expectedAccount);
            const signature=await provider.request({method:'personal_sign',params:[stringToHex(message),expectedAccount]});
            await requireAccount(expectedAccount);if(typeof signature!=='string'||!/^0x[0-9a-f]{130}$/i.test(signature))failure('INVALID_INPUT');return signature as Hex;},
        async sendTransaction(transaction:Transfer,expectedAccount:Hex){await requireAccount(expectedAccount);
            if(BigInt(String(await provider.request({method:'eth_chainId'})))!==BigInt(transaction.chainId))failure('WRONG_CHAIN');
            if(!walletPattern.test(transaction.to)||!/^0x[0-9a-f]*$/i.test(transaction.data)||!/^0x[0-9a-f]+$/i.test(transaction.value))failure('INVALID_INPUT');
            const hash=await provider.request({method:'eth_sendTransaction',params:[{from:expectedAccount,to:transaction.to,data:transaction.data,value:transaction.value}]});
            if(typeof hash!=='string'||!keyPattern.test(hash))failure('WRITE_STATUS_UNKNOWN');return hash as Hex;},
        switchChain,
        subscribe(listener){for(const event of ['accountsChanged','chainChanged','disconnect'])provider.on?.(event,listener);
            return ()=>{for(const event of ['accountsChanged','chainChanged','disconnect'])provider.removeListener?.(event,listener);};},
    };
}
