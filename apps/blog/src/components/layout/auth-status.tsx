import { createSignal, Show } from "solid-js";

type User = {
	id: number;
	username: string;
	avatar_url: string | null;
};

interface Props {
	initialUser?: User | null;
}

const AuthStatus = (props: Props) => {
	const [user] = createSignal<User | null>(props.initialUser ?? null);

	return (
		<div class="user-info">
			<Show
				when={user()}
				fallback={
					<a href="/api/auth/login" class="auth-btn login-btn">
						Login
					</a>
				}
			>
				{u => (
					<>
						<span class="user-name">{u().username}</span>
						<a href="/api/auth/logout" class="auth-btn logout-btn">
							Logout
						</a>
					</>
				)}
			</Show>
		</div>
	);
};

export default AuthStatus;
