import type { AuthUser } from "@devpad/schema/bindings";
import { DevpadAuth } from "./devpad-auth";
import { DevpadLogo } from "./devpad-logo";

export type AppId = "projects" | "tasks" | "blog" | "media" | "docs";

export interface DevpadHeaderProps {
	currentApp?: AppId;
	currentPath?: string;
	user: AuthUser;
	authVariant?: "main" | "sub";
}

type Domain = "main" | "blog" | "media";

const APP_DOMAIN: Record<AppId, Domain> = {
	projects: "main",
	tasks: "main",
	docs: "main",
	blog: "blog",
	media: "media",
};

const APP_PATH: Record<AppId, string> = {
	projects: "/project",
	tasks: "/todo",
	blog: "/",
	media: "/dashboard",
	docs: "/docs",
};

const DOMAIN_BASE: Record<Domain, string> = {
	main: "https://devpad.tools",
	blog: "https://blog.devpad.tools",
	media: "https://media.devpad.tools",
};

const NAV_ITEMS: AppId[] = ["projects", "tasks", "blog", "media", "docs"];

export function DevpadHeader(props: DevpadHeaderProps) {
	const currentDomain = (): Domain => {
		if (!props.currentApp) return "main";
		return APP_DOMAIN[props.currentApp];
	};

	const linkHref = (app: AppId): string => {
		const linkDomain = APP_DOMAIN[app];
		if (linkDomain === currentDomain()) {
			return APP_PATH[app];
		}
		return DOMAIN_BASE[linkDomain] + APP_PATH[app];
	};

	const isActive = (app: AppId): boolean => {
		if (props.currentApp) return props.currentApp === app;
		if (!props.currentPath) return false;
		const path = props.currentPath;
		if (app === "projects") return path.startsWith("/project");
		if (app === "tasks") return path.startsWith("/todo");
		if (app === "docs") return path.startsWith("/docs");
		return false;
	};

	const logoHref = currentDomain() === "main" ? "/" : DOMAIN_BASE.main;

	return (
		<div class="unified-header__row1">
			<div class="unified-header__left">
				<a href={logoHref} class="unified-header__logo">
					<DevpadLogo size={18} />
					<span>devpad</span>
				</a>
			</div>
			<nav class="unified-header__apps">
				{NAV_ITEMS.map(app => (
					<a href={linkHref(app)} class={`unified-header__app${isActive(app) ? " active" : ""}`}>
						{app}
					</a>
				))}
			</nav>
			<div class="unified-header__auth">
				<DevpadAuth user={props.user} variant={props.authVariant ?? "sub"} />
			</div>
		</div>
	);
}
