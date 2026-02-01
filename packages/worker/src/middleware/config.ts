import { createMiddleware } from "hono/factory";
import type { AppConfig, AppContext, OAuthSecrets } from "../bindings.js";

export const configMiddleware = createMiddleware<AppContext>(async (c, next) => {
	const env = c.env;

	const config: AppConfig = {
		environment: env.ENVIRONMENT,
		api_url: env.API_URL,
		frontend_url: env.FRONTEND_URL,
		jwt_secret: env.JWT_SECRET,
		encryption_key: env.ENCRYPTION_KEY,
	};

	const oauth_secrets: OAuthSecrets = {
		github_client_id: env.GITHUB_CLIENT_ID,
		github_client_secret: env.GITHUB_CLIENT_SECRET,
		reddit_client_id: env.REDDIT_CLIENT_ID,
		reddit_client_secret: env.REDDIT_CLIENT_SECRET,
		twitter_client_id: env.TWITTER_CLIENT_ID,
		twitter_client_secret: env.TWITTER_CLIENT_SECRET,
	};

	c.set("config", config);
	c.set("oauth_secrets", oauth_secrets);

	return next();
});
