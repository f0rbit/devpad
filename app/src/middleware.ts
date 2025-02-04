import { lucia } from "./server/lucia";
import { verifyRequestOrigin } from "lucia";
import { defineMiddleware } from "astro:middleware";

const history_ignore = ["/api", "/favicon", "/images", "/public"];

export const onRequest = defineMiddleware(async (context, next) => {
  if (context.request.method !== "GET") {
    const originHeader = context.request.headers.get("Origin");
    const hostHeader = context.request.headers.get("Host");
    if (!originHeader || !hostHeader || !verifyRequestOrigin(originHeader, [hostHeader])) {
      console.error("Invalid origin", { originHeader, hostHeader });
      return new Response("Invalid origin", {
        status: 403
      });
    }
  } else if (!history_ignore.find((p) => context.url.pathname.includes(p))) {
    // handle session history for GET requests
    const history = (await context.session!.get("history")) ?? [];
    if (context.url.searchParams.get("back") == "true") { // remove the last page
      history.pop();
    } else if (context.url.pathname != history.at(-1)) { // don't add the same page twice
      history.push(context.url.pathname);
    }
    if (history.at(-1) == "/") {
      context.session!.set("history", []);
    } else if (history.length > 15) {
      history.shift();
      context.session!.set("history", history);
    } else {
      context.session!.set("history", history);
    }
  }

  const sessionId = context.cookies.get(lucia.sessionCookieName)?.value ?? null;
  if (!sessionId) {
    context.locals.user = null;
    context.locals.session = null;
    return next();
  }

  const { session, user } = await lucia.validateSession(sessionId);
  if (session && session.fresh) {
    const sessionCookie = lucia.createSessionCookie(session.id);
    context.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);
  }
  if (!session) {
    const sessionCookie = lucia.createBlankSessionCookie();
    context.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);
  }
  context.locals.session = session;
  context.locals.user = user;
  return next();
});
