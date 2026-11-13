import assert from 'node:assert/strict';
import test from 'node:test';

process.env.TODO_DB_PATH = ':memory:';

const { getDB, todoDB, userDB } = await import('../lib/db.ts');

function importItem(title, overrides = {}) {
  return {
    title,
    completed: false,
    due_date: null,
    priority: 'medium',
    is_recurring: false,
    recurrence_pattern: null,
    reminder_minutes: null,
    created_at: '2026-03-01T00:00:00.000Z',
    subtasks: [],
    tags: [],
    ...overrides,
  };
}

test('import creates fresh related IDs, restores tags, and normalizes subtask positions', () => {
  const user = userDB.create('import-owner');
  const existingTodo = todoDB.create({ user_id: user.id, title: 'Existing todo' });
  const db = getDB();
  const existingSubtaskId = Number(db
    .prepare('INSERT INTO subtasks (todo_id, title) VALUES (?, ?) RETURNING id')
    .get(existingTodo.id, 'Existing subtask').id);
  const existingTag = db
    .prepare('INSERT INTO tags (user_id, name, color) VALUES (?, ?, ?) RETURNING id')
    .get(user.id, 'Work', '#112233');
  const result = todoDB.importAll(user.id, [
    importItem('Imported todo', {
      subtasks: [
        { title: 'Second step', completed: true, position: 99 },
        { title: 'First step', completed: false, position: 99 },
      ],
      tags: [
        { name: 'work', color: '#ffffff' },
        { name: 'Personal', color: '#445566' },
      ],
    }),
  ]);
  const imported = todoDB.findAllByUser(user.id).find((todo) => todo.title === 'Imported todo');

  assert.deepEqual(result, { imported: 1, tagsCreated: 1, tagsReused: 1 });
  assert.ok(imported);
  assert.notEqual(imported.id, existingTodo.id);
  assert.deepEqual(
    imported.subtasks.map(({ title, completed, position }) => ({
      title,
      completed,
      position,
    })),
    [
      { title: 'Second step', completed: true, position: 0 },
      { title: 'First step', completed: false, position: 1 },
    ],
  );
  assert.notEqual(imported.subtasks[0].id, existingSubtaskId);
  assert.notEqual(imported.subtasks[1].id, existingSubtaskId);
  assert.deepEqual(
    imported.tags.map(({ name, color }) => ({ name, color })),
    [
      { name: 'Personal', color: '#445566' },
      { name: 'Work', color: '#112233' },
    ],
  );
  assert.ok(imported.tags.some((tag) => tag.id === existingTag.id));
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM tags WHERE user_id = ?')
      .get(user.id).count,
    2,
  );
});

test('tag reuse is scoped to the importing user', () => {
  const firstUser = userDB.create('first-import-owner');
  const secondUser = userDB.create('second-import-owner');
  const db = getDB();
  const firstTag = db
    .prepare('INSERT INTO tags (user_id, name, color) VALUES (?, ?, ?) RETURNING id')
    .get(firstUser.id, 'Shared', '#111111');

  const firstResult = todoDB.importAll(firstUser.id, [
    importItem('First user todo', {
      tags: [{ name: 'shared', color: '#ffffff' }],
    }),
  ]);
  const secondResult = todoDB.importAll(secondUser.id, [
    importItem('Second user todo', {
      tags: [{ name: 'shared', color: '#222222' }],
    }),
  ]);

  assert.deepEqual(firstResult, { imported: 1, tagsCreated: 0, tagsReused: 1 });
  assert.deepEqual(secondResult, { imported: 1, tagsCreated: 1, tagsReused: 0 });
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM tags WHERE name = ? COLLATE NOCASE')
      .get('shared').count,
    2,
  );
  assert.equal(
    todoDB.findAllByUser(firstUser.id).find((todo) => todo.title === 'First user todo')
      ?.tags[0].id,
    firstTag.id,
  );
});

test('empty imports succeed and a failed item rolls back the entire batch', () => {
  const user = userDB.create('atomic-import-owner');
  const before = todoDB.findAllByUser(user.id);

  assert.deepEqual(todoDB.importAll(user.id, []), {
    imported: 0,
    tagsCreated: 0,
    tagsReused: 0,
  });
  assert.throws(
    () =>
      todoDB.importAll(user.id, [
        importItem('Would be rolled back'),
        importItem('Invalid item', { priority: 'urgent' }),
      ]),
    /CHECK constraint failed/,
  );
  assert.deepEqual(todoDB.findAllByUser(user.id), before);
});
