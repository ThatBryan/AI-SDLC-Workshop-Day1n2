import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import type { WebAuthnCredential } from '@simplewebauthn/server';
import type { Priority } from './priority';
export type { Priority } from './priority';
import { formatSingaporeDate, getSingaporeNow } from './timezone.ts';
import type { ImportTodoInput } from './todoImport.ts';

export type RecurrencePattern = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface User {
  id: number;
  username: string;
  user_handle: string;
  created_at: string;
}

export interface Subtask {
  id: number;
  todo_id: number;
  title: string;
  completed: boolean;
  position: number;
  created_at: string;
}

export interface Tag {
  id: number;
  user_id: number;
  name: string;
  color: string;
  created_at: string;
}

export interface Holiday {
  id: number;
  date: string;
  name: string;
}

export interface ImportResult {
  imported: number;
  tagsCreated: number;
  tagsReused: number;
}

export interface Todo {
  id: number;
  user_id: number;
  title: string;
  completed: boolean;
  due_date: string | null;
  priority: Priority;
  is_recurring: boolean;
  recurrence_pattern: RecurrencePattern | null;
  reminder_minutes: number | null;
  last_notification_sent: string | null;
  created_at: string;
  updated_at: string | null;
  subtasks: Subtask[];
  tags: Tag[];
}

export interface CreateTodoInput {
  user_id: number;
  title: string;
  due_date?: string | null;
  priority?: Priority;
  is_recurring?: boolean;
  recurrence_pattern?: RecurrencePattern | null;
  reminder_minutes?: number | null;
  tag_ids?: number[];
}

export interface UpdateTodoInput {
  title?: string;
  due_date?: string | null;
  priority?: Priority;
  completed?: boolean;
  is_recurring?: boolean;
  recurrence_pattern?: RecurrencePattern | null;
  reminder_minutes?: number | null;
  tag_ids?: number[];
}

