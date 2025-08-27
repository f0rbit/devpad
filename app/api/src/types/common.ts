import { z } from 'zod';
import type { project, task } from '@/database/schema.ts';

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