import type { Todo } from './db';
import type { TodoExport, TodoExportItem } from './todoImport';

export function toTodoExportItem(todo: Todo): TodoExportItem {
  return {
    title: todo.title,
    completed: todo.completed,
    due_date: todo.due_date,
    priority: todo.priority,
    is_recurring: todo.is_recurring,
    recurrence_pattern: todo.recurrence_pattern,
    reminder_minutes: todo.reminder_minutes,
    created_at: todo.created_at,
    subtasks: todo.subtasks.map(({ title, completed, position }) => ({
      title,
      completed,
      position,
    })),
    tags: todo.tags.map(({ name, color }) => ({ name, color })),
  };
}

export function createTodoExport(
  todos: Todo[],
  exportedAt: Date,
): TodoExport {
  if (!Number.isFinite(exportedAt.getTime())) {
    throw new RangeError('Export time must be a valid date');
  }

  return {
    version: 1,
    exported_at: exportedAt.toISOString(),
    todos: todos.map(toTodoExportItem),
  };
}

function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function serializeTodosCsv(todos: Todo[]): string {
  const header = [
    'ID',
    'Title',
    'Completed',
    'Due Date',
    'Priority',
    'Recurring',
    'Pattern',
    'Reminder',
  ];
  const rows = todos.map((todo) =>
    [
      todo.id,
      todo.title,
      todo.completed,
      todo.due_date ?? '',
      todo.priority,
      todo.is_recurring,
      todo.recurrence_pattern ?? '',
      todo.reminder_minutes ?? '',
    ].map((value) => escapeCsvField(String(value))),
  );

  return [header, ...rows].map((row) => row.join(',')).join('\r\n') + '\r\n';
}
