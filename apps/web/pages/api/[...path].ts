import type { NextApiRequest, NextApiResponse } from 'next';
import { createApiHandler } from '../../../../src/features/builder/server/api.mjs';

const handler = createApiHandler();

export const config = { api: { bodyParser: false, externalResolver: true } };

export default function api(request: NextApiRequest, response: NextApiResponse) {
  return handler(request, response);
}
