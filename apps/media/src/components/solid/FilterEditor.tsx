import { Button, Empty, FormField, Input, Modal, ModalBody, ModalHeader, ModalTitle, Select } from "@f0rbit/ui";
import { X } from "lucide-solid";
import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { getClient } from "@/utils/client";
import PlatformIcon from "./PlatformIcon";
import { ErrorDisplay, Loading } from "./ResourceState";

type Filter = {
	id: string;
	account_id: string;
	platform: string;
	filter_type: "include" | "exclude";
	filter_key: string;
	filter_value: string;
};

type Account = {
	id: string;
	platform: string;
	platform_username: string | null;
};

type FilterEditorProps = {
	profileId: string;
	accounts: Account[];
	isOpen: boolean;
	onClose: () => void;
};

const FILTER_KEYS_BY_PLATFORM: Record<string, string[]> = {
	github: ["repo", "keyword"],
	reddit: ["subreddit", "keyword"],
	twitter: ["twitter_account", "keyword"],
};

const FILTER_KEY_LABELS: Record<string, string> = {
	repo: "Repository",
	subreddit: "Subreddit",
	keyword: "Keyword",
	twitter_account: "Account",
};

const fetchFilters = async (profileId: string): Promise<Filter[]> => {
	const result = await getClient().media.profiles.filters.list(profileId);
	if (!result.ok) throw new Error(result.error.message);
	return result.value as Filter[];
};

const getPlatformForAccount = (accounts: Account[], accountId: string): string | undefined => accounts.find(a => a.id === accountId)?.platform;

const getFilterKeysForPlatform = (platform: string): string[] => FILTER_KEYS_BY_PLATFORM[platform] ?? ["keyword"];

const formatFilterDescription = (filter: Filter): string => {
	const keyLabel = FILTER_KEY_LABELS[filter.filter_key] ?? filter.filter_key;
	return `${keyLabel}: ${filter.filter_value}`;
};

const groupAccountsByPlatform = (accounts: Account[]): Map<string, Account[]> =>
	accounts.reduce((map, account) => {
		const existing = map.get(account.platform) ?? [];
		map.set(account.platform, [...existing, account]);
		return map;
	}, new Map<string, Account[]>());

