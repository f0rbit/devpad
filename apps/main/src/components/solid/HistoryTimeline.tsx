// takes an array of HistoryAction[], draws a timeline of them.
// we want to add pagination as well.
// using solidjs

import type { HistoryAction, ScanStatus } from "@devpad/schema";
import ArrowRight from "lucide-solid/icons/arrow-right";
import FileMinus2 from "lucide-solid/icons/file-minus-2";
import FilePen from "lucide-solid/icons/file-pen";
import FilePlus2 from "lucide-solid/icons/file-plus-2";
import FolderMinus from "lucide-solid/icons/folder-minus";
import FolderPen from "lucide-solid/icons/folder-pen";
import FolderPlus from "lucide-solid/icons/folder-plus";
import GitBranch from "lucide-solid/icons/git-branch";
import ScanText from "lucide-solid/icons/scan-text";
import Type from "lucide-solid/icons/type";
import { createSignal, For } from "solid-js";

const pageSize = () => 10;

export default function HistoryTimeline(props: { actions: HistoryAction[]; view: "project" | "task" | "account" }) {
	// duplicate the actions x30 for testing
	const actions = props.actions;
	const [page, setPage] = createSignal(0);

	const pageCount = () => Math.ceil(actions.length / pageSize());

	const PageControls = () => {
		const renderPageNumbers = () => {
			const currentPage = page();
			const totalPages = pageCount();
			const maxVisiblePages = 5;
			const pageNumbers: (number | "...")[] = [];

			if (totalPages <= maxVisiblePages) {
				for (let i = 0; i < totalPages; i++) {
					pageNumbers.push(i);
				}
			} else {
				if (currentPage <= 2) {
					for (let i = 0; i < Math.min(maxVisiblePages - 1, totalPages); i++) {
						pageNumbers.push(i);
					}
					if (totalPages > maxVisiblePages) {
						pageNumbers.push("...");
						pageNumbers.push(totalPages - 1);
					}
				} else if (currentPage >= totalPages - 3) {
					pageNumbers.push(0);
					pageNumbers.push("...");
					for (let i = totalPages - maxVisiblePages + 1; i < totalPages; i++) {
						pageNumbers.push(i);
					}
				} else {
					pageNumbers.push(0);
					pageNumbers.push("...");
					for (let i = currentPage - 1; i <= currentPage + 1; i++) {
						pageNumbers.push(i);
					}
					pageNumbers.push("...");
					pageNumbers.push(totalPages - 1);
				}
			}

			return pageNumbers;
		};

		return (
			<div class="flex-row icons">
				{renderPageNumbers().map(item => (
					<a role="button" class={item === page() ? "active" : ""} onClick={() => typeof item === "number" && setPage(item)}>
						{item === "..." ? "..." : item + 1}
					</a>
				))}
			</div>
		);
	};

	return (
		<div class="flex-col">
			<div class="timeline-container">
				<For each={actions.slice(page() * pageSize(), page() * pageSize() + pageSize())}>{action => <TimelineItem action={action} view={props.view} />}</For>
			</div>
			<div>
				<div class="flex-col">
					<PageControls />
				</div>
			</div>
		</div>
	);
}

function TimelineItem({ action, view }: { action: HistoryAction; view: "project" | "task" | "account" }) {
	const ActionDate = () => {
		// Ensure 'action' is passed as a prop
		if (!action || !action.created_at) {
			return null; // Handle the case where action or created_at is undefined
		}

		// Parse the UTC date and convert it to a Date object
		const utcDate = new Date(`${action.created_at}Z`);

		// Automatically detect the user's locale
		const userLocale = navigator.language || "en-US";

		// Format the date and time in the user's locale and convert it to local timezone
		const dateString = new Intl.DateTimeFormat(userLocale, {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		}).format(utcDate);

		const timeString = new Intl.DateTimeFormat(userLocale, {
			hour: "2-digit",
			minute: "2-digit",
			hour12: true,
			timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		}).format(utcDate);

		return (
			<div class="date-highlighted flex-row" style={{ color: "var(--fg-subtle)" }}>
				<div class="date">{timeString}</div>
				<div class="year">{dateString}</div>
			</div>
		);
	};

	const ActionIcon = ({ type }: { type: HistoryAction["type"] }) => {
		switch (type) {
			case "SCAN":
				return <ScanText />;
			case "UPDATE_PROJECT":
				return <FolderPen />;
			case "CREATE_PROJECT":
				return <FolderPlus />;
			case "DELETE_PROJECT":
				return <FolderMinus />;
			case "CREATE_TASK":
				return <FilePlus2 />;
			case "UPDATE_TASK":
				return <FilePen />;
			case "DELETE_TASK":
				return <FileMinus2 />;
			default:
				return <span>?</span>;
		}
	};

	const Data = () => {
		switch (action.type) {
			case "SCAN": {
				const { message, status } = action.data as { message: string; status: Omit<ScanStatus, "PENDING"> };
				return (
					<div style="display: grid; grid-template-columns: min-content auto; align-items: center; gap: 5px;">
						<GitBranch />
						<span>{message}</span>
						<ArrowRight />
						<span>{status.toLowerCase()}</span>
					</div>
				);
			}
			case "UPDATE_TASK": {
				if (view === "task") return null;
				const { title } = action.data as { title: string };
				if (!title) return null;
				return (
					<div style="display: grid; grid-template-columns: min-content auto; align-items: center; gap: 5px;">
						<Type />
						<span>{title}</span>
					</div>
				);
			}
			case "CREATE_PROJECT":
			case "UPDATE_PROJECT":
			case "DELETE_PROJECT": {
				const { name = null, href = null } = action.data as { name: string | null; href: string | null };
				if (!name || !href) return null;
				return (
					<div style="display: grid; grid-template-columns: min-content auto; align-items: center; gap: 5px;">
						<FolderPlus />
						<a href={`/project/${href}`}>{name}</a>
					</div>
				);
			}
		}
		return <></>;
	};

	return (
		<div class="timeline-item">
			<div class="flex-row" style={{ "font-size": "smaller" }}>
				<ActionIcon type={action.type} />
				<ActionDate />
			</div>
			<div>{action.description}</div>
			<div style="padding-left: 15px; border-left: 1px solid var(--border); margin-left: 5px; font-size: 0.9em; color: var(--fg-subtle)">
				<Data />
			</div>
		</div>
	);
}
