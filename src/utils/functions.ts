export const getSubDomain = (sub: string) => {
	const host = typeof window !== "undefined" ? window.location.hostname : stripProtocols(process.env.RAILWAY_STATIC_URL);
	const protocol = typeof window != "undefined" ? window.location.protocol : "http:";
	const port = process.env.NODE_ENV === "production" ? "" : ":3000";
	return `${protocol}//${sub}.${host}${port}`;
};

export const stripProtocols = (url:string | undefined) => {
	if (!url) return "devpad.tools";
	return url.replace("http://", "").replace("https://", "").split(":")[0];
}