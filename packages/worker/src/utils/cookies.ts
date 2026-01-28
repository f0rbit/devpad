export const cookieConfig = (env: { ENVIRONMENT: string }) => {
	const is_production = env.ENVIRONMENT === "production";
	return {
		secure: is_production,
		domain: is_production ? ".devpad.tools" : undefined,
		same_site: "lax" as const,
	};
};
