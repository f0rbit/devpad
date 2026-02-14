import { define_store, json_codec, type CorpusError as LibCorpusError } from "@f0rbit/corpus";
import { z } from "zod";

export const PostContentSchema = z.object({
	title: z.string().min(1),
	content: z.string(),
	description: z.string().optional(),
	format: z.enum(["md", "adoc"]),
});

export type PostContent = z.infer<typeof PostContentSchema>;

export const postsStoreDefinition = define_store("posts", json_codec(PostContentSchema));

export const postStoreId = (userId: string, postUuid: string): string => `posts/${userId}/${postUuid}`;

export const corpusPath = postStoreId;

export const VersionInfoSchema = z.object({
	hash: z.string(),
	parent: z.string().nullable(),
	created_at: z.date(),
});

export type VersionInfo = z.infer<typeof VersionInfoSchema>;

export type PostCorpusError = { kind: "not_found"; path: string; version?: string } | { kind: "invalid_content"; message: string } | { kind: "io_error"; message: string };

export const mapCorpusError = (e: LibCorpusError): PostCorpusError => {
	if (e.kind === "not_found") {
		return { kind: "not_found", path: e.store_id, version: e.version };
	}
	if (e.kind === "decode_error" || e.kind === "validation_error") {
		return { kind: "invalid_content", message: e.cause?.message ?? "Decode error" };
	}
	if (e.kind === "storage_error") {
		return { kind: "io_error", message: e.cause?.message ?? "Storage error" };
	}
	return { kind: "io_error", message: "Unknown corpus error" };
};

export const parsePostContent = PostContentSchema.parse.bind(PostContentSchema);
export const serializePostContent = (content: PostContent): string => JSON.stringify(content);
