import Link from 'next/link';
import {icon, mark} from '../src/icons';
import {FundsToggle} from './funds-toggle';
const links = [['/home', 'Home'], ['/', 'Trade'], ['/orders', 'Orders'], ['/community', 'Communities'], ['/profile', 'Profile'], ['/0g-pot', '0G Pot']] as const;
export function SiteHeader({section}: {section: string}) {
  return <header className="poros-header">
    <a className="poros-brand" href="/home" aria-label="Poros Home"><span dangerouslySetInnerHTML={{__html: mark}}/><span>Poros</span></a>
    <nav className="poros-nav" aria-label="Main navigation">{links.map(([href, label]) => href === '/' || href === '/orders'
      ? <Link key={href} href={href} aria-current={section === href ? 'page' : undefined}>{label}</Link>
      : <a key={href} href={href} data-workspace={href === '/0g-pot' ? 'pot' : href.slice(1)} aria-current={section === href ? 'page' : undefined}>{label}</a>)}</nav>
    <div className="poros-header-actions"><FundsToggle/><button hidden={section === '/orders'} id="wallet-connect" className="poros-wallet" type="button" data-action="connect"><span className="wallet-symbol" aria-hidden="true" dangerouslySetInnerHTML={{__html: icon('wallet')}}/><span id="wallet-label">Connect wallet</span></button></div>
  </header>;
}
