import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPassword, normalizeEmail, verifyPassword } from '../src/auth/credentials.ts';

test('passwords are salted, never stored as plaintext, and verified', async () => {
  const first = await hashPassword('a sufficiently long password');
  const second = await hashPassword('a sufficiently long password');
  assert.notEqual(first, second);
  assert.equal(first.includes('a sufficiently long password'), false);
  assert.equal(await verifyPassword('a sufficiently long password', first), true);
  assert.equal(await verifyPassword('wrong password', first), false);
  assert.equal(await verifyPassword('anything', 'invalid'), false);
});

test('email normalization is consistent for registration and login', () => {
  assert.equal(normalizeEmail('  Person@Example.COM  '), 'person@example.com');
});
