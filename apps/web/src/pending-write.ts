import { errorCode, failure } from './core.ts';

export type WriteCheckState = 'checking' | 'waiting' | 'retrying' | 'review' | 'verified';

export function createPendingWriteChecker(
    check: () => Promise<boolean>,
    update: (request: string, state: WriteCheckState) => void,
    now = Date.now,
) {
    let active = false;
    let request = '';
    let attempts = 0;
    let nextCheck = 0;
    return async (current?: string) => {
        if (!current || active) return;
        if (current !== request) {
            request = current;
            attempts = 0;
            nextCheck = 0;
        }
        if (now() < nextCheck) return;
        active = true;
        update(current, 'checking');
        try {
            if (await check()) {
                nextCheck = Infinity;
                update(current, 'verified');
                return;
            }
            update(current, 'waiting');
        } catch (error) {
            if (['INTEGRITY_FAILED', 'DUPLICATE_REQUEST', 'INVALID_INPUT'].includes(errorCode(error))) {
                nextCheck = Infinity;
                update(current, 'review');
                return;
            }
            update(current, 'retrying');
        } finally {
            active = false;
            if (nextCheck !== Infinity) {
                nextCheck = now() + Math.min(60000, 5000 * 2 ** Math.min(attempts++, 4));
            }
        }
    };
}

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
