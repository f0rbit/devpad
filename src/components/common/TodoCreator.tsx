"use client";

import { CreateItemOptions, Module } from "@/types/page-link";
import { CalendarClock, ChevronDown, ChevronRight, Newspaper, Type } from "lucide-react";
import { useState } from "react";
import DatePicker from "react-datepicker";
import PrimaryButton from "./PrimaryButton";
import ProgressSelector from "./tasks/ProgressSelector";
import VisibilitySelector from "./tasks/VisibilitySelector";

const DEFAULT_ITEM: CreateItemOptions = {
	title: "",
	goal_id: undefined,
	modules: []
};

export default function TodoCreator({ onCreate }: { onCreate: (item: CreateItemOptions) => void }) {
	const [item, setItem] = useState(structuredClone(DEFAULT_ITEM) as CreateItemOptions);
	const [expandedOptions, setExpandedOptions] = useState(false);

	function updateModule(module: Module, data: any) {
		// update item modules, either adding or updating
		const modules = item.modules;
		const index = modules?.findIndex((m) => m.type == module);
		if (index == -1) {
			modules.push({ type: module, data });
		} else {
			modules[index] = { type: module, data };
		}
		setItem({ ...item, modules });
	}

	function getModule(module: Module): any | null {
		const modules = item.modules;
		const index = modules.findIndex((m) => m.type == module);
		return modules[index]?.data.valueOf() as any;
	}

	return (
		<div className="styled-input flex flex-col items-center justify-center gap-1 rounded-md border-1 border-borders-secondary pt-1 pb-2">
			<div className="mb-2 w-full border-b-1 border-b-borders-secondary pb-1 text-center font-semibold text-base-text-primary">New Task</div>
			<div className="flex w-full flex-col gap-2 px-2 text-base-text-subtlish">
				<div className="flex flex-row items-center gap-2 ">
					<Type className="w-5" />
					<input
						type="text"
						placeholder="Title"
						value={item?.title}
						className="flex-1 rounded-md border-1 border-borders-secondary p-2 text-base-text-primary"
						onChange={(e) => {
							setItem({ ...item, title: e.target.value });
						}}
					/>
				</div>
				<div className="flex flex-row items-center gap-2">
					<Newspaper className="w-5" />
					<input
						type="text"
						placeholder="Summary"
						className="flex-1 rounded-md border-1 border-borders-secondary p-2"
						value={getModule(Module.SUMMARY)?.summary ?? ""}
						onChange={(e) => {
							// setItem({ ...item, summary: e.target.value });
							updateModule(Module.SUMMARY, { summary: e.target.value });
						}}
					/>
				</div>
				<div className="flex flex-row items-center gap-2">
					<CalendarClock className="w-5" />
					<DatePicker
						wrapperClassName="devpad-date"
						className="scrollbar-hide text-base-text-secondary"
						showTimeSelect
						selected={getModule(Module.END_DATE)?.date ?? null}
						onChange={(date) => updateModule(Module.END_DATE, { date })}
						timeFormat="h:mm aa"
						dateFormat={"MMMM d, yyyy h:mm aa"}
					/>
				</div>
				<div className="w-ful flex items-center justify-center text-base-text-subtle">
					<button className="flex flex-row items-center 	 justify-center gap-1 transition-all duration-300" onClick={() => setExpandedOptions(!expandedOptions)}>
						<div>{expandedOptions ? <ChevronRight /> : <ChevronDown />}</div>
						<div>Options</div>
					</button>
				</div>
				{expandedOptions && (
					<div className="text-base-text-subtle">
						<VisibilitySelector select={(visibility) => setItem({ ...item, visibility })} selected={item.visibility} />
					</div>
				)}
				{expandedOptions && <ProgressSelector select={(progress) => setItem({ ...item, progress })} selected={item.progress} />}
				<div className="flex flex-row items-center justify-center gap-2">
					<PrimaryButton
						onClick={() => {
							onCreate(item);
							setItem(structuredClone(DEFAULT_ITEM));
						}}
						style="font-semibold"
					>
						Create
					</PrimaryButton>
				</div>
			</div>
		</div>
	);
}
