import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {isIP} from 'node:net';
import {timingSafeEqual} from 'node:crypto';
function configuredOrigin(value){const url=new URL(value);if(url.protocol!=='https:'||url.origin!==value)throw new Error('Configure the exact HTTPS website origin.');return url;}
export function applicationOrigin(request){
 const origin=process.env.MEMBERSHIP_ORIGIN;
 if(origin&&new URL(origin).host===request.headers.host)return origin;
 return `http://${request.headers.host}`;
}
export function allowedApiHost(request){
 return /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host??'')||Boolean(process.env.MEMBERSHIP_ORIGIN&&new URL(process.env.MEMBERSHIP_ORIGIN).host===request.headers.host);
}
function checkedSecret(secret){if(typeof secret!=='string'||secret.length<32)throw new Error('Configure a random POROS_PROXY_SECRET of at least 32 characters.');}
function deny(response,status,message){response.setHeader('Cache-Control','no-store');response.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify({ok:false,error:{message}}));}
export function createBackendGateway({handler,secret,origin}){
 checkedSecret(secret);const website=configuredOrigin(origin),expected=Buffer.from(secret);
 return async(request,response)=>{
  if(request.method==='GET'&&request.url==='/healthz'){response.writeHead(200,{'Content-Type':'application/json'}).end('{"ok":true}');return;}
  const token=Buffer.from(String(request.headers['x-poros-proxy-key']??''));
  if(token.length!==expected.length||!timingSafeEqual(token,expected)||
    (request.headers.origin&&request.headers.origin!==origin)||
    (request.method!=='GET'&&request.headers.origin!==origin)||request.headers['sec-fetch-site']==='cross-site')return deny(response,403,'Open the API through the configured website.');
  if(!request.url?.startsWith('/api/'))return deny(response,404,'Not found.');
  const clientIp=String(request.headers['x-poros-client-ip']??'');
  if(isIP(clientIp))request.porosClientIp=clientIp;
  delete request.headers['x-poros-client-ip'];
  request.headers.host=website.host;
  delete request.headers['x-poros-proxy-key'];
  try{await handler(request,response);}catch{if(!response.headersSent)deny(response,503,'Backend unavailable. Try again shortly.');else response.destroy();}
 };
}
export function createBackendProxy({url,secret}){
 checkedSecret(secret);const target=new URL(url);
 if((target.protocol!=='https:'&&!(target.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(target.hostname)))||target.pathname!=='/'||target.username||target.password||target.search||target.hash)throw new Error('Configure POROS_BACKEND_URL as a canonical HTTPS origin.');
 return (request,response)=>new Promise(resolve=>{
  const path=new URL(request.url,target.origin);if(path.origin!==target.origin||!path.pathname.startsWith('/api/')){deny(response,400,'Invalid API path.');resolve();return;}
  const headers={'x-poros-proxy-key':secret};
  const clientIp=process.env.VERCEL?String(request.headers['x-forwarded-for']??'').split(',')[0].trim():request.socket?.remoteAddress;
  if(isIP(clientIp??''))headers['x-poros-client-ip']=clientIp;
  for(const key of ['content-type','content-length','origin','sec-fetch-site','authorization','accept'])if(request.headers[key]!==undefined)headers[key]=request.headers[key];
  const upstream=(target.protocol==='https:'?httpsRequest:httpRequest)(path,{method:request.method,headers},result=>{
   for(const key of ['content-type','cache-control','retry-after','x-content-type-options'])if(result.headers[key]!==undefined)response.setHeader(key,result.headers[key]);
   response.writeHead(result.statusCode??502);result.pipe(response);result.on('error',()=>response.destroy());
  });
  upstream.setTimeout(180000,()=>upstream.destroy(new Error('Backend timed out')));
  upstream.on('error',()=>{if(!response.headersSent)deny(response,502,'Backend unavailable. Try again shortly.');else response.destroy();resolve();});
  request.on('aborted',()=>upstream.destroy());
  response.once('close',()=>{upstream.destroy();resolve();});response.once('finish',resolve);
  request.pipe(upstream);
 });
}
