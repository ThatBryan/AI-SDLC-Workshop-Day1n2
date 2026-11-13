import { randomUUID } from 'node:crypto';
import { createSessionToken } from '../lib/sessionToken.ts';
import { userDB } from '../lib/db.ts';

const user = userDB.create(`playwright-${randomUUID()}`);
const otherUser = userDB.create(`playwright-other-${randomUUID()}`);
const token = await createSessionToken(
  { id: user.id, username: user.username },
  process.env.JWT_SECRET,
);
const otherToken = await createSessionToken(
  { id: otherUser.id, username: otherUser.username },
  process.env.JWT_SECRET,
);

process.stdout.write(JSON.stringify({ token, otherToken, userId: user.id }));
