import assert from 'node:assert/strict';
import test from 'node:test';

process.env.TODO_DB_PATH = ':memory:';

const { getDB, todoDB, userDB } = await import('../lib/db.ts');

test('todo database applies defaults and scopes reads, updates, and deletes by user', () => {
  const firstUser = userDB.create('first-user');
  const secondUser = userDB.create('second-user');
  const created = todoDB.create({
    user_id: firstUser.id,
    title: 'Review requirements',
  });

  assert.equal(created.priority, 'medium');
  assert.equal(created.completed, false);
  assert.equal(created.due_date, null);
  assert.deepEqual(todoDB.findAllByUser(secondUser.id), []);
  assert.deepEqual(
    todoDB.findAllByUser(firstUser.id).map((todo) => todo.id),
    [created.id],
  );
  assert.equal(todoDB.findByIdForUser(created.id, secondUser.id), undefined);
  assert.equal(
    todoDB.updateForUser(
      created.id,
      secondUser.id,
      { title: 'Unauthorized change' },
      '2030-01-01T00:00:00.000Z',
    ),
    undefined,
  );

  const updated = todoDB.updateForUser(
    created.id,
    firstUser.id,
    { title: 'Review the PRP', priority: 'high', completed: true },
    '2030-01-01T00:00:00.000Z',
  );
  assert.equal(updated?.title, 'Review the PRP');
  assert.equal(updated?.priority, 'high');
  assert.equal(updated?.completed, true);
  assert.equal(todoDB.deleteForUser(created.id, secondUser.id), false);
  assert.equal(todoDB.deleteForUser(created.id, firstUser.id), true);
  assert.equal(todoDB.findByIdForUser(created.id, firstUser.id), undefined);
});

test('todo creation enforces the user foreign key', () => {
  assert.throws(
    () => todoDB.create({ user_id: 999, title: 'No matching user' }),
    /FOREIGN KEY constraint failed/,
  );
});

test('deleting a todo cascades to subtasks and tag associations, not the tag', () => {
  const user = userDB.create('cascade-user');
  const todo = todoDB.create({ user_id: user.id, title: 'Cascade test' });
  const db = getDB();
  const tag = db
    .prepare('INSERT INTO tags (user_id, name) VALUES (?, ?) RETURNING id')
    .get(user.id, 'cascade-tag');
  db.prepare('INSERT INTO subtasks (todo_id, title) VALUES (?, ?)')
    .run(todo.id, 'Cascade subtask');
  db.prepare('INSERT INTO todo_tags (todo_id, tag_id) VALUES (?, ?)')
    .run(todo.id, tag.id);

  assert.equal(todoDB.deleteForUser(todo.id, user.id), true);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM subtasks WHERE todo_id = ?')
      .get(todo.id).count,
    0,
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM todo_tags WHERE todo_id = ?')
      .get(todo.id).count,
    0,
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM tags WHERE id = ?')
      .get(tag.id).count,
    1,
  );
});
