import type { APIContext } from "astro";
import { upsert_project, type UpsertProject } from "../../../server/types";
import { db } from "../../../../database/db";
import { project } from "../../../../database/schema";
import { addProjectAction, getProjectById } from "../../../server/projects";
import { getSpecification } from "../../../server/github";

type CompleteUpsertProject = Omit<UpsertProject, "id"> & { id: string };

export async function PATCH(context: APIContext) {
  // first we need to validate that the user is logged in
  if (!context.locals.user) {
    return new Response(null, { status: 401 });
  }

  // extract the form contents from the input
  const body = await context.request.json();

  // validate project contents using zod & return error if anything missing
  const parsed = upsert_project.safeParse(body);
  if (!parsed.success) {
    console.warn(parsed.error);
    return new Response(parsed.error.message, { status: 400 });
  }
  const { data } = parsed;

  // assert that the owner_id of upsert_project is same as logged in user
  if (data.owner_id != context.locals.user.id) {
    return new Response(null, { status: 401 });
  }
  try {
    const previous = await (async () => {
      if (!data.id) return null;
      return (await getProjectById(data.id)).project ?? null;
    })();

    const exists = !!previous;

    const github_linked = (data.repo_id && data.repo_url) || (previous?.repo_id && previous.repo_url);
    const repo_url = data.repo_url ?? previous?.repo_url;
    const fetch_specification = (github_linked && repo_url) && (!previous || !previous.specification);

    // the new_project is imported from github and doesn't have a specification, import it from the README
    if (fetch_specification && !data.specification) {
      console.log(`Updating specification for project: ${data.project_id ?? previous?.project_id}`);
      // we need to get OWNER and REPO from the repo_url
      const slices = repo_url.split("/");
      const repo = slices.at(-1);
      const owner = slices.at(-2);
      if (!repo || !owner) throw new Error("Invalid repo_url");
      const readme = await getSpecification(owner, repo, context.locals.session!.access_token);
      data.specification = readme;
    }

    const insert = data as CompleteUpsertProject;

    // perform db upsert
    const new_project = await db.insert(project).values(insert).onConflictDoUpdate({ target: [project.id], set: insert }).returning();

    if (new_project.length != 1) throw new Error(`Project upsert returned incorrect rows (${new_project.length}`);

    const project_id = new_project[0].id;

    // TODO: for project updates, include the changes as a diff in the data
    if (!exists) {
      // add CREATE_PROJECT action
      await addProjectAction({ owner_id: data.owner_id, project_id, type: "CREATE_PROJECT", description: "Created project" });
    } else if (data.specification) {
      // add UPDATE_PROJECT action with 'updated specification' description
      await addProjectAction({ owner_id: data.owner_id, project_id, type: "UPDATE_PROJECT", description: "Updated specification" });
    } else {
      // add UPDATE_PROJECT action
      await addProjectAction({ owner_id: data.owner_id, project_id, type: "UPDATE_PROJECT", description: "Updated project settings" });
    }

    // return the project data
    return new Response(JSON.stringify(new_project[0]));
  } catch (err) {
    console.error(err);
    return new Response(null, { status: 500 });
  }
}
