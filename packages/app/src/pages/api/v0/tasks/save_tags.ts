import { z } from "zod";
import { upsert_tag } from "../../../../server/types";
import type { APIContext } from "astro";
import { upsertTag } from "../../../../server/tags";
import { getAuthedUser } from "../../../../server/keys";
import { db, tag } from "@devpad/schema/database";
import { inArray } from "drizzle-orm";

const upsert_tags = z.array(upsert_tag);

export async function PATCH(context: APIContext) {
	const { user_id, error } = await getAuthedUser(context);
	if (error) {
		return new Response(error, { status: 401 });
	}
	if (!user_id) {
		return new Response(null, { status: 401 });
	}

	const body = await context.request.json();

	const parsed = upsert_tags.safeParse(body);
	if (!parsed.success) {
		console.warn(parsed.error);
		return new Response(parsed.error.message, { status: 400 });
	}

	const { data } = parsed;

	// Ensure all tags belong to the authenticated user
	for (const tag_data of data) {
		if (tag_data.owner_id !== user_id) {
			return new Response("Unauthorized: owner_id mismatch", { status: 401 });
		}
	}

	try {
		// Use promises to upsert tags
		const promises = data.map(upsertTag);
		const tag_ids = await Promise.all(promises);

		if (tag_ids.length != data.length) {
			throw new Error(`Tag upsert returned incorrect rows (${tag_ids.length})`);
		}

		// Fetch the full tag objects to return complete data
		const full_tags = await db.select().from(tag).where(inArray(tag.id, tag_ids));

		return new Response(JSON.stringify(full_tags), { status: 200 });
	} catch (err) {
		console.error("Error saving tags:", err);
		return new Response("Error saving tags", { status: 500 });
	}
}