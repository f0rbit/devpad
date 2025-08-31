// we want to testing streaming response to user

import type { APIContext } from "astro";

// have 5 steps, each 200ms apart
export async function POST(_context: APIContext) {
	const stream = new ReadableStream({
		async start(controller) {
			controller.enqueue("starting\n");
			for (let i = 0; i < 5; i++) {
				await new Promise(resolve => setTimeout(resolve, 1000));
				controller.enqueue(`step ${i + 1}\n`);
			}
			controller.close();
		},
	});
	return new Response(stream, { status: 200 });
}
