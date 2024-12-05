import { GitHub } from "arctic";

console.log("meta", import.meta.env);
console.log("process.env", process.env);
console.log("bun.env", Bun.env);

export const github = new GitHub(
	import.meta.env.GITHUB_CLIENT_ID!,
	import.meta.env.GITHUB_CLIENT_SECRET!
);
