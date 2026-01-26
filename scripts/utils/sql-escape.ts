export const escapeSQL = (value: unknown): string => {
	if (value === null || value === undefined) return "NULL";
	if (typeof value === "number") return String(value);
	if (typeof value === "boolean") return value ? "1" : "0";
	if (typeof value === "object") return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
	return `'${String(value).replace(/'/g, "''")}'`;
};

export const generateInserts = (rows: Record<string, unknown>[], table_name: string): string[] => {
	if (rows.length === 0) return [];
	return rows.map(row => {
		const columns = Object.keys(row);
		const values = Object.values(row).map(escapeSQL);
		return `INSERT OR IGNORE INTO ${table_name} (${columns.join(", ")}) VALUES (${values.join(", ")});`;
	});
};
