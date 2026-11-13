import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePriority } from '../lib/priority.ts';
import { sortTodos, sectionTodos } from '../lib/todoSort.ts';

function todo(id, { priority = 'medium', due_date = null, created_at = '2030-01-01T00:00:00Z', completed = false, updated_at = null } = {}) {
  return {
    id,
    user_id: 1,
    title: `Todo ${id}`,
    completed,
    due_date,
    priority,
    is_recurring: false,
    recurrence_pattern: null,
    reminder_minutes: null,
    last_notification_sent: null,
    created_at,
    updated_at,
    subtasks: [],
    tags: [],
  };
}

test('priority validation defaults missing values and accepts the three levels', () => {
  assert.equal(validatePriority(undefined), 'medium');
  assert.equal(validatePriority(null), 'medium');
  assert.deepEqual(
    ['high', 'medium', 'low'].map(validatePriority),
    ['high', 'medium', 'low'],
  );
});

test('priority validation rejects invalid and case-mismatched values', () => {
  for (const value of ['urgent', '', 'HIGH', 1, false]) {
    assert.throws(() => validatePriority(value), /Invalid priority/);
  }
});

test('sorts by priority, due date, and creation time without mutating input', () => {
  const input = [
    todo(1, { priority: 'low', due_date: null }),
    todo(2, { priority: 'medium', due_date: '2030-01-03T00:00:00Z' }),
    todo(3, { priority: 'high', due_date: '2030-01-02T00:00:00Z' }),
    todo(4, { priority: 'high', due_date: '2030-01-01T00:00:00Z' }),
    todo(5, { priority: 'medium', due_date: '2030-01-01T00:00:00Z' }),
    todo(6, { priority: 'high', due_date: '2030-01-01T00:00:00Z', created_at: '2030-01-02T00:00:00Z' }),
  ];

  assert.deepEqual(sortTodos(input).map(({ id }) => id), [6, 4, 3, 5, 2, 1]);
  assert.deepEqual(input.map(({ id }) => id), [1, 2, 3, 4, 5, 6]);
});

test('sections at the due-time boundary and sorts completed by latest update', () => {
  const now = new Date('2030-01-01T00:00:00Z');
  const rows = [
    todo(1, { due_date: '2029-12-31T23:59:59Z' }),
    todo(2, { due_date: '2030-01-01T00:00:00Z' }),
    todo(3, { due_date: null }),
    todo(4, { completed: true, due_date: '2029-12-31T00:00:00Z', updated_at: '2030-01-01T00:00:02Z' }),
    todo(5, { completed: true, updated_at: '2030-01-01T00:00:01Z' }),
  ];

  const sections = sectionTodos(rows, now);
  assert.deepEqual(sections.overdue.map(({ id }) => id), [1]);
  assert.deepEqual(sections.pending.map(({ id }) => id), [2, 3]);
  assert.deepEqual(sections.completed.map(({ id }) => id), [4, 5]);
});
