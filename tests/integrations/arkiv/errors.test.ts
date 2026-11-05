import test from 'node:test';
import assert from 'node:assert/strict';
import {mapError} from '../../../src/integrations/arkiv/errors.ts';
test('rate limits after submission remain uncertain, while preflight limits are retryable',()=>{
 const error=Object.assign(new Error('too many requests'),{status:429,txHash:`0x${'a'.repeat(64)}`});
 assert.equal(mapError(error).code,'RATE_LIMITED');
 const submitted=mapError(error,true);
 assert.equal(submitted.code,'WRITE_STATUS_UNKNOWN');assert.equal(submitted.txHash,error.txHash);
});
