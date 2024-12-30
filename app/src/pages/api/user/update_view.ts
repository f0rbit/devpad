import type { APIContext } from "astro";
import { update_user } from "../../../server/types";
import { db } from "../../../../database/db";
import { user } from "../../../../database/schema";
import { eq } from "drizzle-orm";


export async function PATCH(context: APIContext) {
  const ctx_user = context.locals.user;
  if (!ctx_user) {
    return new Response(null, { status: 401 });
  }

  const body = await context.request.json();

  const parsed = update_user.safeParse(body);
  if (!parsed.success) {
    console.warn(parsed.error);
    return new Response(parsed.error.message, { status: 400 });
  }

  const { data } = parsed;

  // check that logged in user == data.id
  if (ctx_user.id !== data.id) {
    return new Response(null, { status: 403 });
  }

  let task_view = data?.task_view;
  if (!task_view) {
    return new Response(null, { status: 400 });
  }

  try {
    await db.update(user).set({ task_view }).where(eq(user.id, data.id));

    return new Response(JSON.stringify(data), { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response(null, { status: 500 });
  }
}
