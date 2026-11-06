import {validatePriceStrategy} from '../market/config.ts';

const key = 'poros.canvas.v1';
function decode(raw) {
  if (!raw || raw.length > 131072) return;
  const state = JSON.parse(raw);
  if (!state || typeof state.dirty !== 'boolean' || !Array.isArray(state.positions) || state.positions.length > 32 ||
      (state.selected !== undefined && typeof state.selected !== 'string') ||
      (state.forkSource !== undefined && (typeof state.forkSource !== 'string' || state.forkSource.length > 128))) return;
  const draft = state.draft;
  const result = validatePriceStrategy(draft);
  // Incomplete graphs are drafts; malformed data must never reach the renderer.
  if (!result.valid && result.issues.some(issue =>
    !['INVALID_EXECUTION_PATH', 'INVALID_CONNECTION', 'INVALID_RANGE', 'RISK_CAP_EXCEEDED'].includes(issue.code) &&
    !(issue.code === 'INVALID_ARRAY' && issue.path === '$.nodes' && Array.isArray(draft.nodes) && draft.nodes.length === 0) &&
    !(issue.code === 'INVALID_STRING' && issue.path === '$.name' && typeof draft.name === 'string'))) return;
  if (draft.nodes.some(node => !['signal.price', 'guard.risk', 'action.intent'].includes(node.type)) ||
      draft.edges.some(edge => !draft.nodes.some(node => node.id === edge.source) || !draft.nodes.some(node => node.id === edge.target))) return;
  if (state.positions.some(entry => !Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' ||
      !entry[1] || !Number.isFinite(entry[1].x) || !Number.isFinite(entry[1].y) ||
      entry[1].x < 0 || entry[1].x > 100000 || entry[1].y < 0 || entry[1].y > 100000)) return;
  return state;
}

/** @param {{localStorage: Pick<Storage, 'getItem'>}} host */
export function readCanvas(host = window) {
  try { return decode(host.localStorage.getItem(key)); } catch { return; }
}

/** @param {any} state @param {{localStorage: Pick<Storage, 'getItem' | 'setItem'>}} host */
export function saveCanvas(state, host = window) {
  try {
    const raw = JSON.stringify(state);
    if (!decode(raw)) return false;
    host.localStorage.setItem(key, raw);
    return true;
  } catch { return false; }
}
