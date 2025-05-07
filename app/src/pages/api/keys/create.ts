import type { APIContext } from "astro";
import { randomBytes } from "crypto";
import { api_key } from "../../../../database/schema";
import { db } from "../../../../database/db";

function getKey(size = 32, format: BufferEncoding = "hex") {
	return randomBytes(size).toString(format);
}

// we want a POST request handler to generate a random key
export async function POST(context: APIContext) {
	try {
		if (!context.locals.user) {
			return new Response(null, { status: 401 });
		}

		const key = getKey();
		const new_key = await db.insert(api_key).values({ owner_id: context.locals.user.id, hash: key }).returning();
		if (new_key.length != 1) throw new Error(`API key generation returned incorrect rows (${new_key.length}`);

		return new Response(JSON.stringify(new_key[0]));
	} catch (e) {
		console.error(e);
		return new Response(null, { status: 500 });
	}
}
