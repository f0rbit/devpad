import type { AccessKey, User as SchemaUser } from "@devpad/schema/blog";
import { Button } from "@f0rbit/ui";
import { type Component, createSignal, For, Show } from "solid-js";
import { getClient, unwrap } from "@/lib/client";
import { date } from "../../lib/date-utils";
import DevpadConnection from "./devpad-connection";
import TokenForm from "./token-form";
import TokenList from "./token-list";

type User = Omit<SchemaUser, "created_at" | "updated_at"> & {
	created_at: string;
	updated_at: string;
};

type Token = {
	id: AccessKey["id"];
	name: AccessKey["name"];
	note: AccessKey["note"];
	enabled: AccessKey["enabled"];
	created_at: string;
};

interface IntegrationDisplay {
	id: string;
	name: string;
	connected: boolean;
	username?: string;
}

interface SettingsPageProps {
	initialUser?: User | null;
	initialTokens?: Token[];
}

const integrations: IntegrationDisplay[] = [
	{ id: "devto", name: "DEV.to", connected: false },
	{ id: "medium", name: "Medium", connected: false },
	{ id: "github", name: "GitHub", connected: false },
	{ id: "hashnode", name: "Hashnode", connected: false },
];

const SettingsPage: Component<SettingsPageProps> = props => {
	const [user] = createSignal<User | null>(props.initialUser ?? null);

	const [tokens, setTokens] = createSignal<Token[]>(props.initialTokens ?? []);
	const [tokensLoading, setTokensLoading] = createSignal(false);
	const [tokensError, setTokensError] = createSignal<string | null>(null);

	const [showModal, setShowModal] = createSignal(false);

	const fetchTokens = async () => {
		try {
			const data = unwrap(await getClient().blog.tokens.list());
			setTokens((data.tokens ?? []) as Token[]);
		} catch {
			setTokensError("Failed to fetch tokens");
		} finally {
			setTokensLoading(false);
		}
	};

	const refetchTokens = () => {
		setTokensLoading(true);
		setTokensError(null);
		fetchTokens();
	};

	const handleToggle = async (id: number, enabled: boolean) => {
		setTokensError(null);
		try {
			unwrap(await getClient().blog.tokens.update(String(id), { enabled }));
			refetchTokens();
		} catch {
			setTokensError("Failed to update token");
		}
	};

	const handleDelete = async (id: number) => {
		setTokensError(null);
		try {
			unwrap(await getClient().blog.tokens.delete(String(id)));
			refetchTokens();
		} catch {
			setTokensError("Failed to delete token");
		}
	};

	const handleCreate = async (data: { name: string; note?: string }): Promise<{ key: string }> => {
		const result = unwrap(await getClient().blog.tokens.create(data));
		refetchTokens();
		return { key: result.token };
	};

	const handleIntegrationClick = (integration: IntegrationDisplay) => {
		alert(`${integration.name} integration coming soon!`);
	};

	return (
		<div class="stack" style={{ gap: "24px" }}>
			<section class="settings-section">
				<h3 class="settings-section__title">Profile</h3>
				<div class="settings-section__content">
					<Show when={user()} keyed fallback={<p class="text-muted text-sm">Not signed in</p>}>
						{userData => (
							<>
								<div class="profile-row">
									<span class="profile-row__label">Username</span>
									<span class="profile-row__value">{userData.username}</span>
								</div>
								<div class="profile-row">
									<span class="profile-row__label">Email</span>
									<span class="profile-row__value">{userData.email ?? "Not set"}</span>
								</div>
								<div class="profile-row">
									<span class="profile-row__label">User ID</span>
									<span class="profile-row__value mono text-sm">{userData.id}</span>
								</div>
								<div class="profile-row">
									<span class="profile-row__label">Created</span>
									<span class="profile-row__value">{date.format(userData.created_at)}</span>
								</div>
								<div class="profile-note">
									<p class="text-sm text-muted">Profile is managed by DevPad.</p>
									<a href="https://devpad.tools/settings" target="_blank" rel="noopener noreferrer" class="text-sm">
										Go to DevPad Settings →
									</a>
								</div>
							</>
						)}
					</Show>
				</div>
			</section>

			<section class="settings-section">
				<h3 class="settings-section__title">Integrations</h3>
				<div class="settings-section__content">
					<For each={integrations}>
						{integration => (
							<div class="integration-row">
								<span class="integration-row__name">{integration.name}</span>
								<Show
									when={integration.connected}
									fallback={
										<>
											<span class="integration-row__status text-muted">Not connected</span>
											<Button variant="secondary" onClick={() => handleIntegrationClick(integration)}>
												Connect
											</Button>
										</>
									}
								>
									<span class="integration-row__status">
										<span class="integration-connected">✓</span> @{integration.username}
									</span>
									<Button variant="secondary" onClick={() => handleIntegrationClick(integration)}>
										Disconnect
									</Button>
								</Show>
							</div>
						)}
					</For>
				</div>
			</section>

			<section class="settings-section">
				<h3 class="settings-section__title">DevPad Integration</h3>
				<div class="settings-section__content">
					<DevpadConnection />
				</div>
			</section>

			<section class="settings-section">
				<h3 class="settings-section__title">API Tokens</h3>
				<div class="settings-section__content">
					<Show when={tokensError()}>
						<div class="form-error">
							<p class="text-sm">{tokensError()}</p>
						</div>
					</Show>

					<Show when={tokensLoading()}>
						<p class="text-muted text-sm">Loading tokens...</p>
					</Show>

					<Show when={tokens()} keyed>
						{tokenList => <TokenList tokens={tokenList} onToggle={handleToggle} onDelete={handleDelete} />}
					</Show>

					<div class="settings-section__actions">
						<Button variant="primary" onClick={() => setShowModal(true)}>
							+ Create Token
						</Button>
					</div>
				</div>
			</section>

			<TokenForm isOpen={showModal()} onSubmit={handleCreate} onClose={() => setShowModal(false)} />
		</div>
	);
};

export default SettingsPage;
