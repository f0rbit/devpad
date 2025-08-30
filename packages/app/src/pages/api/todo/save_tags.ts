import { z } from "zod";
import { upsert_tag } from "../../../server/types";
import type { APIContext } from "astro";
import { upsertTag } from "../../../server/tags";

const upsert_tags = z.array(upsert_tag);

// upsert tags endpoint
export async function PATCH(context: APIContext) {
	const user = context.locals.user;
	if (!user) {
		return new Response(null, { status: 401 });
	}

	const body = await context.request.json();

	const parsed = upsert_tags.safeParse(body);
	if (!parsed.success) {
		console.warn(parsed.error);
		return new Response(parsed.error.message, { status: 400 });
	}

	const { data } = parsed;

	// TODO: check if the user owns the the tag
	// TODO: check if the tag is different, and then set updated_at to CURRENT_TIMESTAMP

	try {
		// use promises to upsert tags
		const promises = data.map(upsertTag);
		const new_tags = await Promise.all(promises);

		if (new_tags.length != data.length) throw new Error(`Tag upsert returned incorrect rows (${new_tags.length})`);

		return new Response(JSON.stringify(new_tags), { status: 200 });
	} catch (err) {
		console.error(err);
		return new Response(null, { status: 500 });
	}
}
