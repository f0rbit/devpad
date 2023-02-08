"use client";

import { TASK_PROGRESS, TASK_VISIBILITY } from "@prisma/client";
import { Newspaper, Type } from "lucide-react";

type CreateItemOptions = {
	title: string;
	summary: TASK_PROGRESS;
};

export default function TodoCreator({ onCreate }: { onCreate: (item: CreateItemOptions) => void }) {
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
				<div className="flex flex-row items-center justify-center gap-2">
					<button className="primary-btn-outline rounded-md px-4 py-1">Create</button>
				</div>
			</div>
		</div>
	);
}
