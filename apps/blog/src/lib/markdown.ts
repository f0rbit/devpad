import rehypeHighlight from "rehype-highlight";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

export const markdown = {
	async render(content: string): Promise<string> {
		const result = await unified().use(remarkParse).use(remarkGfm).use(remarkRehype).use(rehypeHighlight).use(rehypeStringify).process(content);

		return String(result);
	},
};
