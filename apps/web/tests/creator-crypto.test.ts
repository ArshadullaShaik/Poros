import test from 'node:test';
import assert from 'node:assert/strict';
import { createEncryptionIdentity, restoreEncryptionIdentity, encryptSignal, decryptSignal, sealContentKey, openContentKey, supportsCreatorEncryption } from '../src/creator-crypto.ts';

test('signal encryption restores from Arkiv backup and rejects wrong recipients, recovery codes and contexts', async () => {
  assert.equal(await supportsCreatorEncryption(), true);
  const alice = await createEncryptionIdentity('alice');
  const bob = await createEncryptionIdentity('bob');
  const context = 'alice:publication-id';
  const content = { title: 'Reviewed signal', body: 'Private rules and trade idea.' };
  const encrypted = await encryptSignal(content, context);
  const box = await sealContentKey(encrypted.key, bob.identity.publicKey, context + ':bob');
  const restored = await restoreEncryptionIdentity('bob', bob.identity, bob.recoveryCode);
  const key = await openContentKey(box, restored, context + ':bob');
  assert.deepEqual(await decryptSignal(encrypted, key, context), content);
  await assert.rejects(openContentKey(box, alice.privateKey, context + ':bob'));
  await assert.rejects(openContentKey(box, restored, context + ':alice'));
  await assert.rejects(restoreEncryptionIdentity('bob', bob.identity, alice.recoveryCode));
  await assert.rejects(restoreEncryptionIdentity('alice', bob.identity, bob.recoveryCode));
  await assert.rejects(decryptSignal({ ...encrypted, ciphertext: 'A' + encrypted.ciphertext.slice(1) }, key, context));
  await assert.rejects(decryptSignal(encrypted, key, 'different-publication'));
  assert.equal(JSON.stringify(bob.identity).includes(bob.recoveryCode), false);
});
