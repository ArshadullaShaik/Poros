import {NextResponse, type NextRequest} from 'next/server';

export function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID();
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
    "connect-src 'self' https://rpc.rabdi.db-chain.testnet.arkiv.network",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');
  const headers = new Headers(request.headers);
  headers.set('Content-Security-Policy', policy);
  const response = NextResponse.next({request: {headers}});
  response.headers.set('Content-Security-Policy', policy);
  return response;
}
export const config = {matcher: ['/((?!api|_next/static|_next/image|favicon.svg).*)']};
