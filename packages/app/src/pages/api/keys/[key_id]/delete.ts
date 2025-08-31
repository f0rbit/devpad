import { api_key, db } from "@devpad/schema/database";
import type { APIContext } from "astro";
import { eq } from "drizzle-orm";

export async function DELETE(context: APIContext) {
	if (!context.locals.user) {
		return new Response(null, { status: 401 });
	}

	// check that user owns the key in [key_id]
	const key_id = context.params.key_id;
	if (!key_id) {
		return new Response(null, { status: 400 });
	}

	const key = await db.select().from(api_key).where(eq(api_key.id, key_id));
	if (key.length !== 1) {
		return new Response(null, { status: 404 });
	}
	if (key[0].owner_id !== context.locals.user.id) {
		return new Response(null, { status: 403 });
	}

	// delete the key
	const deleted_key = await db.delete(api_key).where(eq(api_key.id, key_id)).returning();
	if (deleted_key.length !== 1) {
		throw new Error(`API key deletion returned incorrect rows (${deleted_key.length}`);
	}

	return new Response(JSON.stringify(deleted_key[0]));
}
