import test from 'node:test';
import { runLiveSmoke } from '../../../src/integrations/arkiv/tooling/live.ts';
test('opt-in funded Rabdi SDK lifecycle proof',{
  skip:process.env.ARKIV_RUN_LIVE_TESTS!=='1'?'Requires disposable funded wallets and ARKIV_RUN_LIVE_TESTS=1':false,
  timeout:300_000,
},async t=>{const result=await runLiveSmoke();t.diagnostic(JSON.stringify(result));});
