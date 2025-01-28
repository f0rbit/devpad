import { GitHub } from "arctic";
import { db } from "../../database/db";
import { commit_detail } from "../../database/schema";
import { inArray } from "drizzle-orm";


export const github = new GitHub(
  Bun.env.GITHUB_CLIENT_ID!,
  Bun.env.GITHUB_CLIENT_SECRET!
);


function gh_headers(access_token: string) {
  return {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${access_token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function getRepos(access_token: string) {
  const response = await fetch("https://api.github.com/user/repos?sort=updated&per_page=100", { headers: gh_headers(access_token) });
  if (!response.ok) {
    console.log(response.status, response.statusText);
    throw new Error("error fetching repos");
  }
  return await response.json();
}

export async function getRepo(owner: string, repo: string, access_token: string, branch: string | null) {
  let url = `https://api.github.com/repos/${owner}/${repo}/zipball`;
  if (branch) url = `https://api.github.com/repos/${owner}/${repo}/zipball/${branch}`;
  return await fetch(url, { headers: gh_headers(access_token) });
}


/**
 * fetch the branches & attach the latest commit to each branch
 * @todo use octokit or use zod to validate types
 */
export async function getBranches(owner: string, repo: string, access_token: string) {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/branches`, { headers: gh_headers(access_token) });
  if (!response.ok) {
    throw new Error("error fetching branches");
  }
  const commits = new Set<string>(); // store commits to fetch the details after
  const branches = await response.json();
  for (const branch of branches) {
    commits.add(branch.commit.sha);
  }

  const commit_details = await getCommitDetails(owner, repo, commits, access_token);
  // index commit_details by sha
  const commit_map = new Map(commit_details.map((commit) => [commit.sha, commit]));

  for (const branch of branches) {
    branch.commit = commit_map.get(branch.commit.sha);
  }

  // sort branches by date
  branches.sort((a: any, b: any) => {
    // put either main or master first
    if (a.name === "main" || a.name === "master") return -1;
    if (b.name === "main" || b.name === "master") return 1;
    // sort by date
    return new Date(b.commit.date).getTime() - new Date(a.commit.date).getTime();
  });

  return branches;
}

async function getCommitDetails(owner: string, repo: string, commit_shas: Set<string>, access_token: string) {
  // search for existing commits within the database
  const shas = Array.from(commit_shas);
  const existing = await db.select().from(commit_detail).where(inArray(commit_detail.sha, shas));

  const existing_shas = new Set(existing.map((commit: any) => commit.sha));
  const missing_shas = new Set(shas.filter((sha) => !existing_shas.has(sha)));

  console.log(`Fetching missing commits: ${missing_shas.size}`, missing_shas);

  // fetch the missing commits
  const commit_details = await Promise.all(Array.from(missing_shas).map(async (commit) => {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${commit}`, { headers: gh_headers(access_token) });
    if (!response.ok) {
      throw new Error("error fetching commit details");
    }
    return (await response.json() as any);
  }));

  let commits = existing;

  // insert the missing commits into the database
  if (commit_details.length) {
    // map the commit details to the database schema
    const values = commit_details.map((c) => {
      return {
        sha: c.sha,
        url: c.url,
        message: c.commit.message ?? "",
        avatar_url: c.author?.avatar_url ?? null,
        author_user: c.author?.login ?? "",
        author_name: c.commit.author.name,
        author_email: c.commit.author.email,
        date: c.commit.author.date,
      };
    });

    await db.insert(commit_detail).values(values);

    // put new commits into result array
    commits = commits.concat(values);
  }

  return commits;
}

export async function getSpecification(owner: string, repo: string, access_token: string) {
  if (!access_token) throw new Error("README: fetching repo without access token");
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, { headers: gh_headers(access_token) });
  if (!response.ok) {
    console.warn(`README: Code ${response.status} - ${response.statusText}`);
    throw new Error("error fetching readme");
  }
  try {
    const text = await response.text();
    return text;
  } catch (err) {
    console.log(`README: Error reading raw text: ${err} - ${response.status} ${response.statusText}`);
    throw err;
  }
}

