import {privateKeyToAccount} from 'viem/accounts';
import {address} from './codec.ts';
import {createTradeRepository} from './trades.ts';
import type {Hex} from 'viem';
export function serverTradeRepository(key:string,trusted:string,accessKey:string){
 if(!/^0x[0-9a-fA-F]{64}$/.test(key))throw new Error('Invalid Arkiv writer configuration');
 const signer=privateKeyToAccount(key as Hex);if(address(signer.address)!==address(trusted))throw new Error('Configured writer identity does not match signer');
 return createTradeRepository({accessKey,trustedWriter:address(trusted),signer});
}
