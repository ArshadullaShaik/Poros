// Keep decisions in memory only; neither credentials nor public drafts enter a persistent cache.
export function createCommunityModeration(fetcher=fetch) {
  const decisions=new Map<string,boolean>();
  let queue:Promise<unknown>=Promise.resolve();
  return (text:string):Promise<boolean> => {
    const work=queue.then(async()=>{
      const cached=decisions.get(text);if(cached!==undefined)return cached;
      const apiKey=localStorage.getItem('poros.0g-inference-key');
      if(!apiKey)throw Object.assign(new Error('Moderation unavailable'),{code:'MODERATION_UNAVAILABLE'});
      const response=await fetcher('/api/community-moderation',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},body:JSON.stringify({text}),signal:AbortSignal.timeout(45000)});
      const result=await response.json();
      if(!response.ok||result?.ok!==true||typeof result.data?.allowed!=='boolean')throw Object.assign(new Error('Moderation unavailable'),{code:'MODERATION_UNAVAILABLE'});
      if(decisions.size>=500)decisions.delete(decisions.keys().next().value!);
      decisions.set(text,result.data.allowed);return result.data.allowed;
    });
    const checked=work.catch(()=>{throw Object.assign(new Error('Moderation unavailable'),{code:'MODERATION_UNAVAILABLE'});});
    queue=checked.catch(()=>{});return checked;
  };
}
