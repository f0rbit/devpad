// the AUTH_KEY should be in the headers of the request
// this endpoint is a GET request that accepts some optional query params
// ?id=<project_uuid>
// ?name=<project_name>
// this is a astro api endpoint
import type { APIContext } from "astro";
import { getUserByAPIKey } from "../../../server/keys";
import { getProject, getProjectById, getUserProjects } from "../../../server/projects";

async function getAuthedUser(request: APIContext): Promise<{ user_id: string, error: null } | { user_id: null, error: string }> {
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
      return new Response(error, { status: 401 });
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
  return new Response(JSON.stringify(public_projects, null, 2));
}

