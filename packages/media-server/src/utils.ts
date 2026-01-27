export { err, ok, type Result } from "@f0rbit/corpus";
export {
	match,
	to_nullable,
	unwrap,
	unwrap_err,
	try_catch,
	try_catch_async,
	fetch_result,
	pipe,
	at,
	first,
	last,
	merge_deep,
	type Pipe,
	type FetchError,
	type DeepPartial,
} from "@f0rbit/corpus";

import { type FetchError, type Result, ok, pipe, try_catch, try_catch_async } from "@f0rbit/corpus";
import { type ParseError, errors } from "@devpad/schema/media";
import type { Context } from "hono";
import type { z } from "zod";
import { createLogger } from "./logger";

export const safeJsonParse = <T>(value: string, schema: z.ZodType<T>): T | undefined => {
	try {
		const parsed = JSON.parse(value);
		const result = schema.safeParse(parsed);
		return result.success ? result.data : undefined;
	} catch {
		return undefined;
	}
};

export const tryJsonParse = (value: string): unknown | undefined => {
	try {
		return JSON.parse(value);
	} catch {
		return undefined;
	}
};

export const parseSettingsMap = (settings: Array<{ setting_key: string; setting_value: string }>): Record<string, unknown> =>
	Object.fromEntries(
		settings.flatMap(s => {
			const parsed = tryJsonParse(s.setting_value);
			return parsed !== undefined ? [[s.setting_key, parsed]] : [];
		})
	);

// Crypto utilities - use nativeCrypto to avoid shadowing our exports
const nativeCrypto = crypto;
const SALT = new TextEncoder().encode("media-timeline-salt");
const IV_LENGTH = 12;
const ITERATIONS = 100000;

export type EncryptionError = { kind: "encryption_failed"; message: string } | { kind: "decryption_failed"; message: string };

const derive_key = (password: string): Promise<CryptoKey> =>
	nativeCrypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]).then((key_material: CryptoKey) =>
		nativeCrypto.subtle.deriveKey(
			{
				name: "PBKDF2",
				salt: SALT,
				iterations: ITERATIONS,
				hash: "SHA-256",
			},
			key_material,
			{ name: "AES-GCM", length: 256 },
			false,
			["encrypt", "decrypt"]
		)
	);

const encrypt_impl = (plaintext: string, key: string): Promise<Result<string, EncryptionError>> =>
	try_catch_async(
		async () => {
			const iv = nativeCrypto.getRandomValues(new Uint8Array(IV_LENGTH));
			const derived_key = await derive_key(key);
			const encoded = new TextEncoder().encode(plaintext);
			const ciphertext = await nativeCrypto.subtle.encrypt({ name: "AES-GCM", iv }, derived_key, encoded);
			const combined = new Uint8Array(iv.length + ciphertext.byteLength);
			combined.set(iv, 0);
			combined.set(new Uint8Array(ciphertext), iv.length);
			return to_base64(combined);
		},
		(e): EncryptionError => ({ kind: "encryption_failed", message: String(e) })
	);

const decrypt_impl = (ciphertext: string, key: string): Promise<Result<string, EncryptionError>> =>
	pipe(from_base64(ciphertext))
		.map_err((): EncryptionError => ({ kind: "decryption_failed", message: "Invalid base64 ciphertext" }))
		.flat_map(combined =>
			try_catch_async(
				async () => {
					const iv = combined.slice(0, IV_LENGTH);
					const data = combined.slice(IV_LENGTH);
					const derived_key = await derive_key(key);
					const decrypted = await nativeCrypto.subtle.decrypt({ name: "AES-GCM", iv }, derived_key, data);
					return new TextDecoder().decode(decrypted);
				},
				(e): EncryptionError => ({ kind: "decryption_failed", message: String(e) })
			)
		)
		.result();

const sha256_impl = async (data: string): Promise<Uint8Array> => {
	const encoded = new TextEncoder().encode(data);
	const hash_buffer = await nativeCrypto.subtle.digest("SHA-256", encoded);
	return new Uint8Array(hash_buffer);
};

const key_impl = async (apiKey: string): Promise<string> => to_hex(await sha256_impl(apiKey));

export const secrets = {
	encrypt: encrypt_impl,
	decrypt: decrypt_impl,
	sha256: sha256_impl,
	key: key_impl,
};

const daysAgo = (days: number): string => {
	const d = new Date();
	d.setDate(d.getDate() - days);
	return d.toISOString();
};

const hoursAgo = (hours: number): string => {
	const d = new Date();
	d.setHours(d.getHours() - hours);
	return d.toISOString();
};

const minutesAgo = (minutes: number): string => {
	const d = new Date();
	d.setMinutes(d.getMinutes() - minutes);
	return d.toISOString();
};

const key = (timestamp: string): string => new Date(timestamp).toISOString().split("T")[0] ?? "";

export const date = { ago: daysAgo, hours: hoursAgo, minutes: minutesAgo, key };

// Encoding utilities
export type DecodeError = { kind: "invalid_base64"; input: string } | ParseError;

export const to_base64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
export const from_base64 = (str: string): Result<Uint8Array, DecodeError> =>
	try_catch(
		() => Uint8Array.from(atob(str), c => c.charCodeAt(0)),
		(): DecodeError => ({ kind: "invalid_base64", input: str.slice(0, 50) })
	);

export const to_hex = (bytes: Uint8Array): string => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
export const from_hex = (str: string): Result<Uint8Array, ParseError> => {
	if (str.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(str)) {
		return errors.parseError(`Invalid hex string: ${str.slice(0, 50)}`);
	}
	const matches = str.match(/.{1,2}/g);
	if (!matches) return ok(new Uint8Array(0));
	return ok(new Uint8Array(matches.map(byte => Number.parseInt(byte, 16))));
};

// String utilities
export const truncate = (text: string, max_length = 72): string => {
	const first_line = text.split("\n")[0] ?? "";
	const single_line = first_line.replace(/\s+/g, " ").trim();
	return single_line.length <= max_length ? single_line : `${single_line.slice(0, max_length - 3)}...`;
};

// Other utilities
export const uuid = (): string => nativeCrypto.randomUUID();
export const random_sha = (): string => Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

// Background task utilities
export const safeWaitUntil = (c: Context, task: () => Promise<void>, taskName: string): void => {
	const log = createLogger(taskName);
	try {
		c.executionCtx.waitUntil(task());
	} catch {
		task().catch(error => {
			log.error("Background task failed", { error });
		});
	}
};
