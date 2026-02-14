export const cookieConfig = (environment: string) => {
	const is_production = environment === "production";
	return {
		secure: is_production,
		domain: is_production ? ".devpad.tools" : undefined,
		same_site: "lax" as const,
	};
};
