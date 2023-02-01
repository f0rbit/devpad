import { NextRequest, NextResponse } from "next/server";

export const config = {
	matcher: [
		/*
		 * Match all paths except for:
		 * 1. /api routes
		 * 2. /_next (Next.js internals)
		 * 3. /fonts (inside /public)
		 * 4. /examples (inside /public)
		 * 5. all root files inside /public (e.g. /favicon.ico)
		 */
		"/((?!api/|_next/|fonts/|_static/|examples/|[\\w-]+\\.\\w+).*)",
		// add additional route for only /
		"/"
	]
};

const skips = [
	"api/",
	"_next/",
	"fonts/",
	"_static/",
	"examples/",
]

type AppRedirect = {
	subdomain: string;
	target: string;
};
const redirects: AppRedirect[] = [
	{
		subdomain: "todo",
		target: "todo"
	},
	{
		subdomain: "diary",
		target: "diary"
	},
	{
		subdomain: "calendar",
		target: "calendar"
	},
	{
		subdomain: "projects",
		target: "projects"
	},
	{
		subdomain: "manager",
		target: "manager"
	}
];

export default function middleware(req: NextRequest) {
	const url = req.nextUrl;

	// Get hostname of request (e.g. demo.vercel.pub, demo.localhost:3000)
	const hostname = req.headers.get("host") || process.env.RAILWAY_STATIC_URL || "devpad.tools";
	console.log("hostname: " + hostname);
	console.log("url: " + url.pathname);

	/*  You have to replace ".vercel.pub" with your own domain if you deploy this example under your domain.
      You can also use wildcard subdomains on .vercel.app links that are associated with your Vercel team slug
      in this case, our team slug is "platformize", thus *.platformize.vercel.app works. Do note that you'll
      still need to add "*.platformize.vercel.app" as a wildcard domain on your Vercel dashboard. */
	const currentHost =
		process.env.NODE_ENV === "production" && process.env.VERCEL === "1"
			? hostname
					.replace(`.devpad.local`, "")
					.replace(`.devpad.tools`, "")
					.replace(process.env.RAILWAY_STATIC_URL || "", "")
			: hostname
					.replace(`.devpad.local:3000`, "")
					.replace(".localhost:3000", "")
					.replace(process.env.RAILWAY_STATIC_URL || "", "")

	console.log("currentHost: " + currentHost); 

	for (const skip of skips) {
		if (url.pathname.includes(skip)) {
			console.log("[skip] " + url.pathname);
			return NextResponse.next();
		}
	}

	for (const redirect of redirects) {
		if (currentHost === redirect.subdomain) {
			url.pathname = `/${redirect.target}${url.pathname}`;
			console.log("[route] redirecting to " + url.pathname);
			return NextResponse.rewrite(url);
		}
	}

	// default
	// rewrite root application to `/home` folder
	if (hostname === "localhost:3000" || hostname === "devpad.local:3000" || hostname === "devpad.tools" || hostname === process.env.RAILWAY_STATIC_URL) {
		url.pathname = `/home${url.pathname}`;
		console.log("[default] redirecting to " + url.pathname);
		return NextResponse.rewrite(url);
	}

	return NextResponse.next();
}
