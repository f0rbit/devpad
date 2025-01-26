// the AUTH_KEY should be in the headers of the request
// this endpoint is a GET request that accepts some optional query params
// ?id=<project_uuid>
// ?name=<project_name>
// this is a astro api endpoint
import type { APIContext } from "astro";
import { getProject, getProjectById, getUserProjects } from "../../../server/projects";
import { getAuthedUser } from "../../../server/keys";

export async function GET(context: APIContext) {
  const { user_id, error } = await getAuthedUser(context);
  if (error) {
    return new Response(error, { status: 401 });
  }
  if (!user_id) {
    return new Response(null, { status: 401 });
  }

  // extract the query params from the request
  const query = context.url.searchParams;

  // extract the project id from the query params
  const id = query.get("id");
  const name = query.get("name");

  if (id) {
    // get the project by id
    const { project, error } = await getProjectById(id);
    if (error) {
      if (error == "Couldn't find project") {
        return new Response(null, { status: 404 });
      }
      return new Response(error, { status: 500 });
    }
    if (!project) {
      return new Response(null, { status: 404 });
    }
    if (project.owner_id != user_id) {
      return new Response(null, { status: 401 });
    }
    return new Response(JSON.stringify(project));
  }

  if (name) {
    // get the project by name
    const { project, error } = await getProject(user_id, name);
    if (error) {
      if (error == "Couldn't find project") {
        return new Response(null, { status: 404 });
      }
      return new Response(error, { status: 401 });
    }
    if (!project) {
      return new Response(null, { status: 404 });
    }
    return new Response(JSON.stringify(project));
  }

  // no query params provided
  // return all projects
  console.log("user_id", user_id);
  const projects = await getUserProjects(user_id);

  // should only show 'public' projects
  const public_projects = projects.filter((project) => project.visibility == "PUBLIC");
  return new Response(JSON.stringify(public_projects));
}

