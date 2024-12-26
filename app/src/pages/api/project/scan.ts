import type { APIContext } from "astro";
import { db } from "../../../../database/db";
import { and, desc, eq } from "drizzle-orm";
import { codebase_tasks, project, todo_updates, tracker_result } from "../../../../database/schema";
import child_process from "node:child_process";
import { readdir } from "node:fs/promises";
import { getProjectById } from "../../../server/projects";
import { getRepo } from "../../../server/github";

// will have ?project_id=<id> query parameter
/** @todo capture stderr/stdout on the child processes */
/** @todo store context in db */

export async function POST(context: APIContext) {
  if (!context.locals.user || !context.locals.user.id || !context.locals.user.github_id) {
    return new Response("invalid auth", { status: 401 });
  }

  const { github_id } = context.locals.user;

  const project_id = context.url.searchParams.get("project_id");

  if (!project_id) {
    return new Response("no project id", { status: 400 });
  }

  console.log("running scan for project: ", project_id);

  // check that user owns the project
  const project_query = await db.select().from(project).where(and(eq(project.id, project_id)));

  if (project_query.length != 1) {
    return new Response("project not found", { status: 404 });
  }

  const project_data = project_query[0];

  // now we want to invoke some more complex behaviour.
  // using the access_token from the session we want to clone the repo and then scan it using ../todo-tracker binary

  const access_token = context.locals.session?.access_token;

  if (!access_token) {
    return new Response("invalid access token", { status: 401 });
  }

  const folder_id = github_id + "-" + crypto.randomUUID();

  if (!project_data.repo_id || !project_data.repo_url) {
    return new Response("project isn't linked to a repo", { status: 400 });
  }

  const repo_url = project_data.repo_url;
  if (!repo_url) {
    return new Response("no repo url", { status: 400 });
  }

  return new Response(new ReadableStream({
    async start(controller) {
      for await (const chunk of scan_repo(repo_url, access_token, folder_id, project_id, project_data.scan_branch)) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  }), { status: 200 });
}

async function* scan_repo(repo_url: string, access_token: string, folder_id: string, project_id: string, branch: string | null) {
  yield "";
  yield "starting\n";
  // we need to get OWNER and REPO from the repo_url
  const slices = repo_url.split("/");
  const repo = slices.at(-1);
  const owner = slices.at(-2);

  if (!owner || !repo) {
    yield "error parsing repo url\n";
    return;
  }

  yield "cloning repo\n";
  // clone the repo into a temp folder
  const clone = await getRepo(owner, repo, access_token, branch);

  if (!clone.ok) {
    yield "error fetching repo from github\n";
    return;
  }
  yield "loading repo into memory\n";
  const zip = await clone.arrayBuffer();

  const repo_path = `/tmp/${folder_id}.zip`;
  yield "writing repo to disk\n";
  await Bun.write(repo_path, zip);

  const unzipped_path = `/tmp/${folder_id}`;

  // call shell 'unzip'
  // await $`unzip ${repo_path} -d ${unzipped_path}`
  // call ^ using child_process 
  yield "decompressing repo\n";
  child_process.execSync(`unzip ${repo_path} -d ${unzipped_path}`);

  // the unzipped folder will have a folder inside it with the repo contents, we need that pathname for the parsing task
  const files = await readdir(unzipped_path);
  const folder_path = `${unzipped_path}/${files[0]}`;

  // fetch project.config_json if available
  const { project: found, error: config_error } = await getProjectById(project_id);
  if (config_error) {
    yield "error fetching project config\n";
    return;
  }

  let config_path = "../todo-config.json";

  // if we have a project.config_json, we need to write it to a file
  if (found?.config_json) {
    await Bun.write(unzipped_path + "/config.json", JSON.stringify(found.config_json, null, 2));
    config_path = unzipped_path + "/config.json";
    console.log("using config.json from project");
    yield "loaded config from project\n";
  }

  // TODO: add handling for user-wide config & defaults based on project type??


  console.log("folder_path: ", folder_path);

  // generate the todo-tracker parse
  yield "scanning repo\n";
  child_process.execSync(`../todo-tracker parse ${folder_path} ${config_path} > ${unzipped_path}/new-output.json`);

  yield "saving output\n"
  // for now, lets return response of the new-output.json file
  const output_file = await (Bun.file(`${unzipped_path}/new-output.json`).text());

  yield "saving scan\n";

  const new_tracker = await db.insert(tracker_result).values({
    project_id: project_id,
    data: output_file,
  }).returning();

  if (new_tracker.length != 1) {
    yield "error saving scan\n";
    return;
  }

  // then we want to create a todo_update record
  // for new_id we use the id of the new insert ^^
  // and for old_id we want to the most recent tracker_result with 'accepted' as true
  yield "finding existing scan\n";
  const new_id = new_tracker[0].id;
  const old_id = await db.select().from(tracker_result).where(and(eq(tracker_result.project_id, project_id), eq(tracker_result.accepted, true))).orderBy(desc(tracker_result.created_at)).limit(1);

  var old_data = [] as any[];
  if (old_id.length == 1 && old_id[0].data) {
    // fetch all the codebase tasks from the old_id
    const existing_tasks = await db.select().from(codebase_tasks).where(eq(codebase_tasks.recent_scan_id, old_id[0].id));
    old_data = existing_tasks;

    // rename field 'type' to 'tag' in old_data
    old_data = old_data.map((item) => {
      item.tag = item.type;
      delete item.type;
      return item;
    });
  }

  // write old data to old-output.json
  yield "writing old data\n";
  await Bun.write(unzipped_path + "/old-output.json", JSON.stringify(old_data));

  console.log("running diff");
  // run diff script and write to diff-output.json
  yield "running diff\n";
  try {
    child_process.execSync(`../todo-tracker diff ${unzipped_path}/old-output.json ${unzipped_path}/new-output.json > ${unzipped_path}/diff-output.json 2> ${unzipped_path}/err.out`);
  } catch (e) {
    console.error(e);
    yield "error running diff\n";
    return;
  }

  // read diff-output.json
  yield "reading diff\n";
  const diff = await Bun.file(unzipped_path + "/diff-output.json").text();

  yield "ignoring old updates\n";
  // update any old todo_updates that had status == "PENDING" to status == "IGNORED"
  try {
    await db.update(todo_updates).set({ status: "IGNORED" }).where(and(eq(todo_updates.project_id, project_id), eq(todo_updates.status, "PENDING")));
  } catch (e) {
    console.error(e);
    yield "error ignoring old updates\n";
    return;
  }

  yield "saving update\n";
  await db.insert(todo_updates).values({
    project_id: project_id,
    new_id: new_id,
    old_id: old_id[0]?.id ?? null,
    data: diff,
  }).returning();


  yield "done\n";
  return;
}

