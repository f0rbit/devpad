export const getSubDomain = (sub: string) => {
	const railway = process.env.RAILWAY_STATIC_URL?.split("//")[1]?.split(":")[0];
	const host = typeof window !== "undefined" ? window.location.hostname : railway ?? "devpad.tools";
	const protocol = typeof window != "undefined" ? window.location.protocol : "http:";
	const port = process.env.NODE_ENV === "production" ? "" : ":3000";
	return `${protocol}//${sub}.${host}${port}`;
};