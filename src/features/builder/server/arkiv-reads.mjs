// shortcut: coordination is per server process; use a shared queue/cache when deploying multiple replicas.
export function createArkivReads({now = Date.now} = {}) {
  const pending = new Map();
  const queue = [];
  let active = 0, cooldownUntil = 0, chain;
  function limited(seconds = 1) {
    const retryAfter = Math.max(1, Math.ceil(seconds));
    return {status:429,retryAfter,payload:{jsonrpc:'2.0',error:{code:429,message:'Arkiv is rate limited. Please retry after the cooldown.'}}};
  }
  function acquire(signal) {
    if (signal.aborted) return Promise.reject(signal.reason);
    if (active < 4) { active++; return Promise.resolve(); }
    if (queue.length >= 32) return Promise.reject(new Error('Arkiv read queue is full'));
    return new Promise((resolve,reject) => {
      const item = {resolve:() => {signal.removeEventListener('abort',abort);resolve();}};
      const abort = () => {const index=queue.indexOf(item);if(index>=0)queue.splice(index,1);reject(signal.reason);};
      queue.push(item);signal.addEventListener('abort',abort,{once:true});
    });
  }
  function release() {const next=queue.shift();if(next)next.resolve();else active--;}
  return async (body, load, signal) => {
    const key = JSON.stringify([body.method,body.params]);
    if (body.method === 'eth_chainId' && chain && now() < chain.until) return chain.value;
    const existing = pending.get(key);
    if (existing) return existing;
    if (now() < cooldownUntil) return limited((cooldownUntil-now())/1000);
    const job = (async () => {
      await acquire(signal);
      try {
        if (signal.aborted) throw signal.reason;
        if (now() < cooldownUntil) return limited((cooldownUntil-now())/1000);
        const result = await load();
        if (result.status === 429) {
          const delay = Math.min(3600,Math.max(1,result.retryAfter ?? 10));
          cooldownUntil = Math.max(cooldownUntil,now()+delay*1000);
          return {...result,retryAfter:Math.ceil(delay)};
        }
        if (body.method === 'eth_chainId' && result.status === 200 && !result.payload.error)
          chain = {until:now()+60000,value:result};
        return result;
      } finally {release();}
    })().finally(() => {pending.delete(key);});
    pending.set(key,job);
    return job;
  };
}
