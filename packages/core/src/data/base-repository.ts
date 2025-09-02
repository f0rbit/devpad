import { db } from "@devpad/schema/database";
import { action, type ActionType } from "@devpad/schema/database";
import { eq, and, type SQL } from "drizzle-orm";

/**
 * Base repository class providing common database operations
 * Reduces duplication across service files and provides consistent error handling
 */
export abstract class BaseRepository<TTable, TSelect, TInsert> {
	protected table: TTable;

	constructor(table: TTable) {
		this.table = table;
	}

	/**
	 * Find a single record by ID
	 */
	protected async findById(id: string, idField: string = "id"): Promise<TSelect | null> {
		try {
			const result = await db
				.select()
				.from(this.table as any)
				.where(eq((this.table as any)[idField], id));
			return (result[0] as TSelect) || null;
		} catch (error) {
			console.error(`Error finding record by ID ${id}:`, error);
			return null;
		}
	}

	/**
	 * Find multiple records by a field value
	 */
	protected async findBy(field: string, value: any): Promise<TSelect[]> {
		try {
			const result = await db
				.select()
				.from(this.table as any)
				.where(eq((this.table as any)[field], value));
			return result as TSelect[];
		} catch (error) {
			console.error(`Error finding records by ${field}:`, error);
			return [];
		}
	}

	/**
	 * Find multiple records with custom where conditions
	 */
	protected async findWhere(conditions: SQL[]): Promise<TSelect[]> {
		try {
			const result = await db
				.select()
				.from(this.table as any)
				.where(and(...conditions));
			return result as TSelect[];
		} catch (error) {
			console.error("Error finding records with conditions:", error);
			return [];
		}
	}

	/**
	 * Insert a new record
	 */
	protected async insert(data: TInsert): Promise<TSelect | null> {
		try {
			const result = await db
				.insert(this.table as any)
				.values(data as any)
				.returning();
			return ((result as any)[0] as TSelect) || null;
		} catch (error) {
			console.error("Error inserting record:", error);
			return null;
		}
	}

	/**
	 * Update a record by ID
	 */
	protected async updateById(id: string, data: Partial<TInsert>, idField: string = "id"): Promise<TSelect | null> {
		try {
			const result = await db
				.update(this.table as any)
				.set(data as any)
				.where(eq((this.table as any)[idField], id))
				.returning();
			return ((result as any)[0] as TSelect) || null;
		} catch (error) {
			console.error(`Error updating record ${id}:`, error);
			return null;
		}
	}

	/**
	 * Add action log entry - common across all services
	 */
	protected async addAction(actionData: { owner_id: string; type: ActionType; description: string; data?: any }): Promise<boolean> {
		try {
			await db.insert(action).values(actionData);
			console.log("inserted action", actionData.type);
			return true;
		} catch (error) {
			console.error("Error adding action:", error);
			return false;
		}
	}

	/**
	 * Check if user owns a resource - common authorization pattern
	 */
	protected async checkOwnership(resourceId: string, userId: string, ownerField: string = "owner_id", idField: string = "id"): Promise<boolean> {
		try {
			const result = await db
				.select()
				.from(this.table as any)
				.where(and(eq((this.table as any)[idField], resourceId), eq((this.table as any)[ownerField], userId)));
			return result.length > 0;
		} catch (error) {
			console.error("Error checking ownership:", error);
			return false;
		}
	}

	/**
	 * Get error response object - standardizes error handling
	 */
	protected errorResponse<T>(error: string): { data: null; error: T } {
		return {
			data: null,
			error: error as T,
		};
	}

	/**
	 * Get success response object - standardizes success responses
	 */
	protected successResponse<T>(data: T): { data: T; error: null } {
		return {
			data,
			error: null,
		};
	}
}
