import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import type { WebAuthnCredential } from '@simplewebauthn/server';
import { formatSingaporeDate, getSingaporeNow } from './timezone';

export interface User {
  id: number;
  username: string;
  user_handle: string;
  created_at: string;
}

export interface Authenticator {
  id: number;
  user_id: number;
  credential_id: string;
  credential_public_key: Buffer;
  counter: number;
  created_at: string;
}

export interface Session {
  userId: number;
  username: string;
  sessionId: string;
}

export type ChallengePurpose = 'register' | 'login' | 'reauth' | 'enroll';
export interface Challenge {
  id: string;
  purpose: ChallengePurpose;
  challenge: string;
  username: string;
  user_id: number | null;
  user_handle: string;
  session_id: string | null;
  expires_at: number;
}

const databaseGlobal = globalThis as typeof globalThis & { todoDatabase?: Database.Database };

export function getDB(): Database.Database {
  if (databaseGlobal.todoDatabase) return databaseGlobal.todoDatabase;
  const db = new Database(process.env.DATABASE_PATH || 'todos.db');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      user_handle TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS authenticators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id TEXT UNIQUE NOT NULL,
      credential_public_key BLOB NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_authenticators_user_id ON authenticators(user_id);
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      reauth_until INTEGER
    );
    CREATE TABLE IF NOT EXISTS auth_challenges (
      id TEXT PRIMARY KEY,
      purpose TEXT NOT NULL,
      challenge TEXT NOT NULL,
      username TEXT NOT NULL,
      user_id INTEGER,
      user_handle TEXT NOT NULL,
      session_id TEXT,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_challenges_expiry ON auth_challenges(expires_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
  `);
  databaseGlobal.todoDatabase = db;
  return db;
}

export const userDB = {
  findById(id: number) {
    return getDB().prepare<[number], User>('SELECT * FROM users WHERE id = ?').get(id);
  },
  findByUsername(username: string) {
    return getDB().prepare<[string], User>('SELECT * FROM users WHERE username = ?').get(username);
  },
  register(username: string, handle: string, credential: WebAuthnCredential): User {
    return getDB().transaction(() => {
      const result = getDB().prepare(
        'INSERT INTO users (username, user_handle, created_at) VALUES (?, ?, ?)',
      ).run(username, handle, formatSingaporeDate());
      const userId = Number(result.lastInsertRowid);
      authenticatorDB.add(userId, credential);
      return userDB.findById(userId)!;
    })();
  },
};

export const authenticatorDB = {
  findByCredentialId(id: string) {
    return getDB().prepare<[string], Authenticator>(
      'SELECT * FROM authenticators WHERE credential_id = ?',
    ).get(id);
  },
  listByUserId(userId: number) {
    return getDB().prepare<[number], Authenticator>(
      'SELECT * FROM authenticators WHERE user_id = ? ORDER BY id',
    ).all(userId);
  },
  add(userId: number, credential: WebAuthnCredential) {
    getDB().prepare(`
      INSERT INTO authenticators (user_id, credential_id, credential_public_key, counter, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, credential.id, Buffer.from(credential.publicKey), credential.counter ?? 0, formatSingaporeDate());
  },
  addForSession(session: Session, credential: WebAuthnCredential, expiresAt: number): boolean {
    return getDB().transaction(() => {
      if (expiresAt <= getSingaporeNow().getTime() ||
          !sessionDB.isActive(session.sessionId, session.userId)) return false;
      authenticatorDB.add(session.userId, credential);
      return true;
    }).immediate();
  },
  updateCounter(id: number, previous: number, next: number): boolean {
    return getDB().prepare(
      'UPDATE authenticators SET counter = ? WHERE id = ? AND counter = ?',
    ).run(next ?? 0, id, previous ?? 0).changes === 1;
  },
};

export const sessionDB = {
  create(id: string, userId: number, expiresAt: number) {
    getDB().prepare('DELETE FROM sessions WHERE expires_at <= ?').run(getSingaporeNow().getTime());
    getDB().prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(id, userId, expiresAt);
  },
  isActive(id: string, userId: number): boolean {
    return !!getDB().prepare(
      'SELECT id FROM sessions WHERE id = ? AND user_id = ? AND expires_at > ?',
    ).get(id, userId, getSingaporeNow().getTime());
  },
  revoke(id: string) {
    getDB().prepare('DELETE FROM sessions WHERE id = ?').run(id);
    getDB().prepare('DELETE FROM auth_challenges WHERE session_id = ?').run(id);
  },
  grantEnrollment(session: Session, expiresAt: number): boolean {
    return getDB().prepare(`
      UPDATE sessions SET reauth_until = ? WHERE id = ? AND user_id = ? AND expires_at > ?
    `).run(expiresAt, session.sessionId, session.userId, getSingaporeNow().getTime()).changes === 1;
  },
  consumeEnrollment(session: Session): number | undefined {
    const now = getSingaporeNow().getTime();
    return getDB().transaction(() => {
      const row = getDB().prepare<[string, number, number, number], { reauth_until: number }>(`
        SELECT reauth_until FROM sessions
        WHERE id = ? AND user_id = ? AND expires_at > ? AND reauth_until > ?
      `).get(session.sessionId, session.userId, now, now);
      if (!row) return undefined;
      getDB().prepare('UPDATE sessions SET reauth_until = NULL WHERE id = ?').run(session.sessionId);
      return row.reauth_until;
    }).immediate();
  },
};

export const challengeStore = {
  save(challenge: Omit<Challenge, 'id'>): string {
    const id = randomBytes(32).toString('base64url');
    getDB().prepare('DELETE FROM auth_challenges WHERE expires_at <= ?').run(getSingaporeNow().getTime());
    getDB().prepare(`
      INSERT INTO auth_challenges
      (id, purpose, challenge, username, user_id, user_handle, session_id, expires_at)
      VALUES (@id, @purpose, @challenge, @username, @user_id, @user_handle, @session_id, @expires_at)
    `).run({ ...challenge, id });
    return id;
  },
  remove(id: string) {
    getDB().prepare('DELETE FROM auth_challenges WHERE id = ?').run(id);
  },
  consume(id: string): Challenge | undefined {
    // Delete before asynchronous verification: even simultaneous attempts have one winner.
    return getDB().prepare<[string, number], Challenge>(`
      DELETE FROM auth_challenges WHERE id = ? AND expires_at > ? RETURNING *
    `).get(id, getSingaporeNow().getTime());
  },
};
