import { createLogger } from "../../../utils/logger";
import type { AppContext } from "../context";
import { GitHubProvider } from "../platforms";
import { RedditProvider } from "../platforms/reddit";
import { TwitterProvider } from "../platforms/twitter";
import type { ProviderFactory } from "../platforms/types";
import { type AccountWithUser, connection } from "../services/connections";
import { type PlatformGroups, processAccount, type RawSnapshot, userTimeline } from "../sync";
import { processGitHubAccount } from "./processors/github";
import { processRedditAccount } from "./processors/reddit";
import { processTwitterAccount } from "./processors/twitter";
import type { CronResult } from "./types";

export { createMerger, defaultStats, formatFetchError, type MergeResult, type PlatformProvider, type ProcessError, type ProcessResult, type StoreConfig, type StoreStats, storeMeta, storeWithMerge } from "./platform-processor";
export { type GitHubProcessResult, processGitHubAccount } from "./processors/github";
export { processRedditAccount, type RedditProcessResult } from "./processors/reddit";
export { processTwitterAccount, type TwitterProcessResult } from "./processors/twitter";
export type { CronResult, PlatformGroups, RawSnapshot } from "./types";
export type { ProviderFactory };

export { userTimeline, processAccount };

const log = createLogger("cron");

const groupAccountsByUser = (accountsWithUsers: AccountWithUser[]): Map<string, AccountWithUser[]> => {
	const userAccounts = new Map<string, AccountWithUser[]>();
	for (const account of accountsWithUsers) {
		const existing = userAccounts.get(account.user_id) ?? [];
		existing.push(account);
		userAccounts.set(account.user_id, existing);
	}
	return userAccounts;
};

const processAccountBatch = async (ctx: AppContext, userAccountsList: AccountWithUser[], result: CronResult): Promise<boolean> => {
	const results = await Promise.allSettled(
		userAccountsList.map(async account => {
			result.processed_accounts++;
			const snapshot = await processAccount(ctx, account);
			return snapshot !== null;
		})
	);

	let hasUpdates = false;
	for (const res of results) {
		if (res.status === "rejected") {
			log.error("Account processing failed", { reason: String(res.reason) });
		} else if (res.value) {
			hasUpdates = true;
		}
	}

	return hasUpdates;
};

export async function handleCron(ctx: AppContext): Promise<CronResult> {
	log.info("Cron job starting");

	const result: CronResult = {
		processed_accounts: 0,
		updated_users: [],
		failed_accounts: [],
		timelines_generated: 0,
	};

	const accountsWithUsers = await connection.activeAll(ctx.db);
	const userAccounts = groupAccountsByUser(accountsWithUsers);

	log.info("Processing accounts", { total: accountsWithUsers.length, users: userAccounts.size });

	const updatedUsers = new Set<string>();

	for (const [userId, userAccountsList] of userAccounts) {
		const hasUpdates = await processAccountBatch(ctx, userAccountsList, result);
		if (hasUpdates) {
			updatedUsers.add(userId);
		}
	}

	result.timelines_generated = await userTimeline.regenerate(ctx.backend, updatedUsers, userAccounts);
	result.updated_users = Array.from(updatedUsers);

	log.info("Cron job completed", {
		processed: result.processed_accounts,
		timelines: result.timelines_generated,
		updated_users: result.updated_users.length,
		failed: result.failed_accounts.length,
	});

	return result;
}
