import { eq } from "drizzle-orm";
import { db } from "../../database/db";
import { api_key } from "../../database/schema";

export async function getAPIKeys(user_id: string) {
  return await db.select().from(api_key).where(eq(api_key.owner_id, user_id));
}

export async function getUserByAPIKey(key: string): Promise<{ user_id: string, error: null } | { user_id: null, error: string }> {
  const user = await db.select().from(api_key).where(eq(api_key.hash, key));
  if (!user) {
    return { user_id: null, error: "Invalid API key" };
  }
  if (user.length > 1) {
    return { user_id: null, error: "Multiple users with same API key" };
  }
  return { user_id: user[0].owner_id!, error: null };
}
