export function mountCommunityLibrary({root=document,loadApi=()=>import('../../../../apps/web/src/builder.ts'),onLoad,onText,onLoading=()=>{}}){
  const $=id=>root.querySelector(`#${id}`);
  let cursor=null,busy=false,community;
  const key=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);
  const text=(tag,value)=>{const node=root.createElement(tag);node.textContent=value;return node;};
  async function load(versionKey){
    if(!key(versionKey))return false;
    onLoading(true);
    try{const {publicStrategies}=await loadApi();const version=await publicStrategies.getVersion({versionKey});await onLoad(version.document.graph,version.versionKey);$('community-strategies-status').textContent='Community strategy loaded. Review its rules before Run.';return true;}
    catch(error){$('community-strategies-status').textContent=error.message??'Could not load this community strategy.';return false;}
    finally{onLoading(false);}
  }
  async function loadPost(communityKey,postKey){
    if(!key(communityKey)||!key(postKey))return false;
    onLoading(true);
    try{const api=await loadApi();const entry=await api.readPublicPost(communityKey,postKey);return await onText(entry);}
    catch(error){$('community-strategies-status').textContent=error.message??'Could not load this community post.';return false;}
    finally{onLoading(false);}
  }
  async function refresh(append=false){
    if(busy)return;busy=true;$('refresh-community-strategies').disabled=true;$('more-community-strategies').disabled=true;
    $('community-strategies-status').textContent=community?'Loading community strategies…':'Loading communities…';
    try{
      const {publicStrategies,publicLists=publicStrategies,listCommunityStrategies}=await loadApi(),pageInput={offset:append?cursor:0,limit:20};
      const page=community?await (listCommunityStrategies??publicStrategies.listStrategies)({communityKey:community.communityKey,page:pageInput}):await publicLists.listCommunities({page:pageInput});
      if(!Array.isArray(page.items)||page.items.length>20||page.items.some(row=>!key(community?(row.rootVersionKey??row.postKey):row.communityKey)||typeof row.name!=='string'||row.name.length>128||community&&row.communityKey!==community.communityKey))throw new Error('Invalid community response.');
      if(!append)$('community-strategies').replaceChildren();
      for(const row of page.items){
        const card=text('button','');card.type='button';card.className='unlocked-card';card.draggable=!!community;
        card.append(text('strong',row.name),text('small',community?(row.postKey?'Written post · drag or click to interpret (0G key and cost)':'Public strategy · drag or click to load'):row.description||'View community strategies'));
        if(community){
          card.addEventListener('click',()=>row.postKey?loadPost(row.communityKey,row.postKey):load(row.rootVersionKey));
          card.addEventListener('dragstart',event=>{event.dataTransfer.setData('text/plain',JSON.stringify(row.postKey?{kind:'public-post',communityKey:row.communityKey,postKey:row.postKey}:{kind:'public-strategy',versionKey:row.rootVersionKey}));event.dataTransfer.effectAllowed='copy';});
        }else card.addEventListener('click',()=>{if(busy)return;community=row;return refresh();});
        $('community-strategies').append(card);
      }
      cursor=Number.isSafeInteger(page.nextOffset)&&page.nextOffset>=(append?cursor:0)+page.items.length?page.nextOffset:null;
      $('more-community-strategies').hidden=cursor===null;
      $('back-to-communities').hidden=!community;
      $('community-library-title').textContent=community?.name??'Communities';
      $('community-page-link').href=community?`/community#/community/${community.communityKey}`:'/community#/communities';
      $('community-strategies-status').textContent=page.items.length?(community?'Strategies in this community.':'Communities from the community page.'):(community?'No public strategies in this community.':'No communities found.');
    }catch(error){$('community-strategies-status').textContent=error.message??'Community data is unavailable.';}
    finally{busy=false;$('refresh-community-strategies').disabled=false;$('more-community-strategies').disabled=cursor===null;}
  }
  $('refresh-community-strategies').addEventListener('click',()=>refresh());
  $('more-community-strategies').addEventListener('click',()=>refresh(true));
  $('back-to-communities').addEventListener('click',()=>{if(busy)return;community=undefined;void refresh();});
  return {refresh,load,loadPost};
}

export function mountLibraryTabs({root=document,onCommunity,onSelect}){
  const tabs=[...root.querySelectorAll('[data-library-tab]')];
  function select(tab){
    for(const item of tabs){
      const active=item===tab;
      item.setAttribute('aria-selected',String(active));item.tabIndex=active?0:-1;
      root.querySelector(`#library-${item.dataset.libraryTab}`).hidden=!active;
    }
    if(tab.dataset.libraryTab==='community')void onCommunity();
    void onSelect?.(tab.dataset.libraryTab);
  }
  tabs.forEach((tab,index)=>{
    tab.addEventListener('click',()=>select(tab));
    tab.addEventListener('keydown',event=>{
      let next;
      if(event.key==='ArrowRight')next=(index+1)%tabs.length;
      else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;
      else if(event.key==='Home')next=0;
      else if(event.key==='End')next=tabs.length-1;
      else return;
      event.preventDefault();select(tabs[next]);tabs[next].focus();
    });
  });
  select(tabs[0]);
}

export function mountMemberLibrary({root=document,loadApi=()=>import('../../../../apps/web/src/builder.ts'),onEntries,onCreators,onReset=()=>{}}){
  const $=id=>root.querySelector(`#${id}`);
  let generation=0,expiryTimer,unsubscribe,stopped=false;
  const status=message=>{for(const id of ['unlocked-status','creators-status'])$(id).textContent=message;};
  function lock(message='Private library locked. Refresh to verify memberships.'){
    generation++;clearTimeout(expiryTimer);onEntries([]);onCreators([]);status(message);onReset();
  }
  async function refresh(){
    const current=++generation;clearTimeout(expiryTimer);onEntries([]);onCreators([]);
    status('Verifying wallet memberships…');
    try{
      const api=await loadApi();
      const result=await api.readPersonalLibrary();
      if(current!==generation)return;
      onCreators(result.creators);onEntries(result.entries);
      $('unlocked-status').textContent=result.entries.length?'Drag an unlocked creator strategy onto the canvas.':'No messages for your active memberships yet.';
      $('creators-status').textContent=result.creators.length?'Creators with verified active paid memberships.':'No active paid creator memberships.';
      if(result.creators.length)expiryTimer=setTimeout(()=>lock('Membership expired. Refresh to verify access.'),Math.max(0,Math.min(2147483647,Math.min(...result.creators.map(row=>row.expiresAt))-Date.now())));
    }catch(error){
      if(current===generation){
        const msg=error?.message==='ACCOUNT_CHANGED'||error?.code==='ACCOUNT_CHANGED'
          ?'Wallet changed. Reconnect to view subscriptions.'
          :(error?.message??'Could not verify your community library.');
        status(msg);
      }
    }
  }
  $('lock-library').addEventListener('click',()=>lock());
  for(const id of ['refresh-member-library','refresh-creator-library'])$(id).addEventListener('click',()=>refresh());
  void loadApi().then(api=>{if(stopped)return;unsubscribe=api.subscribeLibraryWallet(()=>lock('Wallet changed. Refresh to load this account’s library.'));}).catch(()=>{});
  return {refresh,stop(){stopped=true;lock();unsubscribe?.();}};
}
