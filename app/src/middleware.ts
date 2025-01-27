import { lucia } from "./server/lucia";
import { verifyRequestOrigin } from "lucia";
import { defineMiddleware } from "astro:middleware";

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
  }

  // handle session history
  const history = (await context.session!.get("history")) ?? [];
  if (context.url.searchParams.get("back") == "true") {
    history.pop();
  } else {
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
