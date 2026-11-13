import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSessionToken,
  verifySessionToken,
} from '../lib/sessionToken.ts';

const secret = 'a sufficiently long test-only secret value';
const issuedAt = 1_900_000_000;

test('signs and verifies a session with the PRP Session shape', async () => {
  const token = await createSessionToken(
    { id: 42, username: 'test-user' },
    secret,
    issuedAt,
  );

  assert.deepEqual(await verifySessionToken(token, secret, issuedAt), {
    userId: 42,
    username: 'test-user',
  });
});

test('rejects tampered payloads and signatures', async () => {
  const token = await createSessionToken(
    { id: 42, username: 'test-user' },
    secret,
    issuedAt,
  );
  const [header, payload, signature] = token.split('.');
  const tamperedPayload = `${header}.${payload.slice(0, -1)}${payload.endsWith('A') ? 'B' : 'A'}.${signature}`;
  const tamperedSignature = `${header}.${payload}.${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`;

  assert.equal(await verifySessionToken(tamperedPayload, secret, issuedAt), null);
  assert.equal(await verifySessionToken(tamperedSignature, secret, issuedAt), null);
});

test('rejects expired tokens and tokens signed with another key', async () => {
  const token = await createSessionToken(
    { id: 42, username: 'test-user' },
    secret,
    issuedAt,
  );

  assert.equal(
    await verifySessionToken(token, secret, issuedAt + 7 * 24 * 60 * 60),
    null,
  );
  assert.equal(
    await verifySessionToken(token, `${secret}-different`, issuedAt),
    null,
  );
});

test('rejects malformed or invalid user claims', async () => {
  assert.equal(await verifySessionToken('not.a.jwt', secret, issuedAt), null);
  await assert.rejects(
    createSessionToken({ id: 0, username: 'test-user' }, secret, issuedAt),
    /positive safe integer/,
  );
  await assert.rejects(
    createSessionToken({ id: 1, username: ' ' }, secret, issuedAt),
    /must not be empty/,
  );
  await assert.rejects(
    createSessionToken({ id: 1, username: 'test-user' }, 'short', issuedAt),
    /at least 32 bytes/,
  );
});
