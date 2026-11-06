import { createServer } from 'node:http';
import { createApiHandler } from '../server/api.mjs';

// The HTTP test harness exercises the same handler used by Next.js API routes.
export function createDemoServer(options) {
  return createServer(createApiHandler(options));
}
