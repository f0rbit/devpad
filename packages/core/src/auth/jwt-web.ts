import { err, ok, type Result } from "@f0rbit/corpus";

export type JWTPayload = {
	user_id: string;
	session_id: string;
	iat: number;
	exp: number;
};

export type JWTError = { kind: "expired" } | { kind: "invalid_signature" } | { kind: "malformed" } | { kind: "encoding_error"; message: string };

const JWT_EXPIRY_SECONDS = 24 * 60 * 60;

async function importKey(secret: string): Promise<CryptoKey> {
	const encoder = new TextEncoder();
	return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function base64UrlEncode(data: Uint8Array): string {
	const binary = Array.from(data)
		.map(b => String.fromCharCode(b))
		.join("");
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
	const padded = str.replace(/-/g, "+").replace(/_/g, "/");
	const pad_length = (4 - (padded.length % 4)) % 4;
	const binary = atob(padded + "=".repeat(pad_length));
	return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function base64UrlEncodeString(str: string): string {
	const encoder = new TextEncoder();
	return base64UrlEncode(encoder.encode(str));
}

function base64UrlDecodeString(str: string): string {
	const decoder = new TextDecoder();
	return decoder.decode(base64UrlDecode(str));
}

export async function generateJWT(secret: string, payload: { user_id: string; session_id: string }): Promise<Result<string, JWTError>> {
	const now = Math.floor(Date.now() / 1000);
	const header = { alg: "HS256", typ: "JWT" };

	const full_payload: JWTPayload = {
		...payload,
		iat: now,
		exp: now + JWT_EXPIRY_SECONDS,
	};

	const encoded_header = base64UrlEncodeString(JSON.stringify(header));
	const encoded_payload = base64UrlEncodeString(JSON.stringify(full_payload));
	const signing_input = `${encoded_header}.${encoded_payload}`;

	const key = await importKey(secret).catch((e: Error) => e);
	if (key instanceof Error) return err({ kind: "encoding_error", message: key.message });

	const encoder = new TextEncoder();
	const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signing_input)).catch((e: Error) => e);

	if (signature instanceof Error) return err({ kind: "encoding_error", message: signature.message });

	const encoded_signature = base64UrlEncode(new Uint8Array(signature));
	return ok(`${signing_input}.${encoded_signature}`);
}

export async function verifyJWT(secret: string, token: string): Promise<Result<JWTPayload, JWTError>> {
	const parts = token.split(".");
	if (parts.length !== 3) return err({ kind: "malformed" });

	const [encoded_header, encoded_payload, encoded_signature] = parts;
	const signing_input = `${encoded_header}.${encoded_payload}`;

	const key = await importKey(secret).catch((e: Error) => e);
	if (key instanceof Error) return err({ kind: "encoding_error", message: key.message });

	const signature = base64UrlDecode(encoded_signature);
	const encoder = new TextEncoder();

	const is_valid = await crypto.subtle.verify("HMAC", key, signature, encoder.encode(signing_input)).catch(() => false);

	if (!is_valid) return err({ kind: "invalid_signature" });

	const decoded = decodeJWT(token);
	if (!decoded.ok) return decoded;

	if (decoded.value.exp <= Math.floor(Date.now() / 1000)) return err({ kind: "expired" });

	return decoded;
}

export function decodeJWT(token: string): Result<JWTPayload, JWTError> {
	const parts = token.split(".");
	if (parts.length !== 3) return err({ kind: "malformed" });

	const raw = (() => {
		try {
			return JSON.parse(base64UrlDecodeString(parts[1])) as JWTPayload;
		} catch {
			return null;
		}
	})();

	if (!raw) return err({ kind: "malformed" });

	return ok(raw);
}
