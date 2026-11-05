import type { EncryptionIdentity, KeyBox, SignalContent } from '../../../src/integrations/arkiv/community/memberships.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const subtle = () => globalThis.crypto.subtle;
function failure(message = 'Unable to decrypt. Check the wallet and recovery code.'): never {
  throw Object.assign(new Error(message), { code: 'CRYPTO_FAILED' });
}
export function encode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export function decode(value: string, length?: number): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 16000) failure();
  let binary: string;
  try { binary = atob(value.replaceAll('-', '+').replaceAll('_', '/')); } catch { return failure(); }
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (encode(bytes) !== value || (length !== undefined && bytes.length !== length)) failure();
  return bytes;
}
const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));
const aad = (context: string) => encoder.encode('poros:encrypted-signals:1:' + context);
const aes = (bytes: Uint8Array<ArrayBuffer>, usage: KeyUsage[]) => subtle().importKey('raw', bytes, 'AES-GCM', false, usage);

export async function supportsCreatorEncryption(): Promise<boolean> {
  try { await subtle().generateKey('X25519', false, ['deriveBits']); return true; } catch { return false; }
}

export async function createEncryptionIdentity(wallet: string) {
  const pair = await subtle().generateKey('X25519', true, ['deriveBits']) as CryptoKeyPair;
  const publicKey = encode(new Uint8Array(await subtle().exportKey('raw', pair.publicKey)));
  const privateJwk = await subtle().exportKey('jwk', pair.privateKey);
  const recovery = random(32);
  const iv = random(12);
  const ciphertext = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad('backup:' + wallet.toLowerCase()) },
    await aes(recovery, ['encrypt']), encoder.encode(JSON.stringify(privateJwk)));
  const privateKey = await subtle().importKey('jwk', privateJwk, 'X25519', false, ['deriveBits']);
  return { privateKey, recoveryCode: encode(recovery), identity: { publicKey, backup: { iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) } } satisfies EncryptionIdentity };
}

export async function restoreEncryptionIdentity(wallet: string, identity: EncryptionIdentity, recoveryCode: string): Promise<CryptoKey> {
  try {
    const plaintext = await subtle().decrypt({ name: 'AES-GCM', iv: decode(identity.backup.iv, 12), additionalData: aad('backup:' + wallet.toLowerCase()) },
      await aes(decode(recoveryCode.trim(), 32), ['decrypt']), decode(identity.backup.ciphertext));
    const jwk = JSON.parse(decoder.decode(plaintext)) as JsonWebKey;
    if (jwk.kty !== 'OKP' || jwk.crv !== 'X25519' || jwk.x !== identity.publicKey || !jwk.d) failure();
    return await subtle().importKey('jwk', jwk, 'X25519', false, ['deriveBits']);
  } catch { return failure(); }
}

async function wrappingKey(privateKey: CryptoKey, publicKey: string, salt: Uint8Array<ArrayBuffer>, context: string) {
  const remote = await subtle().importKey('raw', decode(publicKey, 32), 'X25519', false, []);
  const shared = await subtle().deriveBits({ name: 'X25519', public: remote }, privateKey, 256);
  const material = await subtle().importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: aad('wrap:' + context) }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function sealContentKey(contentKey: Uint8Array<ArrayBuffer>, recipientPublicKey: string, context: string): Promise<KeyBox> {
  const ephemeral = await subtle().generateKey('X25519', true, ['deriveBits']) as CryptoKeyPair;
  const salt = random(32);
  const iv = random(12);
  const key = await wrappingKey(ephemeral.privateKey, recipientPublicKey, salt, context);
  const ciphertext = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad(context) }, key, contentKey);
  return { publicKey: encode(new Uint8Array(await subtle().exportKey('raw', ephemeral.publicKey))), salt: encode(salt), iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) };
}

export async function openContentKey(box: KeyBox, privateKey: CryptoKey, context: string): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const key = await wrappingKey(privateKey, box.publicKey, decode(box.salt, 32), context);
    const plaintext = await subtle().decrypt({ name: 'AES-GCM', iv: decode(box.iv, 12), additionalData: aad(context) }, key, decode(box.ciphertext));
    if (plaintext.byteLength !== 32) failure();
    return new Uint8Array(plaintext);
  } catch { return failure(); }
}

function validateContent(input: unknown): SignalContent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) failure('Enter a signal title and body.');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).sort().join(',') !== 'body,title' || typeof value.title !== 'string' || !value.title.trim() ||
      typeof value.body !== 'string' || !value.body.trim() || encoder.encode(value.title).length > 100 || encoder.encode(value.body).length > 4096) failure('Signal title must fit 100 bytes and body 4,096 bytes.');
  return { title: value.title, body: value.body };
}
export async function encryptSignal(content: SignalContent, context: string) {
  const checked = validateContent(content);
  const contentKey = random(32);
  const iv = random(12);
  const ciphertext = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad(context) }, await aes(contentKey, ['encrypt']), encoder.encode(JSON.stringify(checked)));
  return { key: contentKey, iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) };
}
export async function decryptSignal(encrypted: { iv: string; ciphertext: string }, contentKey: Uint8Array<ArrayBuffer>, context: string): Promise<SignalContent> {
  try {
    const plaintext = await subtle().decrypt({ name: 'AES-GCM', iv: decode(encrypted.iv, 12), additionalData: aad(context) }, await aes(contentKey, ['decrypt']), decode(encrypted.ciphertext));
    return validateContent(JSON.parse(decoder.decode(plaintext)));
  } catch { return failure(); }
}
