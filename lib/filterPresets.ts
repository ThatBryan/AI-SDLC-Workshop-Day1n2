import { z } from 'zod';
import type { FilterState } from './filters';

export const PRESETS_KEY = 'todo-app:filter-presets';

const filterSchema = z.object({
  search: z.string(),
  priority: z.enum(['all', 'high', 'medium', 'low']),
  tagId: z.union([z.literal('all'), z.number().int().positive().safe()]),
  completion: z.enum(['all', 'incomplete', 'completed']),
  dueDateFrom: z.iso.date().nullable(),
  dueDateTo: z.iso.date().nullable(),
});

const presetsSchema = z.array(z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  filters: filterSchema,
  createdAt: z.iso.datetime({ offset: true }),
}));

export interface FilterPreset {
  id: string;
  name: string;
  filters: FilterState;
  createdAt: string;
}

export function loadPresets(onError?: (error: unknown) => void): FilterPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (!raw) return [];
    return presetsSchema.parse(JSON.parse(raw));
  } catch (error) {
    console.error('Failed to load filter presets:', error);
    onError?.(error);
    return [];
  }
}

export function writePresets(presets: FilterPreset[]): void {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}
