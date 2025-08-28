import { z } from 'zod';
import { BaseEntitySchema } from './common';

export const TagColorSchema = z.enum(['red', 'green', 'blue', 'yellow', 'purple', 'orange', 'teal', 'pink', 'gray', 'cyan', 'lime']);

export const TagSchema = BaseEntitySchema.extend({
  owner_id: z.string(),
  title: z.string(),
  color: TagColorSchema.nullable(),
  deleted: z.boolean(),
  render: z.boolean(),
});

export type Tag = z.infer<typeof TagSchema>;
export type TagColor = z.infer<typeof TagColorSchema>;

export const TagListResponseSchema = z.array(TagSchema);
export const TagDetailResponseSchema = TagSchema;