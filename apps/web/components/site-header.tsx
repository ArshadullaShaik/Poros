import {mark} from '../src/icons';
const links = [['/home', 'Home'], ['/', 'Trade'], ['/community', 'Communities'], ['/profile', 'Profile'], ['/0g-pot', '0G Pot']] as const;
export function SiteHeader({section}: {section: string}) {
  return <header className="poros-header">
    <a className="poros-brand" href="/home" aria-label="Poros Home"><span dangerouslySetInnerHTML={{__html: mark}}/><span>Poros</span></a>
    <nav className="poros-nav" aria-label="Main navigation">{links.map(([href, label]) => <a key={href} href={href} data-workspace={href === '/0g-pot' ? 'pot' : href.slice(1)} aria-current={section === href ? 'page' : undefined}>{label}</a>)}</nav>
    <button id="wallet-connect" className="poros-wallet" type="button" data-action="connect"><span id="wallet-label">Connect wallet</span></button>
  </header>;
}
