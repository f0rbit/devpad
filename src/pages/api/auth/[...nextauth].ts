import NextAuth, { type NextAuthOptions } from "next-auth";
import GithubProvider from "next-auth/providers/github";

// Prisma adapter for NextAuth, optional and can be removed
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { prisma } from "../../../server/db/client";
import { env } from "../../../env/server.mjs";

const getDomainWithoutSubdomain = (url: any) => {
	const urlParts = new URL(url).hostname.split(".");

	return urlParts
		.slice(0)
		.slice(-(urlParts.length === 4 ? 3 : 2))
		.join(".");
};

const useSecureCookies = env.RAILWAY_STATIC_URL.startsWith("https://");
const cookiePrefix = useSecureCookies ? "__Secure-" : "";
const hostName = getDomainWithoutSubdomain(process.env.RAILWAY_STATIC_URL);

// Define how we want the session token to be stored in our browser
const cookies = {
	sessionToken: {
		name: `${cookiePrefix}next-auth.session-token`,
		options: {
			httpOnly: true,
			sameSite: "lax",
			path: "/",
			secure: useSecureCookies,
			domain: "." + hostName // add a . in front so that subdomains are included
		}
	}
};

export const authOptions: NextAuthOptions = {
	// Include user.id on session
	callbacks: {
		session({ session, user }) {
			if (session.user) {
				session.user.id = user.id;
			}
			return session;
		}
	},
	// Configure one or more authentication providers
	adapter: PrismaAdapter(prisma),
	providers: [
		GithubProvider({
			clientId: env.GITHUB_CLIENT_ID,
			clientSecret: env.GITHUB_CLIENT_SECRET
		})
		// ...add more providers here
	],
	secret: env.NEXTAUTH_SECRET,
	cookies
};

export default NextAuth(authOptions);
