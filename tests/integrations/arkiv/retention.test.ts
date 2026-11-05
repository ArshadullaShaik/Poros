import test from 'node:test';
import assert from 'node:assert/strict';
import {DURABLE_LIFETIME_DAYS} from '../../../src/integrations/arkiv/schema.ts';
import {socialLifetimeDays} from '../../../src/integrations/arkiv/community/repository.ts';

test('new chat records expire after 45 days and other records after 180 days',()=>{
  assert.equal(DURABLE_LIFETIME_DAYS,180);
  assert.equal(socialLifetimeDays('message'),45);
  for(const type of ['profile','membership','thread','reply','vote','ban','hidden','moderator','listing','delisted','creator-plan','encryption-key','subscription','private-signal','signal-envelope'] as const)
    assert.equal(socialLifetimeDays(type),180,type);
});
