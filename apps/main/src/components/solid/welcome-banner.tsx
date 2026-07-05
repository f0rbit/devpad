import { Badge, Button } from "@f0rbit/ui";
import ChevronRight from "lucide-solid/icons/chevron-right";
import FolderPlus from "lucide-solid/icons/folder-plus";
import ListChecks from "lucide-solid/icons/list-checks";
import ScanText from "lucide-solid/icons/scan-text";
import X from "lucide-solid/icons/x";
import { createSignal, For, onMount, Show } from "solid-js";
import GithubIcon from "@/components/solid/github-icon";

const DISMISS_KEY = "devpad_welcome_dismissed";

interface Props {
	project_count: number;
}

interface Step {
	icon: typeof FolderPlus;
	title: string;
	description: string;
	href: string | null;
}

const STEPS: Step[] = [
	{
		icon: FolderPlus,
		title: "create a project",
		description: "give it a name, description, and status",
		href: "/project/create",
	},
	{
		icon: GithubIcon,
		title: "link a github repo",
		description: "connect a repository to enable code scanning",
		href: "/project/create",
	},
	{
		icon: ScanText,
		title: "run your first scan",
		description: "scan your codebase for TODO and FIXME comments",
		href: null,
	},
	{
		icon: ListChecks,
		title: "manage your tasks",
		description: "review scanned tasks, set priorities, track progress",
		href: "/todo",
	},
];

export function WelcomeBanner(props: Props) {
	const [visible, setVisible] = createSignal(false);

	onMount(() => {
		if (props.project_count > 0) return;
		const dismissed = localStorage.getItem(DISMISS_KEY);
		if (dismissed) return;
		setVisible(true);
	});

	const dismiss = () => {
		setVisible(false);
		localStorage.setItem(DISMISS_KEY, "true");
	};

	return (
		<Show when={visible()}>
			<div
				class="stack stack-sm"
				style={{
					border: "1px solid var(--border)",
					"border-radius": "6px",
					padding: "16px 20px",
					"margin-bottom": "16px",
					background: "var(--bg-alt)",
				}}
			>
				<div class="row row-between">
					<div class="row row-sm">
						<h4 style={{ margin: 0 }}>welcome to devpad</h4>
						<Badge variant="accent">getting started</Badge>
					</div>
					<Button variant="ghost" size="sm" onClick={dismiss} aria-label="dismiss welcome banner">
						<X size={16} />
					</Button>
				</div>
				<p style={{ color: "var(--fg-subtle)", margin: 0 }}>here's how to get started:</p>
				<ol class="stack stack-sm" style={{ "list-style": "none", padding: 0, margin: 0 }}>
					<For each={STEPS}>
						{(step, i) => (
							<li class="row row-start" style={{ gap: "10px" }}>
								<span style={{ color: "var(--accent)", "flex-shrink": 0, "margin-top": "2px", "min-width": "20px" }}>
									<step.icon size={18} />
								</span>
								<div class="stack" style={{ gap: "2px", flex: 1 }}>
									<div class="row row-sm">
										<strong style={{ color: "var(--fg)" }}>
											{i() + 1}. {step.title}
										</strong>
										<Show when={step.href}>
											<a
												href={step.href ?? undefined}
												class="row row-sm"
												style={{ "font-size": "smaller", color: "var(--accent)", "text-decoration": "none" }}
												aria-label={`go to ${step.title}`}
											>
												<ChevronRight size={14} />
											</a>
										</Show>
									</div>
									<span style={{ "font-size": "smaller", color: "var(--fg-subtle)" }}>{step.description}</span>
								</div>
							</li>
						)}
					</For>
				</ol>
			</div>
		</Show>
	);
}
