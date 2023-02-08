"use client";

import { TASK_PROGRESS, TASK_VISIBILITY } from "@prisma/client";
import { ChevronDown, ChevronRight, Newspaper, Type } from "lucide-react";
import { useState } from "react";
import StatusIcon from "../Todo/StatusIcon";
import { COLOURS } from "../Todo/TodoCard";
import VisiblityIcon from "../Todo/VisibilityIcon";

type CreateItemOptions = {
	title: string;
	summary: TASK_PROGRESS;
	visibility?: TASK_VISIBILITY;
	progress?: TASK_PROGRESS;
};

type TodoCreatorProps = {
	onCreate: (item: CreateItemOptions) => void;
};

export default function TodoCreator({ onCreate }: TodoCreatorProps) {
	const [item, setItem] = useState({} as CreateItemOptions);
	const [expandedOptions, setExpandedOptions] = useState(false);

	return (
		<div className="styled-input flex flex-col items-center justify-center gap-1 rounded-md border-1 border-borders-secondary pt-1 pb-2">
			<div className="mb-2 w-full border-b-1 border-b-borders-secondary pb-1 text-center font-semibold text-base-text-primary">New Task</div>
			<div className="flex w-full flex-col gap-2 px-2 text-base-text-subtlish">
				<div className="flex flex-row items-center gap-2">
					<Type className="w-5" />
					<input type="text" placeholder="Title" className="flex-1 rounded-md border-1 border-borders-secondary p-2 text-base-text-primary" />
				</div>
				<div className="flex flex-row items-center gap-2">
					<Newspaper className="w-5" />
					<input type="text" placeholder="Summary" className="flex-1 rounded-md border-1 border-borders-secondary p-2" />
				</div>
				<div className="flex justify-center items-center w-ful text-base-text-subtle">
					<button className="flex flex-row gap-1 	 items-center justify-center transition-all duration-300" onClick={() => setExpandedOptions(!expandedOptions)}>
						<div>{expandedOptions ? <ChevronRight /> : <ChevronDown />}</div>
						<div>Options</div>
					</button>
				</div>
				

				{expandedOptions && (
					<div>
						<VisibilitySelector select={(visibility) => setItem({ ...item, visibility })} selected={item.visibility} />
					</div>
				)}
				{expandedOptions && <ProgressSelector select={(progress) => setItem({ ...item, progress })} selected={item.progress} />}
				<div className="flex flex-row items-center justify-center gap-2">
					<button className="primary-btn-outline rounded-md px-4 py-1">Create</button>
				</div>
			</div>
		</div>
	);
}

function VisibilitySelector({ select, selected }: { select: (visibility: TASK_VISIBILITY) => void; selected?: TASK_VISIBILITY }) {
	const selectable = Object.values(TASK_VISIBILITY).filter((visibility) => visibility != TASK_VISIBILITY.DELETED && visibility != TASK_VISIBILITY.ARCHIVED);
	return (
		<div className="flex flex-row items-center justify-center gap-2">
			{selectable.map((visibility, index) => (
				<button
					className={"flex w-full items-center justify-center rounded-md border-1 border-borders-primary px-4 py-1 " + (selected == visibility ? "border-borders-secondary bg-base-accent-secondary" : "")}
					onClick={() => select(visibility)}
					key={index}
					title={visibility}
				>
					<VisiblityIcon visibility={visibility} />
				</button>
			))}
		</div>
	);
}

function ProgressSelector({ select, selected }: { select: (progress: TASK_PROGRESS) => void; selected?: TASK_PROGRESS }) {
	const selectable = Object.values(TASK_PROGRESS);
	return (
		<div className="flex flex-row items-center justify-center gap-2">
			{selectable.map((progress, index) => (
				<button
					className={"flex w-full items-center justify-center rounded-md border-1 border-borders-primary px-4 py-1 " + (selected == progress ? "border-borders-secondary bg-base-accent-secondary" : "")}
					onClick={() => select(progress)}
					key={index}
					title={progress}
				>
					<div className={COLOURS[progress]?.colour + " fill-current"}>
						<StatusIcon status={progress} />
					</div>
				</button>
			))}
		</div>
	);
}
