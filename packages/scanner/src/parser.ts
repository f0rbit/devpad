import type { ParsedTask, ScanConfig, TagMatcher } from "./types.js";

type LineMatch = {
	tag: string;
	match_index: number;
	match_length: number;
};

export const matchLine = (line: string, tags: TagMatcher[]): LineMatch | null => {
	for (const tag of tags) {
		for (const match_str of tag.match) {
			if (match_str.length === 0) continue;
			const idx = line.indexOf(match_str);
			if (idx === -1) continue;
			return { tag: tag.name, match_index: idx, match_length: match_str.length };
		}
	}
	return null;
};

export const extractText = (line: string, match_index: number, match_length: number): string => {
	const after = line.slice(match_index + match_length);
	const stripped = after.replace(/\*\/\s*$/, "").trim();

	if (stripped.length < 3) {
		return line.replace(/\*\/\s*$/, "").trim();
	}

	return stripped;
};

export const extractContext = (lines: string[], line_index: number, before: number = 4, after: number = 6): string[] => {
	const start = Math.max(0, line_index - before);
	const end = Math.min(lines.length, line_index + after);
	return lines.slice(start, end);
};

export const parseFileContent = (content: string, file_path: string, config: ScanConfig): ParsedTask[] => {
	const lines = content.split("\n");
	return lines.reduce<ParsedTask[]>((tasks, line, i) => {
		const match = matchLine(line, config.tags);
		if (!match) return tasks;

		return [
			...tasks,
			{
				id: crypto.randomUUID(),
				file: file_path,
				line: i + 1,
				tag: match.tag,
				text: extractText(line, match.match_index, match.match_length),
				context: extractContext(lines, i),
			},
		];
	}, []);
};

export const shouldIgnorePath = (file_path: string, ignore_patterns: string[]): boolean => ignore_patterns.some(pattern => new RegExp(pattern).test(file_path));
