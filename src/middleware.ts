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
		"/((?!api|_next|fonts|examples|[\\w-]+\\.\\w+).*)",
		"/"
	]
};

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
	const hostname = req.headers.get("host") || "devpad.local";
	// Only for demo purposes - remove this if you want to use your root domain as the landing page
	if (hostname === "vercel.app" || hostname === "platforms.vercel.app") {
		return NextResponse.redirect("https://demo.vercel.pub");
	}

	/*  You have to replace ".vercel.pub" with your own domain if you deploy this example under your domain.
      You can also use wildcard subdomains on .vercel.app links that are associated with your Vercel team slug
      in this case, our team slug is "platformize", thus *.platformize.vercel.app works. Do note that you'll
      still need to add "*.platformize.vercel.app" as a wildcard domain on your Vercel dashboard. */
	const currentHost =
		process.env.NODE_ENV === "production" && process.env.VERCEL === "1"
			? hostname
					.replace(`.devpad.local`, "")
					.replace(`.platformize.vercel.app`, "")
					.replace(".devpad-one.vercel.app", "")
			: hostname
					.replace(`.devpad.local:3000`, "")
					.replace(".localhost:3000", "")
					.replace(".devpad-one.vercel.app", "");
	// rewrites for app pages
	// if (currentHost == "app") {
	//   if (url.pathname === "/login" && (req.cookies.get("next-auth.session-token") || req.cookies.get("__Secure-next-auth.session-token"))) {
	//     url.pathname = "/";
	//     return NextResponse.redirect(url);
	//   }
	//   url.pathname = `/app${url.pathname}`;
	//   return NextResponse.rewrite(url);
	// }

	for (const redirect of redirects) {
		if (currentHost === redirect.subdomain) {
			url.pathname = `/${redirect.target}${url.pathname}`;
			return NextResponse.rewrite(url);
		}
	}
	// default
	// rewrite root application to `/home` folder
	if (hostname === "localhost:3000" || hostname === "devpad.local:3000") {
		url.pathname = `/home${url.pathname}`;
		return NextResponse.rewrite(url);
	}
}
