import ApiClient from "@devpad/api";

export function getServerApiClient(locals: App.Locals): ApiClient {
	if (!process.env.PUBLIC_API_SERVER_URL) throw new Error("PUBLIC_API_SERVER_URL is not set");

	return new ApiClient({
		base_url: process.env.PUBLIC_API_SERVER_URL,
		api_key: `jwt:${locals.jwtToken}`,
		auth_mode: "session",
	});
}
