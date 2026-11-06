import test from 'node:test';
import assert from 'node:assert/strict';
import {membershipCreatorCard} from '../src/membership-workspace.ts';
const creator='0x'+'a'.repeat(40);
test('Members cards show a creator profile and a membership purchase action, with no message checkout',()=>{
 const html=membershipCreatorCard(creator,'Arshad (@arshad)','0.01 Sepolia ETH / 30 days','Buy membership');
 assert.match(html,/Arshad \(@arshad\)/);assert.match(html,new RegExp('href="/profile#/profile/'+creator+'"'));
 assert.match(html,/Buy membership/);assert.match(html,/0.01 Sepolia ETH \/ 30 days/);assert.match(html,new RegExp('data-creator="'+creator+'"'));
 assert.doesNotMatch(html,/listing|checkout|unlock message|pay.per.message/i);
});
test('existing members can open messages and public creator text is escaped',()=>{
 const html=membershipCreatorCard(creator,'<script>bad()</script>','Active membership','Open messages');
 assert.match(html,/Open messages/);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
});
