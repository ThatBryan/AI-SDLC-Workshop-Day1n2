import { beforeEach, describe, expect, it } from 'vitest';

process.env.TODO_DB_PATH = ':memory:';

const { getDB, tagDB, todoDB, userDB } = await import('../lib/db');

describe('tag database', () => {
  beforeEach(() => {
    getDB().exec('DELETE FROM users');
  });

  it('uses the default color and scopes unique names to each user', () => {
    const firstUser = userDB.create('first-tag-user');
    const secondUser = userDB.create('second-tag-user');
    const first = tagDB.create(firstUser.id, { name: 'Work' });
    const second = tagDB.create(secondUser.id, { name: 'Work' });

    expect(first.color).toBe('#3B82F6');
    expect(first.name).toBe('Work');
    expect(second.name).toBe('Work');
    expect(() => tagDB.create(firstUser.id, { name: 'Work' })).toThrow();
  });

  it('reflects tag updates on associated todos and hides tags from other users', () => {
    const owner = userDB.create('tag-owner');
    const otherUser = userDB.create('tag-other');
    const tag = tagDB.create(owner.id, { name: 'Old name', color: '#123456' });
    const todo = todoDB.create({
      user_id: owner.id,
      title: 'Tagged todo',
      tag_ids: [tag.id],
    });

    const updated = tagDB.update(tag.id, owner.id, {
      name: 'New name',
      color: '#ABCDEF',
    });

    expect(updated).toMatchObject({ name: 'New name', color: '#ABCDEF' });
    expect(todoDB.findByIdForUser(todo.id, owner.id)?.tags).toEqual([updated]);
    expect(tagDB.findById(tag.id, otherUser.id)).toBeUndefined();
    expect(tagDB.update(tag.id, otherUser.id, { name: 'Unauthorized' })).toBeUndefined();
    expect(tagDB.delete(tag.id, otherUser.id)).toBe(false);
    expect(tagDB.findAllByUser(otherUser.id)).toEqual([]);
  });

  it('attaches and detaches tags idempotently', () => {
    const user = userDB.create('tag-idempotency-user');
    const tag = tagDB.create(user.id, { name: 'Repeated' });
    const todo = todoDB.create({ user_id: user.id, title: 'Repeated attachment' });
    const db = getDB();

    tagDB.attachToTodo(todo.id, tag.id, user.id);
    tagDB.attachToTodo(todo.id, tag.id, user.id);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM todo_tags WHERE todo_id = ? AND tag_id = ?')
        .get(todo.id, tag.id),
    ).toEqual({ count: 1 });

    tagDB.detachFromTodo(todo.id, tag.id, user.id);
    tagDB.detachFromTodo(todo.id, tag.id, user.id);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM todo_tags WHERE todo_id = ? AND tag_id = ?')
        .get(todo.id, tag.id),
    ).toEqual({ count: 0 });
  });

  it('deleting a tag cascades only its associations', () => {
    const user = userDB.create('tag-cascade-user');
    const removedTag = tagDB.create(user.id, { name: 'Remove me' });
    const retainedTag = tagDB.create(user.id, { name: 'Keep me' });
    const firstTodo = todoDB.create({
      user_id: user.id,
      title: 'Has both tags',
      tag_ids: [removedTag.id, retainedTag.id],
    });
    const secondTodo = todoDB.create({
      user_id: user.id,
      title: 'Has removed tag only',
      tag_ids: [removedTag.id],
    });
    const db = getDB();

    expect(tagDB.delete(removedTag.id, user.id)).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS count FROM todo_tags WHERE tag_id = ?')
      .get(removedTag.id)).toEqual({ count: 0 });
    expect(todoDB.findByIdForUser(firstTodo.id, user.id)?.tags.map(({ id }) => id))
      .toEqual([retainedTag.id]);
    expect(todoDB.findByIdForUser(secondTodo.id, user.id)?.tags).toEqual([]);
    expect(tagDB.findById(retainedTag.id, user.id)).toMatchObject({ name: 'Keep me' });
  });

  it('deleting a todo cascades its tag associations but keeps the tags', () => {
    const user = userDB.create('todo-tag-cascade-user');
    const tag = tagDB.create(user.id, { name: 'Still available' });
    const todo = todoDB.create({
      user_id: user.id,
      title: 'Todo to remove',
      tag_ids: [tag.id],
    });

    expect(todoDB.deleteForUser(todo.id, user.id)).toBe(true);
    expect(getDB().prepare('SELECT COUNT(*) AS count FROM todo_tags WHERE todo_id = ?')
      .get(todo.id)).toEqual({ count: 0 });
    expect(tagDB.findById(tag.id, user.id)).toMatchObject({ name: 'Still available' });
  });
});
