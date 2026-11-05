export function keepFocus(root, update) {
  const active = root.activeElement;
  const key = active?.dataset?.focusKey;
  const start = active?.selectionStart, end = active?.selectionEnd;
  update();
  if (!key) return;
  const replacement = [...root.querySelectorAll("[data-focus-key]")].find(node => node.dataset.focusKey === key);
  if (!replacement || replacement === active) return;
  replacement.focus({preventScroll: true});
  if (typeof start === "number" && typeof end === "number" && replacement.setSelectionRange) replacement.setSelectionRange(start, end);
}
