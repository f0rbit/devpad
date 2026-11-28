import { getBrowserClient } from "@devpad/core/ui/client";
import type { AuthUser } from "@devpad/schema/bindings";
import { Button } from "@f0rbit/ui";
import { type Component, createSignal, For, Show } from "solid-js";
import { unwrap } from "@/lib/client";
import { date } from "../../lib/date-utils";
import DevpadConnection from "./devpad-connection";
import TokenForm from "./token-form";
import TokenList from "./token-list";

type User = NonNullable<AuthUser> & {
	username?: string;
	email?: string | null;
	created_at?: string;
	updated_at?: string;
};

type Token = {
	id: string;
	name: string | null;
	note: string | null;
	enabled: boolean;
	created_at: string;
};

type IntegrationDisplay = {
	id: string;
	name: string;
	connected: boolean;
	username?: string;
};

type SettingsPageProps = {
	initialUser?: User | null;
	initialTokens?: Token[];
};

const integrations: IntegrationDisplay[] = [
	{ id: "devto", name: "DEV.to", connected: false },
	{ id: "medium", name: "Medium", connected: false },
	{ id: "github", name: "GitHub", connected: false },
	{ id: "hashnode", name: "Hashnode", connected: false },
];

const handleIntegrationClick = (integration: IntegrationDisplay) => {
	alert(`${integration.name} integration coming soon!`);
};

const SettingsPage: Component<SettingsPageProps> = (props) => {
	const [user] = createSignal<User | null>(props.initialUser ?? null);

	const [tokens, setTokens] = createSignal<Token[]>(props.initialTokens ?? []);
	const [tokensLoading, setTokensLoading] = createSignal(false);
	const [tokensError, setTokensError] = createSignal<string | null>(null);

	const [showModal, setShowModal] = createSignal(false);

	const fetchTokens = async () => {
		try {
			const data = unwrap(await getBrowserClient().blog.tokens.list());
			setTokens(data.tokens);
		} catch (error) {
			console.error("[settings] token fetch failed:", error);
			setTokensError("Failed to fetch tokens");
		} finally {
			setTokensLoading(false);
		}
	};

	const refetchTokens = () => {
		setTokensLoading(true);
		setTokensError(null);
		void fetchTokens();
	};

	const handleToggle = async (id: string, enabled: boolean) => {
		setTokensError(null);
		try {
			unwrap(await getBrowserClient().blog.tokens.update(id, { enabled }));
			refetchTokens();
		} catch (error) {
			console.error("[settings] token update failed:", error);
			setTokensError("Failed to update token");
		}
	};

	const handleDelete = async (id: string) => {
		setTokensError(null);
		try {
			unwrap(await getBrowserClient().blog.tokens.delete(id));
			refetchTokens();
		} catch (error) {
			console.error("[settings] token delete failed:", error);
			setTokensError("Failed to delete token");
		}
	};

	const handleCreate = async (data: { name: string; note?: string }): Promise<{ key: string }> => {
		const result = unwrap(await getBrowserClient().blog.tokens.create(data));
		refetchTokens();
		return { key: result.token };
	};

	return (
		<div class="stack" style={{ gap: "24px" }}>
			<section class="settings-section">
				<h3 class="settings-section__title">Profile</h3>
				<div class="settings-section__content">
					<Show when={user()} keyed fallback={<p class="text-muted text-sm">Not signed in</p>}>
						{(userData) => (
							<>
								<div class="profile-row">
									<span class="profile-row__label">Username</span>
									<span class="profile-row__value">{userData.username ?? userData.name}</span>
								</div>
								<div class="profile-row">
									<span class="profile-row__label">Email</span>
									<span class="profile-row__value">{userData.email ?? "Not set"}</span>
								</div>
								<div class="profile-row">
									<span class="profile-row__label">User ID</span>
									<span class="profile-row__value font-mono text-sm">{userData.id}</span>
								</div>
								<Show when={userData.created_at} keyed>
									{(createdAt) => (
										<div class="profile-row">
											<span class="profile-row__label">Created</span>
											<span class="profile-row__value">{date.format(createdAt)}</span>
										</div>
									)}
								</Show>
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
						{(integration) => (
							<div class="integration-row">
								<span class="integration-row__name">{integration.name}</span>
								<Show
									when={integration.connected}
									fallback={
										<>
											<span class="integration-row__status text-muted">Not connected</span>
											<Button
												variant="secondary"
												onClick={() => {
													handleIntegrationClick(integration);
												}}
											>
												Connect
											</Button>
										</>
									}
								>
									<span class="integration-row__status">
										<span class="integration-connected">✓</span> @{integration.username}
									</span>
									<Button
										variant="secondary"
										onClick={() => {
											handleIntegrationClick(integration);
										}}
									>
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
						<div
							style={{
								padding: "0.5rem 0.75rem",
								background: "var(--item-red)",
								border: "1px solid var(--item-red-border)",
								"border-radius": "4px",
							}}
						>
							<p class="text-sm">{tokensError()}</p>
						</div>
					</Show>

					<Show when={tokensLoading()}>
						<p class="text-muted text-sm">Loading tokens...</p>
					</Show>

					<Show when={tokens()} keyed>
						{(tokenList) => (
							<TokenList
								tokens={tokenList}
								onToggle={(id, enabled) => void handleToggle(id, enabled)}
								onDelete={(id) => void handleDelete(id)}
							/>
						)}
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
