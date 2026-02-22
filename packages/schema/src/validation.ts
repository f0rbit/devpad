import { z } from "zod";

export const upsert_project = z.object({
	id: z.string().optional().nullable(),
	project_id: z.string(),
	owner_id: z.string().optional(),
	name: z.string(),
	description: z.string().nullable(),
	specification: z.string().nullable(),
	repo_url: z.string().nullable(),
	repo_id: z.number().nullable(),
	icon_url: z.string().nullable(),
	status: z.union([z.literal("DEVELOPMENT"), z.literal("PAUSED"), z.literal("RELEASED"), z.literal("LIVE"), z.literal("FINISHED"), z.literal("ABANDONED"), z.literal("STOPPED")]).optional(),
	deleted: z.boolean().optional().default(false),
	link_url: z.string().nullable(),
	link_text: z.string().nullable(),
	visibility: z.union([z.literal("PUBLIC"), z.literal("PRIVATE"), z.literal("HIDDEN"), z.literal("ARCHIVED"), z.literal("DRAFT"), z.literal("DELETED")]).optional(),
	current_version: z.string().nullable(),
	force: z.boolean().optional().describe("Override protection on user-modified entities"),
});

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
	goal_id: z.string().optional().nullable(),
	force: z.boolean().optional().describe("Override protection on user-modified entities"),
});

export const update_action = z.union([z.literal("CONFIRM"), z.literal("UNLINK"), z.literal("CREATE"), z.literal("IGNORE"), z.literal("DELETE"), z.literal("COMPLETE")]);

export const upsert_tag = z.object({
	id: z.string().optional(),
	title: z.string(),
	color: z
		.union([z.literal("red"), z.literal("green"), z.literal("blue"), z.literal("yellow"), z.literal("purple"), z.literal("orange"), z.literal("teal"), z.literal("pink"), z.literal("gray"), z.literal("cyan"), z.literal("lime")])
		.nullable()
		.optional(),
	deleted: z.boolean().optional().default(false),
	render: z.boolean().optional().default(true),
	owner_id: z.string(),
});

export const project_config = z.object({
	tags: z.array(
		z.object({
			name: z.string(),
			match: z.array(z.string()),
		})
	),
	ignore: z.array(z.string()),
});

export const save_config_request = z.object({
	id: z.string(),
	config: project_config,
	scan_branch: z.string().optional(),
});

export const save_tags_request = z.array(upsert_tag);

export const update_user = z.object({
	id: z.string(),
	name: z.string().optional(),
	image_url: z.string().optional(),
	task_view: z.union([z.literal("list"), z.literal("grid")]).optional(),
	email_verified: z.boolean().optional(),
});

export const config_schema = z.object({
	tags: z.array(
		z.object({
			name: z.string(),
			match: z.array(z.string()),
		})
	),
	ignore: z.array(z.string().regex(/^[^]*$/, "Invalid path")),
});

export const upsert_milestone = z.object({
	id: z.string().optional().nullable(),
	project_id: z.string(),
	name: z.string().min(1).max(200),
	description: z.string().nullable().optional(),
	target_time: z.string().nullable().optional(),
	target_version: z.string().nullable().optional(),
	finished_at: z.string().nullable().optional(),
	after_id: z.string().nullable().optional(),
	force: z.boolean().optional().describe("Override protection on user-modified entities"),
});

export const upsert_goal = z.object({
	id: z.string().optional().nullable(),
	milestone_id: z.string(),
	name: z.string().min(1).max(200),
	description: z.string().nullable().optional(),
	target_time: z.string().nullable().optional(),
	finished_at: z.string().nullable().optional(),
	force: z.boolean().optional().describe("Override protection on user-modified entities"),
});
