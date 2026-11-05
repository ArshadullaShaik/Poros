export interface PaperRun {id:string;pair:string;realizedPnl:number;fills:number;updatedAt:number}
function key(wallet:string){
    if(!/^0x[0-9a-f]{40}$/i.test(wallet))throw new Error('Invalid wallet');
    return 'poros.paper-performance.v1.'+wallet.toLowerCase();
}
function valid(run:PaperRun){
    return run && typeof run.id==='string' && run.id.length>0 && run.id.length<=128 &&
        typeof run.pair==='string' && run.pair.length<=80 && Number.isFinite(run.realizedPnl) &&
        Number.isSafeInteger(run.fills) && run.fills>=0 && Number.isSafeInteger(run.updatedAt) && run.updatedAt>=0;
}
export function readPaperRuns(storage:Pick<Storage,'getItem'>,wallet:string):PaperRun[]{
    const raw=storage.getItem(key(wallet));if(!raw)return [];
    if(raw.length>50000)throw new Error('Saved performance is too large');
    const rows:unknown=JSON.parse(raw);
    if(!Array.isArray(rows)||rows.length>100||!rows.every(valid))throw new Error('Saved performance is invalid');
    return rows;
}
export function savePaperRun(storage:Pick<Storage,'getItem'|'setItem'>,wallet:string,run:PaperRun){
    if(!valid(run))throw new Error('Invalid paper result');
    const saved=readPaperRuns(storage,wallet);
    if(saved.some(row=>row.id===run.id && row.updatedAt>run.updatedAt))return;
    const rows=saved.filter(row=>row.id!==run.id);
    rows.push(run);rows.sort((a,b)=>b.updatedAt-a.updatedAt);
    storage.setItem(key(wallet),JSON.stringify(rows.slice(0,100)));
}
