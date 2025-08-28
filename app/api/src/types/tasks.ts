import { z } from 'zod';
import { BaseEntitySchema, Visibility, Priority } from './common';

export const TaskSchema = BaseEntitySchema.extend({
  title: z.string(),
  project_id: z.string().nullable(),
  owner_id: z.string(),
  description: z.string().nullable(),
  start_time: z.string().nullable(),
  end_time: z.string().nullable(),
  progress: z.enum(['UNSTARTED', 'IN_PROGRESS', 'COMPLETED']),
  visibility: Visibility,
  priority: Priority,
  goal_id: z.string().nullable(),
  codebase_task_id: z.string().nullable(),
  summary: z.string().nullable()
});

export const CodebaseTaskSchema = z.object({
  id: z.string(),
  branch: z.string().nullable(),
  commit_sha: z.string().nullable(),
  commit_msg: z.string().nullable(),
  commit_url: z.string().nullable(),
  type: z.string().nullable(),
  text: z.string().nullable(),
  file: z.string().nullable(),
  line: z.number().nullable(),
  context: z.array(z.string()).nullable(),
  deleted: z.boolean().nullable(),
  recent_scan_id: z.number().nullable()
});

export const TaskUnionSchema = z.object({
  task: TaskSchema,
  codebase_tasks: CodebaseTaskSchema.nullable(),
  tags: z.array(z.string())
});

export type Task = z.infer<typeof TaskSchema>;
export type CodebaseTask = z.infer<typeof CodebaseTaskSchema>;
export type TaskUnion = z.infer<typeof TaskUnionSchema>;

export const TaskListResponseSchema = z.array(TaskUnionSchema);
export const TaskDetailResponseSchema = TaskUnionSchema;