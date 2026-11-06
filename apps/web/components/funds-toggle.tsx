'use client';
import {useEffect, useState} from 'react';
import {readFundsMode} from '../../../src/features/builder/demo/funds-mode.js';

export function FundsToggle() {
  const [mode, setMode] = useState('DEMO');
  useEffect(() => {
    setMode(readFundsMode());
    const sync = (event: Event) => {
      const next = (event as CustomEvent).detail;
      if (next === 'REAL' || next === 'DEMO') setMode(next);
    };
    window.addEventListener('poros:funds-mode', sync);
    window.dispatchEvent(new Event('poros:request-funds-mode'));
    return () => window.removeEventListener('poros:funds-mode', sync);
  }, []);
  function choose(next: 'DEMO' | 'REAL') {
    try { sessionStorage.setItem('poros.funds-mode', next); } catch {}
    setMode(next);
    window.dispatchEvent(new CustomEvent('poros:set-funds-mode', {detail: next}));
  }
  return <div className="poros-funds-toggle" role="group" aria-label="Trading funds">
    <button type="button" aria-pressed={mode === 'DEMO'} onClick={() => choose('DEMO')} title="Trade with virtual funds">Demo</button>
    <button type="button" aria-pressed={mode === 'REAL'} onClick={() => choose('REAL')} title="Trade real crypto with wallet approval">Real</button>
  </div>;
}
