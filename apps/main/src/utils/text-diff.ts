/**
 * @module utils/text-diff
 *
 * v2.4 (B3.1 doc version diff, B3.3 interface-report diff) — a small,
 * dependency-free line-based LCS diff. Shared by the DocViewer's
 * adjacent-version diff link and the checkpoint card's interface-report
 * diff view, so both render the same visual diff language.
 */

export type DiffLine = { kind: "same" | "add" | "remove"; text: string };

/** Standard O(n*m) LCS table diff — fine at doc/declaration-file line counts (tens to low hundreds of lines), never called on request-hot paths. */
export function diffLines(oldText: string, newText: string): DiffLine[] {
	const oldLines = oldText.split("\n");
	const newLines = newText.split("\n");

	const table: number[][] = Array.from({ length: oldLines.length + 1 }, () =>
		Array.from({ length: newLines.length + 1 }, () => 0),
	);
	for (let i = oldLines.length - 1; i >= 0; i--) {
		for (let j = newLines.length - 1; j >= 0; j--) {
			table[i][j] = oldLines[i] === newLines[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
		}
	}

	const result: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < oldLines.length && j < newLines.length) {
		if (oldLines[i] === newLines[j]) {
			result.push({ kind: "same", text: oldLines[i] });
			i++;
			j++;
		} else if (table[i + 1][j] >= table[i][j + 1]) {
			result.push({ kind: "remove", text: oldLines[i] });
			i++;
		} else {
			result.push({ kind: "add", text: newLines[j] });
			j++;
		}
	}
	while (i < oldLines.length) {
		result.push({ kind: "remove", text: oldLines[i] });
		i++;
	}
	while (j < newLines.length) {
		result.push({ kind: "add", text: newLines[j] });
		j++;
	}
	return result;
}
