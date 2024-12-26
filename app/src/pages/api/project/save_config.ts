import type { APIContext } from "astro";
import { z } from "zod";
import { project } from "../../../../database/schema";
import { db } from "../../../../database/db";
import { eq } from "drizzle-orm";
import { ConfigSchema } from "../../../server/types";
import { getProjectById } from "../../../server/projects";



const schema = z.object({
    id: z.string(),
    config: ConfigSchema
});

export async function PATCH(context: APIContext) {
    // first we need to validate that the user is logged in
    if (!context.locals.user) {
        return new Response(null, { status: 401 });
    }

    // extract the form contents from the input
    const body = await context.request.json();

    // validate project contents using zod & return error if anything missing
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
        console.warn(parsed.error);
        return new Response(parsed.error.message, { status: 400 });
    }
    const { data } = parsed;

    // fetch the project to get the owner_id && assert that the owner_id == logged in user
    const { project: found, error } = await getProjectById(data.id);
    if (error) return new Response(error, { status: 500 });
    if (!found) return new Response("Project not found", { status: 404 });
    if (found.owner_id != context.locals.user.id) return new Response("Unauthorized", { status: 401 });

    try {
        const values = { id: data.id, config_json: data.config };
        // perform db update
        const new_project = await db.update(project).set(values).where(eq(project.id, data.id)).returning();

        if (new_project.length != 1) throw new Error(`Project upsert returned incorrect rows (${new_project.length}`);

        // return the project data
        return new Response(JSON.stringify(new_project[0]));
    } catch (err) {
        console.error(err);
        return new Response(null, { status: 500 });
    }
    
}