export default function FilterEditor(props: FilterEditorProps) {
	const [filters, { refetch }] = createResource(() => fetchFilters(props.profileId));

	const [accountId, setAccountId] = createSignal(props.accounts[0]?.id ?? "");
	const [filterType, setFilterType] = createSignal<"include" | "exclude">("include");
	const [filterKey, setFilterKey] = createSignal("keyword");
	const [filterValue, setFilterValue] = createSignal("");
	const [adding, setAdding] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	const selectedPlatform = createMemo(() => getPlatformForAccount(props.accounts, accountId()));
	const availableFilterKeys = createMemo(() => getFilterKeysForPlatform(selectedPlatform() ?? ""));
	const groupedAccounts = createMemo(() => groupAccountsByPlatform(props.accounts));

	const handleAccountChange = (newAccountId: string) => {
		setAccountId(newAccountId);
		const platform = getPlatformForAccount(props.accounts, newAccountId);
		const keys = getFilterKeysForPlatform(platform ?? "");
		if (!keys.includes(filterKey())) {
			setFilterKey(keys[0] ?? "keyword");
		}
	};

	const addFilter = async () => {
		if (!accountId() || !filterValue().trim()) {
			setError("Please fill in all fields");
			return;
		}

		setAdding(true);
		setError(null);

		const result = await getClient().media.profiles.filters.add(props.profileId, {
			account_id: accountId(),
			filter_type: filterType(),
			filter_key: filterKey(),
			filter_value: filterValue().trim(),
		});

		if (result.ok) {
			setFilterValue("");
			refetch();
		} else {
			setError(result.error.message);
		}

		setAdding(false);
	};

	const removeFilter = async (filterId: string) => {
		const result = await getClient().media.profiles.filters.remove(props.profileId, filterId);
		if (result.ok) {
			refetch();
		} else {
			setError(result.error.message);
		}
	};

	const handleSubmit = (e: Event) => {
		e.preventDefault();
		addFilter();
	};

	return (
		<Modal open={props.isOpen} onClose={props.onClose}>
			<ModalHeader>
				<ModalTitle>Content Filters</ModalTitle>
			</ModalHeader>

			<ModalBody>
				<Show when={filters.loading}>
					<Loading size="sm" message="Loading filters..." />
				</Show>

				<Show when={filters.error}>
					<ErrorDisplay message="Failed to load filters" />
				</Show>

				<Show when={!filters.loading && !filters.error}>
					<div class="filter-list">
						<Show when={(filters()?.length ?? 0) === 0}>
							<Empty title="No filters configured" description="Add filters to include or exclude specific content." />
						</Show>

						<For each={filters()}>{filter => <FilterItem filter={filter} accounts={props.accounts} onRemove={() => removeFilter(filter.id)} />}</For>
					</div>
				</Show>

				<form class="filter-add-form" onSubmit={handleSubmit}>
					<h6 class="secondary font-medium">Add Filter</h6>

					<FormField label="Account">
						<Select value={accountId()} onChange={e => handleAccountChange(e.currentTarget.value)}>
							<For each={[...groupedAccounts().entries()]}>
								{([platform, accounts]) => (
									<optgroup label={formatPlatformLabel(platform)}>
										<For each={accounts}>{account => <option value={account.id}>{account.platform_username ?? account.id.slice(0, 8)}</option>}</For>
									</optgroup>
								)}
							</For>
						</Select>
					</FormField>

					<FormField label="Filter Type">
						<div class="filter-type-toggle">
							<button type="button" class={`filter-type-btn ${filterType() === "include" ? "filter-type-include active" : ""}`} onClick={() => setFilterType("include")}>
								Include
							</button>
							<button type="button" class={`filter-type-btn ${filterType() === "exclude" ? "filter-type-exclude active" : ""}`} onClick={() => setFilterType("exclude")}>
								Exclude
							</button>
						</div>
					</FormField>

					<FormField label="Filter Key">
						<Select value={filterKey()} onChange={e => setFilterKey(e.currentTarget.value)}>
							<For each={availableFilterKeys()}>{key => <option value={key}>{FILTER_KEY_LABELS[key] ?? key}</option>}</For>
						</Select>
					</FormField>

					<FormField label="Value" error={error() ?? undefined}>
						<Input type="text" value={filterValue()} onInput={e => setFilterValue(e.currentTarget.value)} placeholder={getPlaceholder(filterKey())} error={!!error()} />
					</FormField>

					<div class="filter-form-actions">
						<Button type="submit" disabled={adding() || !filterValue().trim()} loading={adding()}>
							Add Filter
						</Button>
					</div>
				</form>
			</ModalBody>
		</Modal>
	);
}

type FilterItemProps = {
	filter: Filter;
	accounts: Account[];
	onRemove: () => void;
};

function FilterItem(props: FilterItemProps) {
	const account = () => props.accounts.find(a => a.id === props.filter.account_id);
	const isInclude = () => props.filter.filter_type === "include";

	return (
		<div class={`filter-item ${isInclude() ? "filter-item-include" : "filter-item-exclude"}`}>
			<div class="filter-item-icon">
				<PlatformIcon platform={props.filter.platform} size={14} />
			</div>
			<div class="filter-item-content">
				<span class={`filter-item-type ${isInclude() ? "filter-type-include" : "filter-type-exclude"}`}>{isInclude() ? "Include" : "Exclude"}</span>
				<span class="filter-item-description">{formatFilterDescription(props.filter)}</span>
				<Show when={account()?.platform_username}>
					<span class="filter-item-account muted text-xs">({account()?.platform_username})</span>
				</Show>
			</div>
			<Button icon variant="ghost" onClick={props.onRemove} label="Remove filter">
				<X size={14} />
			</Button>
		</div>
	);
}

const formatPlatformLabel = (platform: string): string => platform.charAt(0).toUpperCase() + platform.slice(1);

const getPlaceholder = (filterKey: string): string => {
	switch (filterKey) {
		case "repo":
			return "owner/repository";
		case "subreddit":
			return "programming";
		case "twitter_account":
			return "@username";
		case "keyword":
			return "search term";
		default:
			return "value";
	}
};
