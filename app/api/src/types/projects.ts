import { z } from 'zod';
import { BaseEntitySchema, Visibility } from './common';

export const ProjectStatus = z.enum(['DEVELOPMENT', 'PAUSED', 'RELEASED', 'LIVE', 'FINISHED', 'ABANDONED', 'STOPPED']);

export const ProjectSchema = BaseEntitySchema.extend({
  project_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  specification: z.string().nullable(),
  repo_url: z.string().nullable(),
  repo_id: z.number().nullable(),
  icon_url: z.string().nullable(),
  status: ProjectStatus,
  deleted: z.boolean(),
  link_url: z.string().nullable(),
  link_text: z.string().nullable(),
  current_version: z.string().nullable(),
  scan_branch: z.string().nullable(),
  visibility: Visibility,
});

export type Project = z.infer<typeof ProjectSchema>;

export const ProjectListResponseSchema = z.array(ProjectSchema);
export const ProjectDetailResponseSchema = ProjectSchema;