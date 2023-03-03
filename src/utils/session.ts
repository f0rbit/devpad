import { unstable_getServerSession } from "next-auth/next";
import { authOptions } from "src/pages/api/auth/[...nextauth]";

// Getting the session in Next13 app/ directory
// https://next-auth.js.org/configuration/nextjs#in-app-directory
export async function getSession() {
	return await unstable_getServerSession(authOptions);
}

export async function getCurrentUser() {
	const session = await getSession();
	return session?.user;
}
