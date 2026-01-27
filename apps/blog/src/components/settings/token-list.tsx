import type { AccessKey } from "@devpad/schema/blog";
import { Button, Empty } from "@f0rbit/ui";
import { type Component, For, Show } from "solid-js";
import { date } from "../../lib/date-utils";

type Token = {
	id: AccessKey["id"];
	name: AccessKey["name"];
	note: AccessKey["note"];
	enabled: AccessKey["enabled"];
	created_at: string;
};

interface TokenListProps {
	tokens: Token[];
	onToggle: (id: number, enabled: boolean) => void;
	onDelete: (id: number) => void;
}

const TokenList: Component<TokenListProps> = props => {
	return (
		<div class="token-list">
			<Show when={props.tokens.length === 0}>
				<Empty title="No API tokens yet" description="Create a token to get started" />
			</Show>
			<For each={props.tokens}>
				{token => (
					<div class="token-item" classList={{ "card-inactive": !token.enabled }}>
						<div class="token-item__info">
							<span class="token-item__name">{token.name}</span>
							<div class="token-item__meta">
								<Show when={token.note}>
									<span>{token.note}</span>
									<span> · </span>
								</Show>
								<span>Created {date.format(token.created_at)}</span>
								<span> · </span>
								<span>{token.enabled ? "Enabled" : "Disabled"}</span>
							</div>
						</div>
						<div class="token-item__actions">
							<Button variant="secondary" onClick={() => props.onToggle(token.id, !token.enabled)}>
								{token.enabled ? "Disable" : "Enable"}
							</Button>
							<Button variant="danger" onClick={() => props.onDelete(token.id)}>
								Delete
							</Button>
						</div>
					</div>
				)}
			</For>
		</div>
	);
};

export default TokenList;
