import { ApiClient } from '../utils/request';
import type { TagType, TagCreate } from '../types/common';

export class TagsClient {
  constructor(api_client: ApiClient) {
    // Keep for future use
  }

  // Note: Currently there's no dedicated tags endpoint in v0 API
  // Tags are managed through the tasks upsert endpoint
  // This is a placeholder for future tag management functionality
  
  // Create or update a tag (would need backend endpoint)
  async upsert(data: TagCreate): Promise<TagType> {
    console.log('Tag upsert requested:', data);
    // This would require implementing a /tags endpoint on the backend
    throw new Error('Tags endpoint not yet implemented - tags are managed through tasks');
  }

  // Convenience method for creating a new tag
  async create(data: TagCreate): Promise<TagType> {
    return this.upsert(data);
  }

  // Convenience method for updating an existing tag
  async update(tag_id: string, data: Partial<TagCreate>): Promise<TagType> {
    console.log('Tag update requested:', tag_id, data);
    return this.upsert({ ...data });
  }
}