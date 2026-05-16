import * as blogSchema from "./blog.js";
import * as mediaSchema from "./media.js";
import * as devpadSchema from "./schema.js";

// Explicit type annotation avoids TS2742 when drizzle-orm's `SQLiteTableWithColumns`
// transitively references a copy of itself nested inside `@f0rbit/corpus/node_modules`.
export const fullSchema: typeof devpadSchema & typeof blogSchema & typeof mediaSchema = {
	...devpadSchema,
	...blogSchema,
	...mediaSchema,
};
