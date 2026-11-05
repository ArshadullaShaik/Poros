const ALPHABET='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const CHAIN='solana:mainnet';
export function base58Encode(bytes){
  let value=0n;for(const byte of bytes)value=value*256n+BigInt(byte);
  let result='';while(value){result=ALPHABET[Number(value%58n)]+result;value/=58n;}
  for(const byte of bytes){if(byte!==0)break;result='1'+result;}return result;
}
export function base58Decode(text){
  if(typeof text!=='string'||text.length>2048)throw new Error('Invalid base58 value');
  let value=0n;for(const character of text){const digit=ALPHABET.indexOf(character);if(digit<0)throw new Error('Invalid base58 value');value=value*58n+BigInt(digit);}
  const bytes=[];while(value){bytes.push(Number(value%256n));value/=256n;}
  for(const character of text){if(character!=='1')break;bytes.push(0);}return new Uint8Array(bytes.reverse());
}
function check(signal){signal?.throwIfAborted();}
function equal(a,b){return a instanceof Uint8Array&&b instanceof Uint8Array&&a.length===b.length&&a.every((byte,index)=>byte===b[index]);}
function boundAccount(account,wallet,feature){
  const current=wallet?.accounts?.find(item=>item.address===account?.address);
  if(!current||!current.chains?.includes(CHAIN)||!equal(current.publicKey,account.publicKey)||current.publicKey.length!==32||base58Encode(current.publicKey)!==account.address)throw new Error('Solana wallet account changed; reconnect');
  if(!current.features?.includes(feature)||!wallet.features?.[feature])throw new Error(`Solana wallet does not support ${feature}`);
}
export async function connectSolanaWallet({signal,window:surface=globalThis.window}={}){
  check(signal);if(!surface?.addEventListener)throw new Error('Install a Wallet Standard Solana wallet');
  const wallets=new Set();const api=Object.freeze({register(...items){items.forEach(item=>wallets.add(item));return ()=>items.forEach(item=>wallets.delete(item));}});
  const listener=event=>{if(typeof event.detail==='function')event.detail(api);};
  surface.addEventListener('wallet-standard:register-wallet',listener);
  const event=new Event('wallet-standard:app-ready');Object.defineProperty(event,'detail',{value:api});surface.dispatchEvent(event);
  const wallet=[...wallets].find(item=>item.chains?.includes(CHAIN)&&item.features?.['standard:connect']&&item.features?.['solana:signTransaction']&&item.features?.['solana:signMessage']);
  if(!wallet){surface.removeEventListener('wallet-standard:register-wallet',listener);throw new Error('Install a Wallet Standard Solana wallet supporting transaction and message signing');}
  try{
    const result=await wallet.features['standard:connect'].connect();check(signal);
    const account=result.accounts?.find(item=>item.chains?.includes(CHAIN)&&item.features?.includes('solana:signTransaction')&&item.features?.includes('solana:signMessage'));
    boundAccount(account,wallet,'solana:signMessage');return {wallet,account,address:account.address};
  }finally{surface.removeEventListener('wallet-standard:register-wallet',listener);}
}
function decodeTransaction(text){
  if(typeof text!=='string'||text.length>1644||!text.length||text.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(text))throw new Error('Invalid Solana transaction encoding');
  let bytes;try{bytes=Uint8Array.from(atob(text),char=>char.charCodeAt(0));}catch{throw new Error('Invalid Solana transaction encoding');}
  // Solana wire transactions are at most 1232 bytes; signatures use a compact-u16 count.
  if(bytes.length>1232||bytes.length<66||bytes[0]===0||bytes[0]>18)throw new Error('Invalid Solana transaction size');
  const messageOffset=1+bytes[0]*64;
  if(messageOffset>=bytes.length)throw new Error('Invalid Solana transaction signatures');
  const version=bytes[messageOffset]&128?bytes[messageOffset]&127:'legacy';
  return {bytes,messageOffset,version};
}
export async function signSolanaSetup(txBase64,account,wallet,signal){
  check(signal);boundAccount(account,wallet,'solana:signTransaction');
  const {bytes,messageOffset,version}=decodeTransaction(txBase64);
  const feature=wallet.features['solana:signTransaction'];
  if(!feature.supportedTransactionVersions?.includes(version))throw new Error('Solana wallet does not support this transaction version');
  const expected=bytes.slice(messageOffset);
  const [result]=await feature.signTransaction({account,chain:CHAIN,transaction:bytes});
  check(signal);boundAccount(account,wallet,'solana:signTransaction');
  if(!(result?.signedTransaction instanceof Uint8Array)||result.signedTransaction.length!==bytes.length||result.signedTransaction[0]!==bytes[0]||!equal(result.signedTransaction.slice(messageOffset),expected))throw new Error('Wallet changed the Solana setup transaction');
  return btoa(String.fromCharCode(...result.signedTransaction));
}
export async function signSolanaOrderMessage(request,account,wallet,signal){
  check(signal);boundAccount(account,wallet,'solana:signMessage');
  if(request.funderAddress!==account.address)throw new Error('Solana wallet account changed');
  const unexpired=()=>{if(!Number.isFinite(request.deadlineMs)||Date.now()>=request.deadlineMs)throw new Error('Solana order expired; request a new quote');};
  unexpired();
  if(typeof request.orderMessage!=='string'||!request.orderMessage.length||request.orderMessage.length>1024)throw new Error('Invalid Solana order message');
  const message=new TextEncoder().encode(request.orderMessage);const expected=message.slice();
  const [result]=await wallet.features['solana:signMessage'].signMessage({account,message});
  check(signal);boundAccount(account,wallet,'solana:signMessage');unexpired();
  if(!equal(result?.signedMessage,expected))throw new Error('Wallet changed the Solana order message');
  if(!(result.signature instanceof Uint8Array)||result.signature.length!==64||(result.signatureType&&result.signatureType!=='ed25519'))throw new Error('Invalid Solana order signature');
  return base58Encode(result.signature);
}
