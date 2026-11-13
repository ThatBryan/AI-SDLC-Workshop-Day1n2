import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseTodoImport,
  todoImportSchema,
} from '../lib/todoImport.ts';
import {
  createTodoExport,
  serializeTodosCsv,
  toTodoExportItem,
} from '../lib/todoExport.ts';

const validPayload = {
  version: 1,
  exported_at: '2026-03-01T00:30:00.000Z',
  todos: [
    {
      title: 'Planning',
      completed: false,
      due_date: '2026-03-01T00:30',
      priority: 'high',
      is_recurring: false,
      recurrence_pattern: null,
      reminder_minutes: null,
      created_at: '2026-02-01T10:00:00.000Z',
      subtasks: [{ title: 'Outline', completed: false, position: 0 }],
      tags: [{ name: 'Work', color: '#3B82F6' }],
    },
  ],
};

function makeTodo(overrides = {}) {
  return {
    id: 12,
    user_id: 7,
    title: 'A title, with "quotes"\nand a line',
    completed: false,
    due_date: null,
    priority: 'medium',
    is_recurring: false,
    recurrence_pattern: null,
    reminder_minutes: null,
    last_notification_sent: '2026-01-01T00:00:00.000Z',
    created_at: '2026-02-01T10:00:00.000Z',
    updated_at: '2026-02-02T10:00:00.000Z',
    subtasks: [
      {
        id: 51,
        todo_id: 12,
        title: 'Subtask',
        completed: true,
        position: 0,
        created_at: '2026-02-01T10:00:00.000Z',
      },
    ],
    tags: [
      {
        id: 71,
        user_id: 7,
        name: 'Personal',
        color: '#123456',
        created_at: '2026-02-01T10:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

test('accepts a valid version 1 export with Singapore-local due date values', () => {
  assert.equal(todoImportSchema.safeParse(validPayload).success, true);
  const parsed = parseTodoImport(validPayload);

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.todos[0].due_date, '2026-03-01T00:30');
    assert.deepEqual(parsed.data.todos[0].subtasks[0], {
      title: 'Outline',
      completed: false,
      position: 0,
    });
  }
});

test('accepts an empty todo list as a valid import', () => {
  assert.deepEqual(
    parseTodoImport({ ...validPayload, todos: [] }),
    {
      success: true,
      data: { ...validPayload, todos: [] },
    },
  );
});

test('rejects unknown keys, missing fields, wrong enums, and malformed dates', () => {
  assert.equal(parseTodoImport({ ...validPayload, extra: true }).success, false);
  assert.equal(parseTodoImport({ version: 1, exported_at: validPayload.exported_at }).success, false);
  assert.equal(
    parseTodoImport({
      ...validPayload,
      todos: [{ ...validPayload.todos[0], priority: 'urgent' }],
    }).success,
    false,
  );
  assert.equal(
    parseTodoImport({
      ...validPayload,
      todos: [{ ...validPayload.todos[0], due_date: '2026-02-30T12:00' }],
    }).success,
    false,
  );
  assert.equal(
    parseTodoImport({
      ...validPayload,
      todos: [{ ...validPayload.todos[0], tags: [{ name: '', color: 'red' }] }],
    }).success,
    false,
  );
});

test('returns a generic import format error instead of leaking schema details', () => {
  const parsed = parseTodoImport({ version: 2 });

  assert.deepEqual(parsed, {
    success: false,
    error: 'Failed to import todos. Please check the file format.',
  });
});

test('projects only export-safe todo, subtask, and tag fields', () => {
  const projected = toTodoExportItem(makeTodo());

  assert.deepEqual(projected, {
    title: 'A title, with "quotes"\nand a line',
    completed: false,
    due_date: null,
    priority: 'medium',
    is_recurring: false,
    recurrence_pattern: null,
    reminder_minutes: null,
    created_at: '2026-02-01T10:00:00.000Z',
    subtasks: [{ title: 'Subtask', completed: true, position: 0 }],
    tags: [{ name: 'Personal', color: '#123456' }],
  });
});

test('creates a versioned JSON envelope with a stable UTC instant', () => {
  assert.deepEqual(
    createTodoExport([makeTodo()], new Date('2026-03-01T00:30:00.000Z')),
    {
      version: 1,
      exported_at: '2026-03-01T00:30:00.000Z',
      todos: [toTodoExportItem(makeTodo())],
    },
  );
  assert.throws(
    () => createTodoExport([], new Date(Number.NaN)),
    /valid date/,
  );
});

test('serializes CSV with fixed columns and RFC 4180 quoting', () => {
  const csv = serializeTodosCsv([makeTodo()]);

  assert.equal(
    csv,
    'ID,Title,Completed,Due Date,Priority,Recurring,Pattern,Reminder\r\n' +
      '12,"A title, with ""quotes""\nand a line",false,,medium,false,,\r\n',
  );
});
