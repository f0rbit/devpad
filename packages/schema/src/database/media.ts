import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export { corpus_snapshots } from "@f0rbit/corpus/schema";

export type MediaPlatform = "github" | "bluesky" | "youtube" | "devpad" | "reddit" | "twitter";

export const media_profiles = sqliteTable(
	"media_profiles",
	{
		id: text("id").primaryKey(),
		user_id: text("user_id").notNull(),
		slug: text("slug").notNull(),
		name: text("name").notNull(),
		description: text("description"),
		theme: text("theme"),
		created_at: text("created_at").notNull(),
		updated_at: text("updated_at").notNull(),
	},
	table => ({
		user_idx: index("idx_media_profiles_user").on(table.user_id),
		user_slug_idx: uniqueIndex("idx_media_profiles_user_slug").on(table.user_id, table.slug),
	})
);

export const media_accounts = sqliteTable(
	"media_accounts",
	{
		id: text("id").primaryKey(),
		profile_id: text("profile_id")
			.notNull()
			.references(() => media_profiles.id, { onDelete: "cascade" }),
		platform: text("platform").notNull().$type<MediaPlatform>(),
		platform_user_id: text("platform_user_id"),
		platform_username: text("platform_username"),
		access_token_encrypted: text("access_token_encrypted").notNull(),
		refresh_token_encrypted: text("refresh_token_encrypted"),
		token_expires_at: text("token_expires_at"),
		is_active: integer("is_active", { mode: "boolean" }).default(true),
		last_fetched_at: text("last_fetched_at"),
		created_at: text("created_at").notNull(),
		updated_at: text("updated_at").notNull(),
	},
	table => ({
		profile_idx: index("idx_media_accounts_profile").on(table.profile_id),
		profile_platform_user_idx: uniqueIndex("idx_media_accounts_profile_platform_user").on(table.profile_id, table.platform, table.platform_user_id),
	})
);

export const media_rate_limits = sqliteTable(
	"media_rate_limits",
	{
		id: text("id").primaryKey(),
		account_id: text("account_id")
			.notNull()
			.references(() => media_accounts.id),
		remaining: integer("remaining"),
		limit_total: integer("limit_total"),
		reset_at: text("reset_at"),
		consecutive_failures: integer("consecutive_failures").default(0),
		last_failure_at: text("last_failure_at"),
		circuit_open_until: text("circuit_open_until"),
		updated_at: text("updated_at").notNull(),
	},
	table => ({
		account_idx: uniqueIndex("idx_media_rate_limits_account").on(table.account_id),
	})
);

export const media_account_settings = sqliteTable(
	"media_account_settings",
	{
		id: text("id").primaryKey(),
		account_id: text("account_id")
			.notNull()
			.references(() => media_accounts.id, { onDelete: "cascade" }),
		setting_key: text("setting_key").notNull(),
		setting_value: text("setting_value").notNull(),
		created_at: text("created_at").notNull(),
		updated_at: text("updated_at").notNull(),
	},
	table => ({
		account_key_idx: uniqueIndex("idx_media_account_settings_unique").on(table.account_id, table.setting_key),
		account_idx: index("idx_media_account_settings_account").on(table.account_id),
	})
);

export const media_profile_filters = sqliteTable(
	"media_profile_filters",
	{
		id: text("id").primaryKey(),
		profile_id: text("profile_id")
			.notNull()
			.references(() => media_profiles.id, { onDelete: "cascade" }),
		account_id: text("account_id")
			.notNull()
			.references(() => media_accounts.id, { onDelete: "cascade" }),
		filter_type: text("filter_type").notNull().$type<"include" | "exclude">(),
		filter_key: text("filter_key").notNull(),
		filter_value: text("filter_value").notNull(),
		created_at: text("created_at").notNull(),
		updated_at: text("updated_at").notNull(),
	},
	table => ({
		profile_idx: index("idx_media_profile_filters_profile").on(table.profile_id),
		account_idx: index("idx_media_profile_filters_account").on(table.account_id),
	})
);

export const media_platform_credentials = sqliteTable(
	"media_platform_credentials",
	{
		id: text("id").primaryKey(),
		profile_id: text("profile_id")
			.notNull()
			.references(() => media_profiles.id, { onDelete: "cascade" }),
		platform: text("platform").notNull().$type<MediaPlatform>(),
		client_id: text("client_id").notNull(),
		client_secret_encrypted: text("client_secret_encrypted").notNull(),
		redirect_uri: text("redirect_uri"),
		metadata: text("metadata"),
		is_verified: integer("is_verified", { mode: "boolean" }).default(false),
		created_at: text("created_at").notNull(),
		updated_at: text("updated_at").notNull(),
	},
	table => ({
		profile_platform_idx: uniqueIndex("idx_platform_credentials_unique").on(table.profile_id, table.platform),
		profile_idx: index("idx_platform_credentials_profile").on(table.profile_id),
	})
);
