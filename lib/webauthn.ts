import { cookies } from 'next/headers';
import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { z } from 'zod';
import { createSession, getSession } from './auth';
import {
  AuthError, authenticationSchema, json, loginBody, loginVerifyBody,
  registrationSchema, usernameBody,
} from './auth-http';
import { CHALLENGE_MS, ENROLLMENT_MS, cookieOptions, relyingParty, sessionSecret } from './config';
import {
  authenticatorDB, challengeStore, sessionDB, userDB,
  type Challenge, type ChallengePurpose, type Session, type User,
} from './db';
import { getSingaporeNow } from './timezone';

async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new AuthError('Not authenticated');
  return session;
}

async function saveChallenge(data: Omit<Challenge, 'id'>) {
  const jar = await cookies();
  const old = jar.get('auth_challenge')?.value;
  if (old) challengeStore.remove(old);
  const id = challengeStore.save(data);
  jar.set('auth_challenge', id, {
    ...cookieOptions(), sameSite: 'strict',
    maxAge: Math.ceil((data.expires_at - getSingaporeNow().getTime()) / 1000),
  });
}

async function takeChallenge(purpose: ChallengePurpose, session?: Session): Promise<Challenge> {
  const jar = await cookies();
  const id = jar.get('auth_challenge')?.value;
  jar.set('auth_challenge', '', { ...cookieOptions(), sameSite: 'strict', maxAge: 0 });
  const challenge = id ? challengeStore.consume(id) : undefined;
  if (!challenge || challenge.purpose !== purpose ||
      (session && (challenge.session_id !== session.sessionId || challenge.user_id !== session.userId))) {
    throw new AuthError('Passkey request expired or invalid. Please start again.');
  }
  return challenge;
}

function credentialDescriptors(userId: number) {
  return authenticatorDB.listByUserId(userId).map((credential) => ({
    id: credential.credential_id,
  }));
}

async function registrationOptions(user?: User) {
  const rp = relyingParty();
  return generateRegistrationOptions({
    rpID: rp.rpID, rpName: rp.rpName,
    userName: user?.username ?? '',
    ...(user ? { userID: isoBase64URL.toBuffer(user.user_handle) } : {}),
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    excludeCredentials: user ? credentialDescriptors(user.id) : [],
  });
}

export async function registerOptions(body: unknown) {
  sessionSecret();
  const { username } = usernameBody.parse(body);
  if (userDB.findByUsername(username)) throw new AuthError('Username already taken', 409);
  const rp = relyingParty();
  const options = await generateRegistrationOptions({
    rpName: rp.rpName, rpID: rp.rpID, userName: username, attestationType: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  });
  await saveChallenge({
    purpose: 'register', challenge: options.challenge, username,
    user_id: null, user_handle: options.user.id, session_id: null,
    expires_at: getSingaporeNow().getTime() + CHALLENGE_MS,
  });
  return json(options);
}

async function verifyRegistration(response: RegistrationResponseJSON, challenge: Challenge) {
  const rp = relyingParty();
  const verification = await verifyRegistrationResponse({
    response, expectedChallenge: challenge.challenge,
    expectedOrigin: rp.origin, expectedRPID: rp.rpID, requireUserVerification: true,
  }).catch(() => { throw new AuthError('Passkey verification failed. Please try again.'); });
  if (!verification.verified || !verification.registrationInfo) {
    throw new AuthError('Passkey verification failed. Please try again.');
  }
  return verification.registrationInfo.credential;
}

export async function registerVerify(body: unknown) {
  const { username, response } = usernameBody.extend({ response: registrationSchema }).parse(body);
  const challenge = await takeChallenge('register');
  if (username !== challenge.username) throw new AuthError('Passkey verification failed');
  const credential = await verifyRegistration(response, challenge);
  const user = userDB.register(username, challenge.user_handle, { ...credential, counter: credential.counter ?? 0 });
  await createSession(user);
  return json({ success: true });
}

