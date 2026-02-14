export const cookieConfig = (environment: string) => {
	const is_deployed = environment !== "development";
	return {
		secure: is_deployed,
		domain: is_deployed ? ".devpad.tools" : undefined,
		same_site: "lax" as const,
	};
};
