import { GitHub } from "arctic";


export const github = new GitHub(
  Bun.env.GITHUB_CLIENT_ID!,
  Bun.env.GITHUB_CLIENT_SECRET!
);


export async function getRepo(owner: string, repo: string, access_token: string) {
  return await fetch(`https://api.github.com/repos/${owner}/${repo}/zipball`, { headers: { "Accept": "application/vnd.github+json", "Authorization": `Bearer ${access_token}`, "X-GitHub-Api-Version": "2022-11-28" } });
}


/**
 * fetch the branches & attach the latest commit to each branch
 * @todo use octokit or use zod to validate types
 */
export async function getBranches(owner: string, repo: string, access_token: string) {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/branches`, { headers: { "Accept": "application/vnd.github+json", "Authorization": `Bearer ${access_token}`, "X-GitHub-Api-Version": "2022-11-28" } });
  if (!response.ok) {
    throw new Error("error fetching branches");
  }
  const commits = new Set<string>(); // store commits to fetch the details after
  const branches = await response.json();
  for (const branch of branches) {
    commits.add(branch.commit.sha);
  }
  // fetch the commit details for each commit
  const commit_details = await Promise.all(Array.from(commits).map(async (commit) => {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${commit}`, { headers: { "Accept": "application/vnd.github+json", "Authorization": `Bearer ${access_token}`, "X-GitHub-Api-Version": "2022-11-28" } });
    if (!response.ok) {
      throw new Error("error fetching commit details");
    }
    return (await response.json() as any).commit;
  }));
  // merge the commit details into the branches
  branches.forEach((branch: any, index: any) => {
    branch.commit = commit_details[index];
  });

  // sort branches by date
  branches.sort((a: any, b: any) => {
    return new Date(b.commit.committer.date).getTime() - new Date(a.commit.committer.date).getTime();
  });

  return branches;
}