export async function loginOptions(body: unknown) {
  sessionSecret();
  const data = loginBody.parse(body);
  const session = data.intent === 'add-passkey' ? await requireSession() : undefined;
  const user = session ? userDB.findById(session.userId) : userDB.findByUsername('username' in data ? data.username : '');
  if (!user) throw new AuthError('Unable to sign in with that username', 400);
  const options = await generateAuthenticationOptions({
    rpID: relyingParty().rpID,
    allowCredentials: credentialDescriptors(user.id),
    userVerification: 'required',
  });
  await saveChallenge({
    purpose: session ? 'reauth' : 'login', challenge: options.challenge,
    username: user.username, user_id: user.id, user_handle: user.user_handle,
    session_id: session?.sessionId ?? null,
    expires_at: getSingaporeNow().getTime() + (session ? ENROLLMENT_MS : CHALLENGE_MS),
  });
  return json(options);
}

async function verifyAuthentication(response: z.infer<typeof authenticationSchema>, challenge: Challenge) {
  const credential = authenticatorDB.findByCredentialId(response.id);
  if (!credential || credential.user_id !== challenge.user_id ||
      (response.response.userHandle && response.response.userHandle !== challenge.user_handle)) {
    throw new AuthError('Authenticator not recognized');
  }
  const rp = relyingParty();
  const verification = await verifyAuthenticationResponse({
    response, expectedChallenge: challenge.challenge, expectedOrigin: rp.origin,
    expectedRPID: rp.rpID, requireUserVerification: true,
    credential: {
      id: credential.credential_id,
      publicKey: new Uint8Array(credential.credential_public_key),
      counter: credential.counter ?? 0,
    },
  }).catch(() => { throw new AuthError('Passkey verification failed. Please try again.'); });
  if (!verification.verified || !authenticatorDB.updateCounter(
    credential.id, credential.counter ?? 0, verification.authenticationInfo.newCounter ?? 0,
  )) throw new AuthError('Passkey verification failed. Please try again.');
  return userDB.findById(credential.user_id)!;
}

export async function loginVerify(body: unknown) {
  const data = loginVerifyBody.parse(body);
  const session = data.intent === 'add-passkey' ? await requireSession() : undefined;
  const challenge = await takeChallenge(session ? 'reauth' : 'login', session);
  if (!session && ('username' in data ? data.username : '') !== challenge.username) {
    throw new AuthError('Passkey verification failed');
  }
  const user = await verifyAuthentication(data.response, challenge);
  if (session) {
    const serverTime = getSingaporeNow().getTime();
    const enrollmentExpiresAt = serverTime + ENROLLMENT_MS;
    if (!sessionDB.grantEnrollment(session, enrollmentExpiresAt)) {
      throw new AuthError('Not authenticated');
    }
    return json({ success: true, enrollmentExpiresAt, serverTime });
  } else {
    await createSession(user);
  }
  return json({ success: true });
}

export async function passkeyOptions(body: unknown) {
  const session = await requireSession();
  z.object({}).parse(body);
  const expiresAt = sessionDB.consumeEnrollment(session);
  if (!expiresAt) throw new AuthError('Verify an existing passkey again before adding a new one');
  const user = userDB.findById(session.userId)!;
  const options = await registrationOptions(user);
  await saveChallenge({
    purpose: 'enroll', challenge: options.challenge, username: user.username,
    user_id: user.id, user_handle: user.user_handle, session_id: session.sessionId,
    expires_at: expiresAt,
  });
  return json(options);
}

export async function passkeyVerify(body: unknown) {
  const session = await requireSession();
  const { response } = z.object({ response: registrationSchema }).parse(body);
  const challenge = await takeChallenge('enroll', session);
  const credential = await verifyRegistration(response, challenge);
  if (!authenticatorDB.addForSession(
    session, { ...credential, counter: credential.counter ?? 0 }, challenge.expires_at,
  )) throw new AuthError('Session or passkey request expired. Please start again.');
  return json({ success: true });
}
