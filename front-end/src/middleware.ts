import { defineMiddleware } from "astro:middleware";

const { API_URL } = import.meta.env;

export const onRequest = defineMiddleware(async (context, next) => {
	console.log("API_URL: " + API_URL);
	// make a fetch request to API session
	const request = await fetch(API_URL + "/auth/session");
	if (!request || !request.ok) {
		console.error("couldn't fetch session");
		context.locals.user = null;
		return next();
	}

	try {
		const response = await request.json();
		context.locals.user = response.user as User;
	} catch (err) {
		console.error(err);
		context.locals.user = null;
	}
	return next();
});
