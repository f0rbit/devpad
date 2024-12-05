import { GitHub } from "arctic";

console.log({ GITHUB_CLIENT_ID: import.meta.env.GITHUB_CLIENT_ID });

export const github = new GitHub(
	import.meta.env.GITHUB_CLIENT_ID!,
	import.meta.env.GITHUB_CLIENT_SECRET!
);
