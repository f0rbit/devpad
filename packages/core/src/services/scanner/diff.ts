import type { DiffInfo, DiffResult, ParsedTask } from "./types.js";

export const sameText = (a: string, b: string): boolean => a.trim() === b.trim();

export const extractDiffInfo = (task: ParsedTask): DiffInfo => ({
	text: task.text,
	line: task.line,
	file: task.file,
	context: task.context,
});

export const generateDiff = (old_tasks: ParsedTask[], new_tasks: ParsedTask[]): DiffResult[] => {
	const used_old_ids = new Set<string>();

	const new_diffs = new_tasks.map<DiffResult>(new_task => {
		const text_match = old_tasks.find(old_task => !used_old_ids.has(old_task.id) && sameText(old_task.text, new_task.text));

		if (text_match) {
			used_old_ids.add(text_match.id);
			const is_same = text_match.line === new_task.line && text_match.file === new_task.file;
			return {
				id: text_match.id,
				tag: new_task.tag,
				type: is_same ? "SAME" : "MOVE",
				data: {
					old: extractDiffInfo(text_match),
					new: extractDiffInfo(new_task),
				},
			};
		}

		const line_tag_match = old_tasks.find(old_task => !used_old_ids.has(old_task.id) && old_task.line === new_task.line && old_task.tag === new_task.tag && !sameText(old_task.text, new_task.text));

		if (line_tag_match) {
			used_old_ids.add(line_tag_match.id);
			return {
				id: line_tag_match.id,
				tag: new_task.tag,
				type: "UPDATE",
				data: {
					old: extractDiffInfo(line_tag_match),
					new: extractDiffInfo(new_task),
				},
			};
		}

		return {
			id: new_task.id,
			tag: new_task.tag,
			type: "NEW",
			data: {
				old: null,
				new: extractDiffInfo(new_task),
			},
		};
	});

	const delete_diffs = old_tasks
		.filter(old_task => !used_old_ids.has(old_task.id))
		.map<DiffResult>(old_task => ({
			id: old_task.id,
			tag: old_task.tag,
			type: "DELETE",
			data: {
				old: extractDiffInfo(old_task),
				new: null,
			},
		}));

	return [...new_diffs, ...delete_diffs];
};
