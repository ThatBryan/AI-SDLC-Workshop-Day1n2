import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { expect, it } from 'vitest';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers';

function identity() {
  return {
    ...generateKeyPairSync('ec', { namedCurve: 'prime256v1' }),
    credentialId: randomBytes(32).toString('base64url'),
  };
}

function signedAssertion(counter: number, { privateKey, publicKey, credentialId } = identity()) {
  const jwk = publicKey.export({ format: 'jwk' });
  const challenge = randomBytes(32).toString('base64url');
  const clientData = Buffer.from(JSON.stringify({
    type: 'webauthn.get', challenge, origin: 'http://localhost:3000', crossOrigin: false,
  }));
  const counterBytes = Buffer.alloc(4);
  counterBytes.writeUInt32BE(counter);
  const authenticatorData = Buffer.concat([
    createHash('sha256').update('localhost').digest(),
    Buffer.from([0x05]), // User presence and user verification.
    counterBytes,
  ]);
  const signature = sign('sha256', Buffer.concat([
    authenticatorData, createHash('sha256').update(clientData).digest(),
  ]), privateKey);
  const coseKey = new Map<number, number | Uint8Array>([
    [1, 2], [3, -7], [-1, 1],
    [-2, isoBase64URL.toBuffer(jwk.x!)], [-3, isoBase64URL.toBuffer(jwk.y!)],
  ]);
  return {
    response: {
      id: credentialId, rawId: credentialId, type: 'public-key' as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(clientData),
        authenticatorData: isoBase64URL.fromBuffer(authenticatorData),
        signature: isoBase64URL.fromBuffer(signature),
      },
    },
    expectedChallenge: challenge,
    expectedOrigin: 'http://localhost:3000',
    expectedRPID: 'localhost',
    requireUserVerification: true,
    credential: { id: credentialId, publicKey: isoCBOR.encode(coseKey), counter: 0 },
  };
}

it('accepts genuinely signed counterless assertions repeatedly without mocking verification', async () => {
  // Chromium virtual authenticators increment counters; exercise counterless hardware here.
  const credential = identity();
  for (let attempt = 0; attempt < 2; attempt++) {
    const verified = await verifyAuthenticationResponse(signedAssertion(0, credential));
    expect(verified.verified).toBe(true);
    expect(verified.authenticationInfo.newCounter).toBe(0);
  }
});

it('rejects a genuinely signed non-incrementing counter and accepts the next counter', async () => {
  const credential = identity();
  const stale = signedAssertion(4, credential);
  await expect(verifyAuthenticationResponse({
    ...stale, credential: { ...stale.credential, counter: 4 },
  })).rejects.toThrow(/counter/i);
  const next = signedAssertion(5, credential);
  expect((await verifyAuthenticationResponse({
    ...next, credential: { ...next.credential, counter: 4 },
  })).verified).toBe(true);
});
