import { GitHub } from "arctic";


export const github = new GitHub(
	Bun.env.GITHUB_CLIENT_ID!,
	Bun.env.GITHUB_CLIENT_SECRET!
);


export async function getRepo(owner: string, repo: string, access_token: string) {
  return await fetch(`https://api.github.com/repos/${owner}/${repo}/zipball`, { headers: { "Accept": "application/vnd.github+json", "Authorization": `Bearer ${access_token}`, "X-GitHub-Api-Version": "2022-11-28" } });
}

