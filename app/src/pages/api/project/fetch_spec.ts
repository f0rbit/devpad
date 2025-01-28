import type { APIContext } from "astro";
import { getSpecification } from "../../../server/github";
import { getProjectById } from "../../../server/projects";


export async function GET(context: APIContext) {
  // first we need to validate that the user is logged in
  if (!context.locals.user) {
    return new Response(null, { status: 401 });
  }

  // project_id is in the query params
  const project_id = context.url.searchParams.get("project_id");

  if (!project_id) {
    return new Response(null, { status: 400 });
  }

  try {
    const { project, error } = await getProjectById(project_id);
    if (error) throw new Error(error);
    if (!project) throw new Error("Project not found");
    const repo_url = project.repo_url;
    if (!repo_url) throw new Error("Project has no repo_url");
    const slices = repo_url.split("/");
    const repo = slices.at(-1);
    const owner = slices.at(-2);
    if (!repo || !owner) throw new Error("Invalid repo_url");
    const readme = await getSpecification(owner, repo, context.locals.session!.access_token);
    return new Response(readme);
  } catch (err) {
    console.error(`fetch_spec: `, err);
    return new Response(null, { status: 500 });
  }
}


