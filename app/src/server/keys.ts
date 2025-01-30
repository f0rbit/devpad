import { eq } from "drizzle-orm";
import { db } from "../../database/db";
import { api_key } from "../../database/schema";
import type { APIContext } from "astro";

export async function getAPIKeys(user_id: string) {
  return await db.select().from(api_key).where(eq(api_key.owner_id, user_id));
}

export async function getUserByAPIKey(key: string): Promise<{ user_id: string, error: null } | { user_id: null, error: string }> {
  const user = await db.select().from(api_key).where(eq(api_key.hash, key));
  if (!user || user.length == 0) {
    return { user_id: null, error: "Invalid API key" };
  }
  if (user.length > 1) {
    return { user_id: null, error: "Multiple users with same API key" };
  }
  return { user_id: user[0].owner_id!, error: null };
}

export async function getAuthedUser(request: APIContext): Promise<{ user_id: string, error: null } | { user_id: null, error: string }> {
  // take the auth key from the headers
  // will be Authorization: Bearer <auth_key>
  const auth_key = request.request.headers.get("Authorization")?.split(" ")?.[1];
  if (!auth_key) {
    return { user_id: null, error: "No auth key provided" };
  }

  // check if the auth key is valid
  const found = await getUserByAPIKey(auth_key);
  return found;
}
