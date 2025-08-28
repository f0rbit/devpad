import { z } from 'zod';
import type { project, task } from '../../../database/schema';

export const ProjectStatus = z.enum(['DEVELOPMENT', 'PAUSED', 'RELEASED', 'LIVE', 'FINISHED', 'ABANDONED', 'STOPPED']);
export const Visibility = z.enum(['PUBLIC', 'PRIVATE', 'HIDDEN', 'ARCHIVED', 'DRAFT', 'DELETED']);
export const Priority = z.enum(['LOW', 'MEDIUM', 'HIGH']);

export const BaseEntitySchema = z.object({
  id: z.string(),
  created_at: z.string().optional(),
  updated_at: z.string().optional()
});

export type ProjectStatus = z.infer<typeof ProjectStatus>;
export type Visibility = z.infer<typeof Visibility>;
export type Priority = z.infer<typeof Priority>;

export type SelectProject = typeof project.$inferSelect;
export type InsertProject = typeof project.$inferInsert;

export type SelectTask = typeof task.$inferSelect;
export type InsertTask = typeof task.$inferInsert;

// Import schemas from the source of truth
export { upsert_project as UpsertProjectSchema, upsert_todo as UpsertTaskSchema, upsert_tag as UpsertTagSchema } from '../../../src/server/types';

// Import base types and make them more API-wrapper friendly
import type { UpsertProject as _UpsertProject, UpsertTodo as _UpsertTodo, UpsertTag as _UpsertTag } from '../../../src/server/types';

// Make API wrapper types more permissive - all fields optional except required ones
export type UpsertProject = Partial<_UpsertProject>;
export type UpsertTask = Partial<_UpsertTodo> & { owner_id: string }; // owner_id is required
export type UpsertTag = Partial<_UpsertTag> & { owner_id: string; title: string }; // owner_id and title are required