import type { Tag, UpsertTag } from "@devpad/schema";
import { BaseClient } from "../utils/base-client";

export class TagsClient extends BaseClient {
	async upsert(data: UpsertTag): Promise<Tag> {
		throw new Error("Tags endpoint not yet implemented - tags are managed through tasks");
	}

	async create(data: UpsertTag): Promise<Tag> {
		return this.upsert(data);
	}

	async update(tag_id: string, data: UpsertTag): Promise<Tag> {
		console.log("Tag update requested:", tag_id, data);
		return this.upsert({ ...data });
	}
}
