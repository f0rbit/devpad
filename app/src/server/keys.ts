import { eq } from "drizzle-orm";
import { db } from "../../database/db";
import { api_key } from "../../database/schema";

export async function getAPIKeys(user_id: string) {
	return await db.select().from(api_key).where(eq(api_key.owner_id, user_id));
}
