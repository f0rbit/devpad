export const getSubDomain = (sub: string) => {
	const host = typeof window !== "undefined" ? window.location.hostname : "devpad.tools";
	const protocol = typeof window != "undefined" ? window.location.protocol : "http:";
	return `${protocol}//${sub}.${host}:3000`;
};