import { z } from 'zod';
import type { Priority, RecurrencePattern } from './db';
import { parseSingaporeDateTime } from './timezone.ts';

const isoDateTimeSchema = z
  .string()
  .refine((value) => parseSingaporeDateTime(value) !== null);

const subtaskSchema = z
  .object({
    title: z.string().min(1),
    completed: z.boolean(),
    position: z.number().int(),
  })
  .strict();

const tagSchema = z
  .object({
    name: z.string().min(1),
    color: z.string(),
  })
  .strict();

export const todoExportItemSchema = z
  .object({
    title: z.string().min(1),
    completed: z.boolean(),
    due_date: isoDateTimeSchema.nullable(),
    priority: z.enum(['high', 'medium', 'low']),
    is_recurring: z.boolean(),
    recurrence_pattern: z.enum(['daily', 'weekly', 'monthly', 'yearly']).nullable(),
    reminder_minutes: z.number().int().nullable(),
    created_at: isoDateTimeSchema,
    subtasks: z.array(subtaskSchema),
    tags: z.array(tagSchema),
  })
  .strict();

export const todoImportSchema = z
  .object({
    version: z.literal(1),
    exported_at: isoDateTimeSchema,
    todos: z.array(todoExportItemSchema),
  })
  .strict();

export type TodoExportSubtask = {
  title: string;
  completed: boolean;
  position: number;
};

export type TodoExportTag = {
  name: string;
  color: string;
};

export type TodoExportItem = {
  title: string;
  completed: boolean;
  due_date: string | null;
  priority: Priority;
  is_recurring: boolean;
  recurrence_pattern: RecurrencePattern | null;
  reminder_minutes: number | null;
  created_at: string;
  subtasks: TodoExportSubtask[];
  tags: TodoExportTag[];
};

export type TodoExport = {
  version: 1;
  exported_at: string;
  todos: TodoExportItem[];
};

export type ImportTodoInput = TodoExportItem;

export const TODO_IMPORT_FORMAT_ERROR =
  'Failed to import todos. Please check the file format.';

export type TodoImportParseResult =
  | { success: true; data: TodoExport }
  | { success: false; error: string };

export function parseTodoImport(value: unknown): TodoImportParseResult {
  const parsed = todoImportSchema.safeParse(value);
  if (!parsed.success) {
    return { success: false, error: TODO_IMPORT_FORMAT_ERROR };
  }

  return { success: true, data: parsed.data };
}
