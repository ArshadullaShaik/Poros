import {fileURLToPath} from 'node:url';
export default {
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  experimental: {externalDir: true},
  poweredByHeader: false,
  async headers() {
    return [{source: '/:path*', headers: [
      {key: 'X-Content-Type-Options', value: 'nosniff'},
      {key: 'X-Frame-Options', value: 'DENY'},
      {key: 'Referrer-Policy', value: 'same-origin'},
    ]}];
  },
};
