// Repository scanning functionality

import child_process from "node:child_process";
import { readdir } from "node:fs/promises";
import { codebase_tasks, db, todo_updates, tracker_result } from "@devpad/schema/database";
import { and, desc, eq } from "drizzle-orm";
import { getBranches, getRepo } from "./github.js";
import type { ProjectConfig } from "./projects.js";

export async function* scanRepo(repo_url: string, access_token: string, folder_id: string, config: ProjectConfig) {
	const { id: project_id, scan_branch: branch, error: config_error } = config;
	if (config_error) {
		console.error("scan_repo: error fetching project config", config_error);
		yield "error fetching project config\n";
		return;
	}

	yield "";
	yield "starting\n";
	// we need to get OWNER and REPO from the repo_url
	const slices = repo_url.split("/");
	const repo = slices.at(-1);
	const owner = slices.at(-2);

	if (!owner || !repo) {
		console.error("scan_repo: error parsing repo url", repo_url, slices);
		yield "error parsing repo url\n";
		return;
	}

	yield "cloning repo\n";
	// clone the repo into a temp folder
	let clone;
	try {
		clone = await getRepo(owner, repo, access_token, branch ?? null);
	} catch (e) {
		console.error("scan_repo: error fetching repo from github", e);
		yield "error fetching repo from github\n";
		return;
	}

	if (clone.status < 200 || clone.status >= 400) {
		console.error("scan_repo: error fetching repo from github", clone.status);
		yield "error fetching repo from github\n";
		return;
	}

	const repo_path = `/tmp/${folder_id}.zip`;
	const unzipped_path = `/tmp/${folder_id}`;
	try {
		yield "loading repo into memory\n";
		const zip = await clone.arrayBuffer();

		yield "writing repo to disk\n";
		await Bun.write(repo_path, zip);

		// call shell 'unzip'
		// await $`unzip ${repo_path} -d ${unzipped_path}`
		// call ^ using child_process
		yield "decompressing repo\n";
		child_process.execSync(`unzip ${repo_path} -d ${unzipped_path}`);
	} catch (e) {
		console.error("scan_repo: error decompressing repo", e);
		yield "error decompressing repo\n";
		return;
	}

	// the unzipped folder will have a folder inside it with the repo contents, we need that pathname for the parsing task
	const files = await readdir(unzipped_path);
	const folder_path = `${unzipped_path}/${files[0]}`;

	let config_path = "../todo-config.json";

	// if we have a project.config_json, we need to write it to a file
	if (config?.config) {
		await Bun.write(`${unzipped_path}/config.json`, JSON.stringify(config.config, null, 2));
		config_path = `${unzipped_path}/config.json`;
		console.log("using config.json from project");
		yield "loaded config from project\n";
	}

	// TODO: add handling for user-wide config & defaults based on project type??

	console.log("folder_path: ", folder_path);

	// generate the todo-tracker parse
	yield "scanning repo\n";
	child_process.execSync(`../todo-tracker parse ${folder_path} ${config_path} > ${unzipped_path}/new-output.json`);

	yield "saving output\n";
	// for now, lets return response of the new-output.json file
	const output_file = await Bun.file(`${unzipped_path}/new-output.json`).text();

	yield "saving scan\n";

	const new_tracker = await db
		.insert(tracker_result)
		.values({
			project_id: project_id!,
			data: output_file,
		})
		.returning();

	if (new_tracker.length !== 1) {
		yield "error saving scan\n";
		return;
	}

	// then we want to create a todo_update record
	// for new_id we use the id of the new insert ^^
	// and for old_id we want to the most recent tracker_result with 'accepted' as true
	yield "finding existing scan\n";
	const new_id = new_tracker[0].id;
	const old_id = await db
		.select()
		.from(tracker_result)
		.where(and(eq(tracker_result.project_id, project_id!), eq(tracker_result.accepted, true)))
		.orderBy(desc(tracker_result.created_at))
		.limit(1);

	var old_data = [] as any[];
	if (old_id.length === 1 && old_id[0].data) {
		// fetch all the codebase tasks from the old_id
		const existing_tasks = await db.select().from(codebase_tasks).where(eq(codebase_tasks.recent_scan_id, old_id[0].id));
		old_data = existing_tasks;

		// rename field 'type' to 'tag' in old_data
		old_data = old_data.map(item => {
			item.tag = item.type;
			delete item.type;
			return item;
		});
	}

	// write old data to old-output.json
	yield "writing old data\n";
	await Bun.write(`${unzipped_path}/old-output.json`, JSON.stringify(old_data));

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
	const diff = await Bun.file(`${unzipped_path}/diff-output.json`).text();

	yield "ignoring old updates\n";
	// update any old todo_updates that had status == "PENDING" to status == "IGNORED"
	try {
		await db
			.update(todo_updates)
			.set({ status: "IGNORED" })
			.where(and(eq(todo_updates.project_id, project_id!), eq(todo_updates.status, "PENDING")));
	} catch (e) {
		console.error(e);
		yield "error ignoring old updates\n";
		return;
	}

	const branch_info = {} as { branch?: string | null; commit_sha?: string | null; commit_msg?: string | null; commit_url?: string | null };
	if (branch) {
		// find the branch that we scanned
		yield "fetching branch info\n";
		const branches = await getBranches(owner, repo, access_token);
		/** @todo type this properly */
		const found = branches.find((b: any) => b.name === branch);
		console.log(branch, branches, found);
		if (found) {
			branch_info.commit_sha = found.commit.sha;
			branch_info.commit_msg = found.commit.message;
			branch_info.branch = found.name;
			branch_info.commit_url = found.commit.url;
		}
	}

	yield "saving update\n";
	await db
		.insert(todo_updates)
		.values({
			project_id: project_id!,
			new_id: new_id,
			old_id: old_id[0]?.id ?? null,
			data: diff,
			...branch_info,
		})
		.returning();

	yield "done\n";
	return;
}