type TodoRow = Omit<Todo, 'completed' | 'subtasks' | 'tags'> & {
  completed: number;
};
type SubtaskRow = Omit<Subtask, 'completed'> & { completed: number };

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
  const db = new Database(process.env.TODO_DB_PATH || process.env.DATABASE_PATH || 'todos.db');
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

    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
      due_date TEXT,
      priority TEXT NOT NULL DEFAULT 'medium'
        CHECK (priority IN ('high', 'medium', 'low')),
      is_recurring INTEGER NOT NULL DEFAULT 0 CHECK (is_recurring IN (0, 1)),
      recurrence_pattern TEXT,
      reminder_minutes INTEGER,
      last_notification_sent TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_todos_user_id ON todos(user_id);
    CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);

    CREATE TABLE IF NOT EXISTS subtasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_subtasks_todo_id ON subtasks(todo_id);

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#3B82F6',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS todo_tags (
      todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (todo_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);
  `);
  databaseGlobal.todoDatabase = db;
  return db;
}

function getTodoForUser(id: number, userId: number): Todo | undefined {
  const db = getDB();
  const row = db
    .prepare('SELECT * FROM todos WHERE id = ? AND user_id = ?')
    .get(id, userId) as TodoRow | undefined;
  if (!row) return undefined;

  const subtasks = db
    .prepare(
      'SELECT id, todo_id, title, completed, position, created_at FROM subtasks WHERE todo_id = ? ORDER BY position ASC',
    )
    .all(id) as SubtaskRow[];
  const tags = db
    .prepare(
      `SELECT tags.id, tags.user_id, tags.name, tags.color, tags.created_at
       FROM tags
       INNER JOIN todo_tags ON todo_tags.tag_id = tags.id
       WHERE todo_tags.todo_id = ?
       ORDER BY tags.name COLLATE NOCASE ASC`,
    )
    .all(id) as Tag[];

  return {
    ...row,
    completed: row.completed === 1,
    subtasks: subtasks.map((subtask) => ({
      ...subtask,
      completed: subtask.completed === 1,
    })),
    tags,
  };
}

function hydrateTodos(rows: TodoRow[]): Todo[] {
  return rows.flatMap((row) => {
    const todo = getTodoForUser(row.id, row.user_id);
    return todo ? [todo] : [];
  });
}

function validateTagOwnership(tagIds: number[], userId: number): void {
  if (tagIds.length === 0) return;
  const placeholders = tagIds.map(() => '?').join(', ');
  const rows = getDB()
    .prepare(`SELECT id FROM tags WHERE user_id = ? AND id IN (${placeholders})`)
    .all(userId, ...tagIds) as { id: number }[];
  if (rows.length !== new Set(tagIds).size) {
    throw new RangeError('One or more tags were not found for this user');
  }
}

export const userDB = {
  create(username: string): User {
    const handle = randomBytes(32).toString('base64url');
    const result = getDB().prepare(
      'INSERT INTO users (username, user_handle, created_at) VALUES (?, ?, ?)',
    ).run(username, handle, formatSingaporeDate());
    return userDB.findById(Number(result.lastInsertRowid))!;
  },
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

export const todoDB = {
  create(input: CreateTodoInput): Todo {
    const db = getDB();
    const tagIds = input.tag_ids ?? [];
    return db.transaction(() => {
      validateTagOwnership(tagIds, input.user_id);
      const result = db.prepare(`
        INSERT INTO todos
          (user_id, title, due_date, priority, is_recurring, recurrence_pattern, reminder_minutes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.user_id,
        input.title,
        input.due_date ?? null,
        input.priority ?? 'medium',
        input.is_recurring ? 1 : 0,
        input.recurrence_pattern ?? null,
        input.reminder_minutes ?? null,
      );
      const id = Number(result.lastInsertRowid);
      const attachTag = db.prepare(
        'INSERT INTO todo_tags (todo_id, tag_id) VALUES (?, ?)',
      );
      for (const tagId of tagIds) attachTag.run(id, tagId);
      const created = getTodoForUser(id, input.user_id);
      if (!created) throw new Error('Created todo could not be reloaded');
      return created;
    })();
  },

  findAllByUser(userId: number, priority?: Priority): Todo[] {
    const rows = getDB()
      .prepare(`
        SELECT * FROM todos
        WHERE user_id = ? AND (? IS NULL OR priority = ?)
        ORDER BY created_at DESC
      `)
      .all(userId, priority ?? null, priority ?? null) as TodoRow[];
    return hydrateTodos(rows);
  },

  findByIdForUser(id: number, userId: number): Todo | undefined {
    return getTodoForUser(id, userId);
  },

  updateForUser(
    id: number,
    userId: number,
    input: UpdateTodoInput,
    updatedAt: string,
  ): Todo | undefined {
    const db = getDB();
    const fields: string[] = [];
    const values: (string | number | null)[] = [];
    const assignments: Array<[keyof UpdateTodoInput, string, unknown]> = [
      ['title', 'title', input.title],
      ['due_date', 'due_date', input.due_date],
      ['priority', 'priority', input.priority],
      ['completed', 'completed', input.completed],
      ['is_recurring', 'is_recurring', input.is_recurring],
      ['recurrence_pattern', 'recurrence_pattern', input.recurrence_pattern],
      ['reminder_minutes', 'reminder_minutes', input.reminder_minutes],
    ];

    for (const [key, column, value] of assignments) {
      if (!Object.hasOwn(input, key)) continue;
      fields.push(`${column} = ?`);
      values.push(
        typeof value === 'boolean'
          ? Number(value)
          : (value as string | number | null),
      );
    }

    return db.transaction(() => {
      if (!getTodoForUser(id, userId)) return undefined;
      if (input.tag_ids !== undefined) {
        validateTagOwnership(input.tag_ids, userId);
        db.prepare('DELETE FROM todo_tags WHERE todo_id = ?').run(id);
        const attachTag = db.prepare(
          'INSERT INTO todo_tags (todo_id, tag_id) VALUES (?, ?)',
        );
        for (const tagId of input.tag_ids) attachTag.run(id, tagId);
      }

      if (fields.length > 0) {
        fields.push('updated_at = ?');
        values.push(updatedAt, id, userId);
        db.prepare(
          `UPDATE todos SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`,
        ).run(...values);
      }
      return getTodoForUser(id, userId);
    })();
  },

  deleteForUser(id: number, userId: number): boolean {
    const result = getDB()
      .prepare('DELETE FROM todos WHERE id = ? AND user_id = ?')
      .run(id, userId);
    return result.changes > 0;
  },

  importAll(userId: number, items: ImportTodoInput[]): ImportResult {
    const db = getDB();
    let tagsCreated = 0;
    let tagsReused = 0;
    const importItems = db.transaction(() => {
      const insertTodo = db.prepare(`
        INSERT INTO todos
          (user_id, title, completed, due_date, priority, is_recurring,
           recurrence_pattern, reminder_minutes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertSubtask = db.prepare(`
        INSERT INTO subtasks (todo_id, title, completed, position)
        VALUES (?, ?, ?, ?)
      `);
      const findTagByName = db.prepare(`
        SELECT id FROM tags
        WHERE user_id = ? AND name = ? COLLATE NOCASE
        ORDER BY id ASC LIMIT 1
      `);
      const insertTag = db.prepare(
        'INSERT INTO tags (user_id, name, color) VALUES (?, ?, ?)',
      );
      const linkTag = db.prepare(
        'INSERT INTO todo_tags (todo_id, tag_id) VALUES (?, ?)',
      );

      for (const item of items) {
        const todoId = Number(insertTodo.run(
          userId,
          item.title,
          Number(item.completed),
          item.due_date,
          item.priority,
          Number(item.is_recurring),
          item.recurrence_pattern,
          item.reminder_minutes,
          item.created_at,
        ).lastInsertRowid);

        item.subtasks.forEach((subtask, index) => {
          insertSubtask.run(todoId, subtask.title, Number(subtask.completed), index);
        });

        const linkedTagIds = new Set<number>();
        for (const tag of item.tags) {
          const existing = findTagByName.get(userId, tag.name) as { id: number } | undefined;
          let tagId: number;
          if (existing) {
            tagId = existing.id;
            tagsReused += 1;
          } else {
            tagId = Number(insertTag.run(userId, tag.name, tag.color).lastInsertRowid);
            tagsCreated += 1;
          }
          if (linkedTagIds.has(tagId)) continue;
          linkedTagIds.add(tagId);
          linkTag.run(todoId, tagId);
        }
      }
    });

    importItems.immediate();
    return { imported: items.length, tagsCreated, tagsReused };
  },
};

function utcDateKey(date: Date): string {
  return [
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function makeUtcDate(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

export const holidayDB = {
  findAll(): Holiday[] {
    return getDB()
      .prepare('SELECT id, date, name FROM holidays ORDER BY date ASC')
      .all() as Holiday[];
  },

  findByMonth(year: number, month: number): Holiday[] {
    if (
      !Number.isInteger(year) ||
      year < 1 ||
      year > 9999 ||
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12
    ) {
      throw new RangeError('Holiday year must be 1–9999 and month must be 1–12');
    }

    const firstOfMonth = makeUtcDate(year, month, 1);
    const start = new Date(
      firstOfMonth.getTime() - firstOfMonth.getUTCDay() * 24 * 60 * 60 * 1000,
    );
    const end = new Date(start.getTime() + 41 * 24 * 60 * 60 * 1000);
    return getDB()
      .prepare(`
        SELECT id, date, name FROM holidays
        WHERE date >= ? AND date <= ?
        ORDER BY date ASC
      `)
      .all(utcDateKey(start), utcDateKey(end)) as Holiday[];
  },

  upsertMany(holidays: Array<Pick<Holiday, 'date' | 'name'>>): void {
    const db = getDB();
    const insertHoliday = db.prepare(`
      INSERT INTO holidays (date, name) VALUES (?, ?)
      ON CONFLICT(date) DO UPDATE SET name = excluded.name
    `);
    db.transaction(() => {
      for (const holiday of holidays) {
        insertHoliday.run(holiday.date, holiday.name);
      }
    }).immediate();
  },
};
