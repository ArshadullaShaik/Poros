// Use one same-origin reference for both whole cards and their nested links.
export function publicStrategyDrag(event:DragEvent,origin:string) {
  const source=(event.target as Element|null)?.closest<HTMLElement>('[data-strategy-href], a.strategy-transfer');
  if(!source||!event.dataTransfer)return;
  const href=source.dataset.strategyHref??source.getAttribute('href');
  if(!href)return;
  const url=new URL(href,origin);
  if(url.origin!==origin||url.pathname!=='/')return;
  event.dataTransfer.setData('text/plain',url.href);
  event.dataTransfer.setData('text/uri-list',url.href);
  event.dataTransfer.effectAllowed='copy';
}
