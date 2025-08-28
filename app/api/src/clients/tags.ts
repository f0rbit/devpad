import { ApiClient } from '../utils/request';
import type { UpsertTag } from '../types/common';
import type { Tag } from '../types/tags';

export class TagsClient {
  private api_client: ApiClient;

  constructor(api_client: ApiClient) {
    this.api_client = api_client;
  }

  // Note: Currently there's no dedicated tags endpoint in v0 API
  // Tags are managed through the tasks upsert endpoint
  // This is a placeholder for future tag management functionality
  
  // Create or update a tag (would need backend endpoint)
  async upsert(data: UpsertTag): Promise<Tag> {
    // This would require implementing a /tags endpoint on the backend
    throw new Error('Tags endpoint not yet implemented - tags are managed through tasks');
  }

  // Convenience method for creating a new tag
  async create(data: Omit<UpsertTag, 'id'>): Promise<Tag> {
    return this.upsert(data);
  }

  // Convenience method for updating an existing tag
  async update(id: string, data: Partial<Omit<UpsertTag, 'id'>>): Promise<Tag> {
    return this.upsert({ ...data, id, owner_id: data.owner_id || '' } as UpsertTag);
  }
}