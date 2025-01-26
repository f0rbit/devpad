import type { APIContext } from 'astro';
export async function GET(context: APIContext) {
	const data = {
		version: "0",
		url: context.url
	}
	return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
}