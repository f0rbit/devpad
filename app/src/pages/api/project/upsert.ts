import type { APIContext } from "astro";

export async function PATCH(context: APIContext) {
	// first we need to validate that the user is logged in
	if (!context.locals.user) {
		return new Response(null, { status: 401	});
	}
	
	// extract the form contents from the input
	const project = context.request.body;

	// validate project contents using zod & return error if anything missing
	console.log({ project });

	// perform db upsert

	// return the project data
	
	return new Response(JSON.stringify({ project_id: "test" }));
}
