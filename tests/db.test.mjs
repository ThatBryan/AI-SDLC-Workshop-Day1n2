import assert from 'node:assert/strict';
import test from 'node:test';

process.env.TODO_DB_PATH = ':memory:';

const { todoDB, userDB } = await import('../lib/db.ts');

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
