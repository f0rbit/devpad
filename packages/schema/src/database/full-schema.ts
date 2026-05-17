import * as blogSchema from "./blog.js";
import * as mediaSchema from "./media.js";
import * as devpadSchema from "./schema.js";

export const fullSchema = { ...devpadSchema, ...blogSchema, ...mediaSchema };
