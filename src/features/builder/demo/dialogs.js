export function dismissOnBackdrop(root=document) {
  const listeners=new AbortController();
  for(const dialog of root.querySelectorAll('dialog')){
    let startedOutside=false;
    const outside=event=>{const r=dialog.getBoundingClientRect();return event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom;};
    dialog.addEventListener('pointerdown',event=>{startedOutside=event.target===dialog&&outside(event);},{signal:listeners.signal});
    dialog.addEventListener('click',event=>{
      if(startedOutside&&event.target===dialog&&outside(event))dialog.close();
      startedOutside=false;
    },{signal:listeners.signal});
  }
  return ()=>listeners.abort();
}
