export const getSubDomain = (sub: string) => {
	const host = typeof window !== "undefined" ? window.location.hostname : "devpad.tools";
	const protocol = typeof window != "undefined" ? window.location.protocol : "http:";
	const port = process.env.NODE_ENV === "production" ? "" : ":3000";
	return `${protocol}//${sub}.${host}${port}`;
};