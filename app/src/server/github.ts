import { GitHub } from "arctic";


export const github = new GitHub(
	Bun.env.GITHUB_CLIENT_ID!,
	Bun.env.GITHUB_CLIENT_SECRET!
);
