/** @param {{querySelector: (selector:string) => any}} root */
export function mountCanvasLayout(root = document) {
  const workspace = root.querySelector('.workspace');
  const cleanups = [];
  for (const [side, panelId, label] of [['left', 'canvas-blocks-panel', 'blocks'], ['right', 'canvas-library-panel', 'library']]) {
    const button = root.querySelector(`#canvas-toggle-${side}`), panel = root.querySelector(`#${panelId}`);
    if (!workspace || !button || !panel) continue;
    const toggle = () => {
      panel.hidden = !panel.hidden;
      workspace.dataset[`${side}Hidden`] = String(panel.hidden);
      button.setAttribute('aria-expanded', String(!panel.hidden));
      button.textContent = `${panel.hidden ? 'Show' : 'Hide'} ${label} ${side === 'left' ? (panel.hidden ? '→' : '←') : (panel.hidden ? '←' : '→')}`;
    };
    button.addEventListener('click', toggle);
    cleanups.push(() => button.removeEventListener('click', toggle));
  }
  return () => cleanups.forEach(cleanup => cleanup());
}
