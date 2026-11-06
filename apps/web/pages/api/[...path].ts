import type { NextApiRequest, NextApiResponse } from 'next';
import {createBackendProxy} from '../../../../src/features/builder/server/deployment.mjs';
const remote=process.env.POROS_BACKEND_URL?createBackendProxy({url:process.env.POROS_BACKEND_URL,secret:process.env.POROS_PROXY_SECRET}):undefined;
let localHandler:ReturnType<typeof import('../../../../src/features/builder/server/api.mjs')['createApiHandler']>|undefined;
export const config = { maxDuration: 300, api: { bodyParser: false, externalResolver: true } };
export default async function api(request: NextApiRequest, response: NextApiResponse) {
  if(remote)return remote(request,response);
  if(process.env.VERCEL){response.status(503).json({ok:false,error:{message:'Configure the persistent Poros backend before using this deployment.'}});return;}
  localHandler??=(await import('../../../../src/features/builder/server/api.mjs')).createApiHandler();
  return localHandler(request,response);
}
