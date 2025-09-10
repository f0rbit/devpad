import { db, user } from "@devpad/schema/database/server";
import { generateState } from "arctic";
import { eq } from "drizzle-orm";
import { github } from "../services/github.js";
import { lucia } from "./lucia.js";

export interface GitHubUser {
	id: number;
	login: string;
	name: string | null;
	email: string | null;
	avatar_url: string;
}

export interface OAuthState {
	url: string;
	state: string;
}

export interface OAuthCallbackResult {
	user: {
		id: string;
		github_id: number | null;
		name: string | null;
		email: string | null;
		email_verified: string | null;
		image_url: string | null;
		task_view: "list" | "grid";
	};
	accessToken: string;
	sessionId: string;
}

/**
 * Create GitHub OAuth authorization URL with state
 */
export async function createGitHubAuthUrl(): Promise<OAuthState> {
	const state = generateState();
	const url = await github.createAuthorizationURL(state, {
		scopes: ["user:email", "repo"],
	});

	return {
		url: url.toString(),
		state,
	};
}

/**
 * Handle GitHub OAuth callback - exchange code for tokens and create user session
 */
export async function handleGitHubCallback(code: string, state: string, storedState: string): Promise<OAuthCallbackResult> {
	// Validate state to prevent CSRF attacks
	if (state !== storedState) {
		throw new Error("Invalid OAuth state parameter");
	}

	try {
		// Exchange authorization code for access token
		const tokens = await github.validateAuthorizationCode(code);
		const accessToken = tokens.accessToken;

		// Fetch user profile from GitHub
		const githubUser = await fetchGitHubUser(accessToken);

		// Create or retrieve user from database
		const dbUser = await createOrUpdateUser(githubUser);

		// Create Lucia session with access token
		const session = await lucia.createSession(dbUser.id, {
			access_token: accessToken,
		});

		return {
			user: dbUser,
			accessToken,
			sessionId: session.id,
		};
	} catch (error) {
		console.error("OAuth callback error:", error);
		throw new Error("Failed to process GitHub OAuth callback");
	}
}

/**
 * Create user session with access token
 */
export async function createUserSession(userId: string, accessToken: string) {
	return await lucia.createSession(userId, {
		access_token: accessToken,
	});
}

/**
 * Invalidate user session
 */
export async function invalidateUserSession(sessionId: string): Promise<void> {
	await lucia.invalidateSession(sessionId);
}

/**
 * Fetch user profile from GitHub API
 */
async function fetchGitHubUser(accessToken: string): Promise<GitHubUser> {
	const response = await fetch("https://api.github.com/user", {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"User-Agent": "devpad-app",
		},
	});

	if (!response.ok) {
		throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
	}

	const userData = (await response.json()) as any;

	// If primary email is private, fetch public email
	if (!userData.email) {
		try {
			const emailResponse = await fetch("https://api.github.com/user/emails", {
				headers: {
					Authorization: `Bearer ${accessToken}`,
					"User-Agent": "devpad-app",
				},
			});

			if (emailResponse.ok) {
				const emails = (await emailResponse.json()) as any[];
				const primaryEmail = emails.find((email: any) => email.primary);
				userData.email = primaryEmail?.email || null;
			}
		} catch (emailError) {
			console.warn("Failed to fetch user emails:", emailError);
		}
	}

	return {
		id: userData.id,
		login: userData.login,
		name: userData.name,
		email: userData.email,
		avatar_url: userData.avatar_url,
	};
}

/**
 * Create or update user in database
 */
async function createOrUpdateUser(githubUser: GitHubUser) {
	// Check if user already exists
	const existingUser = await db.select().from(user).where(eq(user.github_id, githubUser.id)).limit(1);

	if (existingUser.length > 0) {
		// Update existing user
		const updatedUser = await db
			.update(user)
			.set({
				name: githubUser.name || githubUser.login,
				email: githubUser.email,
				image_url: githubUser.avatar_url,
			})
			.where(eq(user.github_id, githubUser.id))
			.returning();

		return updatedUser[0];
	}

	// Create new user
	const newUser = await db
		.insert(user)
		.values({
			github_id: githubUser.id,
			name: githubUser.name || githubUser.login,
			email: githubUser.email,
			image_url: githubUser.avatar_url,
			task_view: "list",
		})
		.returning();

	return newUser[0];
}
