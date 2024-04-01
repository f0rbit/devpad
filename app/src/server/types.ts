import { z } from "zod";

export const upsert_user = z.object({
	project_id: z.string(),
	owner_id: z.string(),
	name: z.string(),
	description: z.string(),
	specification: z.string().optional().nullable(),
	repo_url: z.string().optional().nullable(),
	icon_url: z.string().optional().nullable(),
	status: z.union([ z.literal("DEVELOPMENT"), z.literal("PAUSED"), z.literal("RELEASED"), z.literal("LIVE"), z.literal("FINISHED"), z.literal("ABANDONED"), z.literal("STOPPED") ]),
	deleted: z.boolean().optional().nullable().default(false),
	link_url: z.string().optional().nullable(),
	link_text: z.string().optional().nullable(),
	visibility: z.union([ z.literal("PUBLIC"), z.literal("PRIVATE"), z.literal("HIDDEN"), z.literal("ARCHIVED"), z.literal("DRAFT"), z.literal("DELETED") ]),
	current_version: z.string().optional()
});


export type UpsertUser = z.infer<typeof upsert_user>;
