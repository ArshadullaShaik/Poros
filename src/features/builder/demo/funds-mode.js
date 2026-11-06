const key = 'poros.funds-mode';
/** @param {{sessionStorage: Pick<Storage, 'getItem'>}} host */
export function readFundsMode(host = window) {
  try { return host.sessionStorage.getItem(key) === 'REAL' ? 'REAL' : 'DEMO'; }
  catch { return 'DEMO'; }
}

/** @param {HTMLSelectElement | (EventTarget & {value:string})} control
 * @param {EventTarget & {sessionStorage: Pick<Storage, 'getItem' | 'setItem'>}} host */
export function mountFundsMode(control, host = window) {
  const publish = () => {
    const mode = control.value === 'LIVE' ? 'REAL' : 'DEMO';
    try { host.sessionStorage.setItem(key, mode); } catch {}
    host.dispatchEvent(new CustomEvent('poros:funds-mode', {detail: mode}));
  };
  const change = event => {
    if (!['REAL', 'DEMO'].includes(event.detail)) return;
    const next = event.detail === 'REAL' ? 'LIVE' : control.value === 'RULES_ONLY' ? 'RULES_ONLY' : 'AI';
    if (control.value !== next) {
      control.value = next;
      control.dispatchEvent(new Event('change', {bubbles: true}));
    }
    publish();
  };
  const initial = readFundsMode(host);
  control.addEventListener('change', publish);
  host.addEventListener('poros:set-funds-mode', change);
  host.addEventListener('poros:request-funds-mode', publish);
  change({detail: initial});
  return () => {
    control.removeEventListener('change', publish);
    host.removeEventListener('poros:set-funds-mode', change);
    host.removeEventListener('poros:request-funds-mode', publish);
  };
}
