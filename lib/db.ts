import 'server-only';
import Database from 'better-sqlite3';
import path from 'node:path';
import type { Priority } from './priority';

export type { Priority } from './priority';
export type RecurrencePattern = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface User {
  id: number;
  username: string;
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

declare global {
  var __todoDatabase: Database.Database | undefined;
}

function openDatabase(): Database.Database {
  const database =
    globalThis.__todoDatabase ??
    new Database(
      process.env.TODO_DB_PATH ?? path.join(process.cwd(), 'todos.db'),
    );
  globalThis.__todoDatabase = database;
  database.pragma('foreign_keys = ON');
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

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
  `);
  return database;
}

const database = openDatabase();

function mapTodo(row: TodoRow, subtasks: Subtask[], tags: Tag[]): Todo {
  return {
    ...row,
    completed: row.completed === 1,
    subtasks,
    tags,
  };
}

function hydrateTodos(rows: TodoRow[]): Todo[] {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(', ');
  const subtasks = database
    .prepare(
      `SELECT id, todo_id, title, completed, position, created_at
       FROM subtasks WHERE todo_id IN (${placeholders}) ORDER BY position ASC`,
    )
    .all(...ids) as SubtaskRow[];
  const tagRows = database
    .prepare(
      `SELECT tags.id, tags.user_id, tags.name, tags.color, tags.created_at, todo_tags.todo_id
       FROM tags
       INNER JOIN todo_tags ON todo_tags.tag_id = tags.id
       WHERE todo_tags.todo_id IN (${placeholders})
       ORDER BY tags.name COLLATE NOCASE ASC`,
    )
    .all(...ids) as (Tag & { todo_id: number })[];

  const subtasksByTodo = new Map<number, Subtask[]>();
  for (const subtask of subtasks) {
    const items = subtasksByTodo.get(subtask.todo_id) ?? [];
    items.push({ ...subtask, completed: subtask.completed === 1 });
    subtasksByTodo.set(subtask.todo_id, items);
  }

  const tagsByTodo = new Map<number, Tag[]>();
  for (const { todo_id, ...tag } of tagRows) {
    const items = tagsByTodo.get(todo_id) ?? [];
    items.push(tag);
    tagsByTodo.set(todo_id, items);
  }

  return rows.map((row) =>
    mapTodo(
      row,
      subtasksByTodo.get(row.id) ?? [],
      tagsByTodo.get(row.id) ?? [],
    ),
  );
}

function getTodoForUser(id: number, userId: number): Todo | undefined {
  const row = database
    .prepare('SELECT * FROM todos WHERE id = ? AND user_id = ?')
    .get(id, userId) as TodoRow | undefined;
  if (!row) return undefined;
  return hydrateTodos([row])[0];
}

function validateTagOwnership(tagIds: number[], userId: number): void {
  if (tagIds.length === 0) return;
  const placeholders = tagIds.map(() => '?').join(', ');
  const rows = database
    .prepare(
      `SELECT id FROM tags WHERE user_id = ? AND id IN (${placeholders})`,
    )
    .all(userId, ...tagIds) as { id: number }[];
  if (rows.length !== new Set(tagIds).size) {
    throw new RangeError('One or more tags were not found for this user');
  }
}

export const userDB = {
  create(username: string): User {
    const result = database
      .prepare('INSERT INTO users (username) VALUES (?)')
      .run(username);
    return database
      .prepare('SELECT id, username, created_at FROM users WHERE id = ?')
      .get(Number(result.lastInsertRowid)) as User;
  },
};

export const todoDB = {
  create(input: CreateTodoInput): Todo {
    const tagIds = input.tag_ids ?? [];
    return database.transaction(() => {
      validateTagOwnership(tagIds, input.user_id);
      const result = database
        .prepare(
          `INSERT INTO todos
            (user_id, title, due_date, priority, is_recurring, recurrence_pattern, reminder_minutes)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.user_id,
          input.title,
          input.due_date ?? null,
          input.priority ?? 'medium',
          input.is_recurring ? 1 : 0,
          input.recurrence_pattern ?? null,
          input.reminder_minutes ?? null,
        );
      const todoId = Number(result.lastInsertRowid);
      const attachTag = database.prepare(
        'INSERT INTO todo_tags (todo_id, tag_id) VALUES (?, ?)',
      );
      for (const tagId of tagIds) attachTag.run(todoId, tagId);
      return getTodoForUser(todoId, input.user_id)!;
    })();
  },

  findAllByUser(userId: number, priority?: Priority): Todo[] {
    const rows = database
      .prepare(
        `SELECT * FROM todos
         WHERE user_id = ? AND (? IS NULL OR priority = ?)
         ORDER BY created_at DESC`,
      )
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
        typeof value === 'boolean' ? (value ? 1 : 0) : (value as string | number | null),
      );
    }

    return database.transaction(() => {
      if (!getTodoForUser(id, userId)) return undefined;
      if (input.tag_ids !== undefined) {
        validateTagOwnership(input.tag_ids, userId);
        database.prepare('DELETE FROM todo_tags WHERE todo_id = ?').run(id);
        const attachTag = database.prepare(
          'INSERT INTO todo_tags (todo_id, tag_id) VALUES (?, ?)',
        );
        for (const tagId of input.tag_ids) attachTag.run(id, tagId);
      }

      if (fields.length > 0) {
        fields.push('updated_at = ?');
        values.push(updatedAt, id, userId);
        database
          .prepare(
            `UPDATE todos SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`,
          )
          .run(...values);
      }
      return getTodoForUser(id, userId);
    })();
  },

  deleteForUser(id: number, userId: number): boolean {
    const result = database
      .prepare('DELETE FROM todos WHERE id = ? AND user_id = ?')
      .run(id, userId);
    return result.changes > 0;
  },
};
