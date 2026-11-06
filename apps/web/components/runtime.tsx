'use client';
import {useEffect, useState} from 'react';

// The trading layout retains this controller across Trade and Orders.
// Module imports initialize once per document, including React Strict Mode replay.
export function Runtime({trade = false}: {trade?: boolean}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    const skip = trade ? null : document.querySelector<HTMLAnchorElement>('.poros-skip');
    const focusContent = (event: MouseEvent) => {
      event.preventDefault();
      document.querySelector<HTMLElement>('#main')?.focus();
    };
    skip?.addEventListener('click', focusContent);
    const runtime = trade ? import('../../../src/features/builder/demo/app.js') : import('../src/main.ts');
    void runtime.catch(() => { if (active) setFailed(true); });
    return () => { active = false; skip?.removeEventListener('click', focusContent); };
  }, [trade]);
  return failed ? <p role="alert">Poros could not start. Reload this page to try again.</p> : null;
}
