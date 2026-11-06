import {headers} from 'next/headers';
import type {ReactNode} from 'react';
import '../../src/style.css';
import '../../src/theme.css';
export const metadata = {title: 'Poros · Community', description: 'Discover, build, and share trading strategies with Poros.', icons: {icon: '/favicon.svg'}};
export default async function Layout({children}: {children: ReactNode}) {
  await headers();
  return <html lang="en"><body><a className="poros-skip" href="#main">Skip to content</a>{children}</body></html>;
}
