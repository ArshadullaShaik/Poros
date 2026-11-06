'use client';
import {useEffect, useState, type ReactNode} from 'react';
import {usePathname} from 'next/navigation';
import {SiteHeader} from './site-header';
import {Runtime} from './runtime';
import {tradeMarkup} from './trade-markup';

export function TradingWorkspace({children}: {children: ReactNode}) {
  const pathname = usePathname() ?? '/';
  const [visitedTrade, setVisitedTrade] = useState(pathname === '/');
  useEffect(() => { if (pathname === '/') setVisitedTrade(true); }, [pathname]);
  useEffect(() => {
    const skip = document.querySelector('.poros-skip');
    const focusContent = (event: Event) => {event.preventDefault();document.querySelector<HTMLElement>('#main')?.focus();};
    skip?.addEventListener('click', focusContent);
    return () => skip?.removeEventListener('click', focusContent);
  }, []);
  return <>
    <SiteHeader section={pathname}/>
    <div id="main" tabIndex={-1}>
      {(visitedTrade || pathname === '/') && <div className="trade-page" hidden={pathname !== '/'}>
        <div dangerouslySetInnerHTML={{__html: tradeMarkup}}/>
        <Runtime trade/>
      </div>}
      {children}
    </div>
  </>;
}
