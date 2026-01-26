export type ScanConfig = {
	tags: TagMatcher[];
	ignore: string[];
};

export type TagMatcher = {
	name: string;
	match: string[];
};

export type ParsedTask = {
	id: string;
	file: string;
	line: number;
	tag: string;
	text: string;
	context: string[];
};

export type DiffType = "SAME" | "MOVE" | "UPDATE" | "NEW" | "DELETE";

export type DiffInfo = {
	text: string;
	line: number;
	file: string;
	context: string[];
};

export type DiffResult = {
	id: string;
	tag: string;
	type: DiffType;
	data: {
		old: DiffInfo | null;
		new: DiffInfo | null;
	};
};

export type ScannerError = { kind: "github_api_error"; status: number; message: string } | { kind: "parse_error"; message: string } | { kind: "config_error"; message: string } | { kind: "rate_limited"; retry_after?: number };

export type GitHubTreeEntry = {
	path: string;
	type: "blob" | "tree";
	sha: string;
	size: number;
};
