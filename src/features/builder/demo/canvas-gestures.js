// Capture on the pressed element so a tap still reaches its original click handler.
function trackDrag(event, {move, finish}) {
  if (!event.isPrimary || event.button !== 0) return;
  const target = event.target, id = event.pointerId;
  const startX = event.clientX, startY = event.clientY;
  let moved = false;
  function update(next) {
    if (next.pointerId !== id) return;
    const dx = next.clientX - startX, dy = next.clientY - startY;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true;
    move(next, dx, dy);
  }
  function end(next) {
    if (next.pointerId !== id) return;
    target.removeEventListener('pointermove', update);
    target.removeEventListener('pointerup', end);
    target.removeEventListener('pointercancel', end);
    target.removeEventListener('lostpointercapture', end);
    document.removeEventListener('keydown', escape);
    if (target.hasPointerCapture(id)) target.releasePointerCapture(id);
    if (moved) {
      // Browsers synthesize click after pointerup, including after a captured drag.
      const swallow = click => { click.preventDefault(); click.stopImmediatePropagation(); };
      target.addEventListener('click', swallow, {capture:true, once:true});
      setTimeout(() => target.removeEventListener('click', swallow, true), 0);
      finish(next, next.type === 'pointerup');
    }
  }
  function escape(key) {
    if (key.key === 'Escape') end({pointerId:id, type:'cancel'});
  }
  target.setPointerCapture(id);
  target.addEventListener('pointermove', update);
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
  target.addEventListener('lostpointercapture', end);
  document.addEventListener('keydown', escape);
}

export function mountGraphGestures(canvas, {positions, moveNode, addBlock}) {
  const world = canvas.querySelector('.canvas-world');
  const zoomLabel = document.querySelector('#zoom-level');
  const zoomOut = document.querySelector('#zoom-out'), zoomIn = document.querySelector('#zoom-in');
  let scale = 1, panX = 0, panY = 0, autoFit = true;
  function paint() {
    world.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    canvas.style.backgroundSize = `${24 * scale}px ${24 * scale}px`;
    canvas.style.backgroundPosition = `${panX}px ${panY}px`;
    zoomLabel.value = `${Math.round(scale * 100)}%`;
    zoomOut.disabled = scale <= 0.2;
    zoomIn.disabled = scale >= 2;
  }
  function point(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {x:(clientX - rect.left - panX) / scale, y:(clientY - rect.top - panY) / scale};
  }
  function zoom(factor, x = canvas.clientWidth / 2, y = canvas.clientHeight / 2) {
    const next = Math.max(0.2, Math.min(2, scale * factor));
    panX = x - (x - panX) * next / scale;
    panY = y - (y - panY) * next / scale;
    scale = next;
    autoFit = false;
    paint();
  }
  function fit() {
    autoFit = true;
    if (!canvas.clientWidth || !canvas.clientHeight) return;
    const nodes = [...world.querySelectorAll('.node')];
    if (!nodes.length) { scale = 1; panX = panY = 0; paint(); return; }
    const left = Math.min(...nodes.map(n => n.offsetLeft)) - 16;
    const top = Math.min(...nodes.map(n => n.offsetTop)) - 24;
    const width = Math.max(...nodes.map(n => n.offsetLeft + n.offsetWidth)) + 16 - left;
    const height = Math.max(...nodes.map(n => n.offsetTop + n.offsetHeight)) + 12 - top;
    const availableHeight = Math.max(30, canvas.clientHeight - 53);
    scale = Math.min(1, Math.max(30, canvas.clientWidth - 20) / width, availableHeight / height);
    panX = (canvas.clientWidth - width * scale) / 2 - left * scale;
    panY = (availableHeight - height * scale) / 2 - top * scale + 8;
    paint();
  }
  function reveal(card) {
    if (!card) return;
    const bounds = canvas.getBoundingClientRect(), rect = card.getBoundingClientRect();
    const dx = rect.left < bounds.left ? bounds.left + 12 - rect.left : Math.min(0, bounds.right - 12 - rect.right);
    const dy = rect.top < bounds.top ? bounds.top + 24 - rect.top : Math.min(0, bounds.bottom - 44 - rect.bottom);
    if (dx || dy) { panX += dx; panY += dy; autoFit = false; paint(); }
  }
  canvas.addEventListener('wheel', event => {
    if (event.metaKey || event.altKey || !event.deltaY) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
    zoom(Math.exp(-Math.max(-150, Math.min(150, delta)) * 0.002), event.clientX - rect.left, event.clientY - rect.top);
  }, {passive:false});
  zoomOut.addEventListener('click', () => zoom(1 / 1.25));
  zoomIn.addEventListener('click', () => zoom(1.25));
  document.querySelector('#zoom-fit').addEventListener('click', fit);
  canvas.addEventListener('focusin', event => reveal(event.target.closest('.node')));
  canvas.addEventListener('keydown', event => {
    if (event.target !== canvas) return;
    const shift = {ArrowLeft:[48,0], ArrowRight:[-48,0], ArrowUp:[0,48], ArrowDown:[0,-48]}[event.key];
    if (!shift) return;
    event.preventDefault();
    panX += shift[0]; panY += shift[1]; autoFit = false; paint();
  });
  canvas.addEventListener('pointerdown', event => {
    if (event.target.closest('.port, .node-remove')) return;
    const card = event.target.closest('.node');
    const start = card ? positions().get(card.dataset.id) : {x:panX, y:panY};
    trackDrag(event, {
      move(_, dx, dy) {
        autoFit = false;
        (card || canvas).classList.add('is-dragging');
        if (card) moveNode(card.dataset.id, start.x + dx / scale, start.y + dy / scale);
        else { panX = start.x + dx; panY = start.y + dy; paint(); }
      },
      finish(_, commit) {
        (card || canvas).classList.remove('is-dragging');
        if (commit) return;
        if (card) moveNode(card.dataset.id, start.x, start.y);
        else { panX = start.x; panY = start.y; paint(); }
      },
    });
  });
  for (const button of document.querySelectorAll('.palette-block')) {
    button.draggable = false;
    button.addEventListener('pointerdown', event => {
      const rect = button.getBoundingClientRect();
      const anchorX = event.clientX - rect.left, anchorY = event.clientY - rect.top;
      let preview;
      const overCanvas = next => canvas.contains(document.elementFromPoint(next.clientX, next.clientY));
      trackDrag(event, {
        move(next) {
          if (!preview) {
            preview = button.cloneNode(true);
            preview.inert = true;
            preview.setAttribute('aria-hidden','true');
            preview.classList.add('palette-preview');
            Object.assign(preview.style, {width:`${rect.width}px`, height:`${rect.height}px`});
            button.closest('.trade-page').append(preview);
          }
          preview.style.transform = `translate(${next.clientX - anchorX}px, ${next.clientY - anchorY}px)`;
          canvas.classList.toggle('drag-over', overCanvas(next));
        },
        finish(next, commit) {
          preview?.remove();
          canvas.classList.remove('drag-over');
          if (!commit || !overCanvas(next)) return;
          const at = point(next.clientX, next.clientY);
          addBlock(button.dataset.kind, {x:at.x - anchorX / rect.width * 210, y:at.y - anchorY / rect.height * 46});
        },
      });
    });
  }
  new ResizeObserver(() => { if (autoFit) fit(); }).observe(canvas);
  return {point, fit, reveal};
}
