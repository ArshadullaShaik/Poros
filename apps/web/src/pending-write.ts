import { failure } from './core.ts';
// Call under withWalletLock so another tab cannot replace the request during recovery.
export function archiveUnsubmittedWrite(storage: Pick<Storage,'getItem'|'setItem'|'removeItem'>,
    snapshot: {account:string;requestId:string}, account:string, confirmed:boolean) {
    if(!confirmed)failure('INVALID_INPUT');
    if(account!==snapshot.account)failure('ACCOUNT_CHANGED');
    const key='common-ground.pending-write';
    const raw=storage.getItem(key);
    const pending=raw?JSON.parse(raw):undefined;
    if(!pending || pending.account!==account || pending.requestId!==snapshot.requestId)failure('INTENT_CONFLICT');
    if(pending.txHash || pending.entityKey)failure('WRITE_STATUS_UNKNOWN');
    storage.setItem(key+'.archive.'+pending.requestId,JSON.stringify({request:pending,archivedAt:Date.now(),reason:'user-confirmed-no-transaction'}));
    storage.removeItem(key);
}
