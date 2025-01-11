import { z } from "zod";
import type { ActionType, action, todo_updates, tracker_result } from "../../database/schema";
import type { Task } from "./tasks";
import ScanText from "lucide-solid/icons/scan-text";

export const upsert_project = z.object({
  id: z.string().optional().nullable(),
  project_id: z.string(),
  owner_id: z.string(),
  name: z.string(),
  description: z.string(),
  specification: z.string().optional().nullable(),
  repo_url: z.string().optional().nullable(),
  repo_id: z.number().optional().nullable(),
  icon_url: z.string().optional().nullable(),
  status: z.union([z.literal("DEVELOPMENT"), z.literal("PAUSED"), z.literal("RELEASED"), z.literal("LIVE"), z.literal("FINISHED"), z.literal("ABANDONED"), z.literal("STOPPED")]),
  deleted: z.boolean().optional().nullable().default(false),
  link_url: z.string().optional().nullable(),
  link_text: z.string().optional().nullable(),
  visibility: z.union([z.literal("PUBLIC"), z.literal("PRIVATE"), z.literal("HIDDEN"), z.literal("ARCHIVED"), z.literal("DRAFT"), z.literal("DELETED")]),
  current_version: z.string().optional()
});


export type UpsertProject = z.infer<typeof upsert_project>;


export const upsert_todo = z.object({
  id: z.string().optional().nullable(),
  title: z.string().optional(),
  summary: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  progress: z.union([z.literal("UNSTARTED"), z.literal("IN_PROGRESS"), z.literal("COMPLETED")]).optional(),
  visibility: z.union([z.literal("PUBLIC"), z.literal("PRIVATE"), z.literal("HIDDEN"), z.literal("ARCHIVED"), z.literal("DRAFT"), z.literal("DELETED")]).optional(),
  start_time: z.string().optional().nullable(),
  end_time: z.string().optional().nullable(),
  priority: z.union([z.literal("LOW"), z.literal("MEDIUM"), z.literal("HIGH")]).optional(),
  owner_id: z.string(),
  project_id: z.string().optional().nullable(),
});

export type UpsertTodo = z.infer<typeof upsert_todo>;


export type UpdateData = {
  id: string;
  tag: "todo" | "bug" | "note" | "error";
  type: "SAME" | "UPDATE" | "DELETE" | "NEW" | "MOVE";
  data: {
    old: {
      text: string,
      line: number,
      file: string,
      context?: string[]
    },
    new: {
      text: string,
      line: number,
      file: string,
      context?: string[]
    }
  };
  task?: Task;
}

export type TodoUpdate = typeof todo_updates.$inferSelect;
export type TrackerResult = typeof tracker_result.$inferSelect;

export const ConfigSchema = z.object({
  tags: z.array(
    z.object({
      name: z.string(),
      match: z.array(z.string()),
    })
  ),
  ignore: z.array(z.string().regex(/^[^]*$/, "Invalid path")),
});

export const upsert_tag = z.object({
  id: z.string().optional(),
  title: z.string(),
  color: z.string(),
  deleted: z.boolean().optional().default(false),
  owner_id: z.string(),
});

export type UpsertTag = z.infer<typeof upsert_tag>;

export const update_user = z.object({
  id: z.string(),
  name: z.string().optional(),
  image_url: z.string().optional(),
  task_view: z.union([z.literal("list"), z.literal("grid")]).optional(),
  email_verified: z.boolean().optional(),
});

export type UpdateUser = z.infer<typeof update_user>;

export type TaskView = NonNullable<UpdateUser['task_view']>;


export type HistoryAction = Omit<typeof action.$inferSelect, "updated_at" | "owner_id" | "type"> & { type: ActionType | "SCAN" }
