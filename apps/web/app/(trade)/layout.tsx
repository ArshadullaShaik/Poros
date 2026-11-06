import {TradingWorkspace} from '../../components/trading-workspace';
import {headers} from 'next/headers';
import type {ReactNode} from 'react';
import '../../../../src/features/builder/demo/style.css';
import '../../src/theme.css';
import '../../src/trade-layout.css';
export const metadata = {title: 'Poros · Strategy builder', description: 'Discover, build, and share trading strategies with Poros.', icons: {icon: '/images/poros-stag.png'}};
export default async function Layout({children}: {children: ReactNode}) {
  await headers();
  return <html lang="en"><body className="trade-shell"><a className="poros-skip" href="#main">Skip to content</a><TradingWorkspace>{children}</TradingWorkspace></body></html>;
}
