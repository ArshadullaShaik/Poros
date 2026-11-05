import serialize from 'canonicalize';
import { getAddress, isAddress, keccak256, toBytes, type Hex } from 'viem';
import { z } from 'zod';
import type { Json, StrategyDocumentV1, ValidateStrategyDocument } from './contracts.ts';
import { fail, StorageError } from './errors.ts';
const encoder = new TextEncoder();
export const MAX_RECORD_BYTES = 65_536;
export function byteLength(text: string): number { return encoder.encode(text).length; }
function assertJson(value: unknown, ancestors = new Set<object>(), depth = 0): asserts value is Json {
  if (depth > 64) fail('INVALID_INPUT', 'JSON nesting exceeds 64');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    if (/\p{Surrogate}/u.test(value)) fail('INVALID_INPUT', 'Unpaired Unicode surrogate');
    return;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object' || ancestors.has(value)) fail('INVALID_INPUT', 'Expected acyclic JSON');
  if (!Array.isArray(value) && ![null, Object.prototype].includes(Object.getPrototypeOf(value))) fail('INVALID_INPUT', 'Expected plain JSON object');
  if (Object.getOwnPropertySymbols(value).length) fail('INVALID_INPUT');
  ancestors.add(value);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (Array.isArray(value) && key === 'length') continue;
    if (!descriptor.enumerable || !('value' in descriptor)) fail('INVALID_INPUT', 'JSON accessors are not accepted');
    assertJson(key, ancestors, depth + 1); assertJson(descriptor.value, ancestors, depth + 1);
  }
  if (Array.isArray(value) && (Object.keys(value).length !== value.length || Object.keys(value).some((k, i) => k !== String(i)))) fail('INVALID_INPUT', 'Sparse or decorated array');
  ancestors.delete(value);
}
export function canonical(value: unknown): string {
  assertJson(value);
  const result = serialize(value);
  if (result === undefined) fail('INVALID_INPUT');
  return result;
}
export function domainHash(domain: string, value: unknown): Hex {
  return keccak256(toBytes(`strategyhub:${domain}:v1\n${canonical(value)}`));
}
export function contentHash(value: unknown): Hex { return domainHash('content', value); }
export function address(value: unknown): Hex {
  if (typeof value !== 'string' || !isAddress(value,{strict:true})) fail('INVALID_INPUT', 'Invalid wallet address or checksum');
  try { return getAddress(value).toLowerCase() as Hex; } catch { return fail('INVALID_INPUT', 'Invalid wallet checksum'); }
}
export function entityKey(value: unknown): Hex {
  if (typeof value !== 'string' || !/^0x[\da-f]{64}$/.test(value)) fail('INVALID_INPUT', 'Expected lowercase 32-byte key');
  return value as Hex;
}
export function requestId(value: unknown): string {
  if (typeof value !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/.test(value)) fail('INVALID_INPUT', 'Expected lowercase UUID v4');
  return value;
}
export function makeStrategyId(creator: string, request: string): Hex {
  return domainHash('id', { creator: address(creator), requestId: requestId(request) });
}
export function name(value: unknown): string {
  if (typeof value !== 'string') fail('INVALID_INPUT', 'Name must be text');
  const n = value.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, '');
  if (!n || byteLength(n) > 80) fail('INVALID_INPUT', 'Name must contain 1–80 UTF-8 bytes');
  if (byteLength(searchName(n)) > 128) fail('INVALID_INPUT', 'Normalized name exceeds search limit');
  return n;
}
export function searchName(value: string): string { return value.normalize('NFKC').toLowerCase(); }
export function text(value: unknown, min: number, max: number): string {
  if (typeof value !== 'string' || byteLength(value) < min || byteLength(value) > max) fail('INVALID_INPUT', `Text must contain ${min}–${max} UTF-8 bytes`);
  canonical(value); return value;
}
const documentSchema = z.strictObject({
  documentSchema: z.literal('strategy-document/1'), graphSchema: z.string().min(1).max(128),
  name: z.string(), description: z.string(), license: z.enum(['MIT', 'Apache-2.0', 'CC0-1.0']),
  executionChainId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  tokenIn: z.string(), tokenOut: z.string(), category: z.enum(['dca', 'rebalance', 'signal', 'other']), graph: z.unknown(),
});
export function parseDocument(input: unknown, validator?: ValidateStrategyDocument): StrategyDocumentV1 {
  if (!validator) fail('DEPENDENCY_UNAVAILABLE', 'Developer 3 strategy validator is required');
  canonical(input);
  const parsed = documentSchema.safeParse(input);
  if (!parsed.success) fail('INVALID_INPUT', 'Strategy document envelope is invalid');
  const d = { ...parsed.data, name: name(parsed.data.name), description: text(parsed.data.description, 0, 4096),
    tokenIn: address(parsed.data.tokenIn), tokenOut: address(parsed.data.tokenOut) } as StrategyDocumentV1;
  try {
    const checked = validator(d);
    if (canonical(checked) !== canonical(d)) fail('INVALID_INPUT', 'Validator must not transform stored content');
  } catch (e) {
    if (e instanceof StorageError) throw e;
    if (e && typeof e === 'object' && 'code' in e && e.code === 'UNSUPPORTED_SCHEMA') fail('UNSUPPORTED_SCHEMA');
    fail('INVALID_INPUT', 'Strategy graph was rejected by Developer 3 validator');
  }
  return JSON.parse(canonical(d)) as StrategyDocumentV1;
}
export function recordBytes(value: unknown): Uint8Array {
  const bytes = encoder.encode(canonical(value));
  if (bytes.length > MAX_RECORD_BYTES) fail('PAYLOAD_TOO_LARGE');
  return bytes;
}
export function parseCanonicalRecord(bytes: Uint8Array): Record<string, Json> {
  if (bytes.length > MAX_RECORD_BYTES) fail('PAYLOAD_TOO_LARGE');
  try {
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value) || canonical(value) !== raw) fail('INTEGRITY_FAILED');
    return value as Record<string, Json>;
  } catch { return fail('INTEGRITY_FAILED', 'Stored record is not canonical JSON'); }
}
export function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  if (required.some(k => !Object.hasOwn(value, k)) || Object.keys(value).some(k => !required.includes(k) && !optional.includes(k))) fail('INVALID_INPUT', 'Unexpected or missing fields');
}
