import { describe, expect, test } from "bun:test";
import { type CookieConfig, createBlankSessionCookie, createSessionCookie, generateSessionId, getSessionCookieName } from "../session.js";

const PRODUCTION_CONFIG: CookieConfig = {
	secure: true,
	domain: ".devpad.tools",
	same_site: "lax",
};

const DEV_CONFIG: CookieConfig = {
	secure: false,
	same_site: "lax",
};

describe("generateSessionId", () => {
	test("returns a valid UUID", () => {
		const id = generateSessionId();
		const uuid_regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
		expect(id).toMatch(uuid_regex);
	});

	test("returns unique values", () => {
		const ids = Array.from({ length: 100 }, generateSessionId);
		const unique = new Set(ids);
		expect(unique.size).toBe(100);
	});
});

describe("getSessionCookieName", () => {
	test("returns auth_session", () => {
		expect(getSessionCookieName()).toBe("auth_session");
	});
});

describe("createSessionCookie", () => {
	test("produces correct cookie string for production", () => {
		const cookie = createSessionCookie("test-session-id", PRODUCTION_CONFIG);
		expect(cookie).toContain("auth_session=test-session-id");
		expect(cookie).toContain("Path=/");
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("SameSite=Lax");
		expect(cookie).toContain("Secure");
		expect(cookie).toContain("Domain=.devpad.tools");
		expect(cookie).toContain("Max-Age=");
	});

	test("omits Secure and Domain in dev", () => {
		const cookie = createSessionCookie("test-session-id", DEV_CONFIG);
		expect(cookie).toContain("auth_session=test-session-id");
		expect(cookie).toContain("Path=/");
		expect(cookie).toContain("HttpOnly");
		expect(cookie).not.toContain("Secure");
		expect(cookie).not.toContain("Domain=");
	});

	test("max-age is 30 days in seconds", () => {
		const cookie = createSessionCookie("id", PRODUCTION_CONFIG);
		const thirty_days_seconds = 30 * 24 * 60 * 60;
		expect(cookie).toContain(`Max-Age=${thirty_days_seconds}`);
	});
});

describe("createBlankSessionCookie", () => {
	test("produces blank cookie with Max-Age=0", () => {
		const cookie = createBlankSessionCookie(PRODUCTION_CONFIG);
		expect(cookie).toContain("auth_session=");
		expect(cookie).toContain("Path=/");
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("Max-Age=0");
		expect(cookie).toContain("Secure");
		expect(cookie).toContain("Domain=.devpad.tools");
	});

	test("blank cookie value is empty", () => {
		const cookie = createBlankSessionCookie(DEV_CONFIG);
		expect(cookie.startsWith("auth_session=;")).toBe(true);
	});
});
