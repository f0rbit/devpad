import { dateToDateAndTime, dateToDateTime } from "src/utils/dates";
import { COLOURS } from "@/components/Todo/TodoCard";
import { ArrowLeft, ArrowRight, BoxSelect, Calendar, CalendarCheck2, CalendarX2, Eye, Flag, Newspaper, Tag, Tags, Type } from "lucide-react";
import TodoTag from "../TodoTag";
import { FetchedTask, getTaskModule } from "src/utils/trpc";
import { Module } from "@/types/page-link";
import { ModuleIcon } from "../ModuleIcon";
import { TaskModule } from "@prisma/client";
import { ReactNode, useState } from "react";
import DescriptionParser from "../Description/DescriptionParser";
import { hoverExpandButton } from "@/components/Home/HomeButton";

const GenericTodoEditForm = ({ item, title, onClick, buttonText, onDeleteClick, addModule }: { item?: FetchedTask; title: string; onClick: any; buttonText: string; onDeleteClick?: () => void; addModule?: (module: Module) => void }) => {
	const tag_objects =
		item?.tags.map((tag, index) => {
			return <TodoTag tag={tag} key={index} />;
		}) ?? [];

	// const has_times = item?.start_time || item?.end_time;
	const edit_module = (module: Module) => {
		if (!addModule) return;
		var dom_element = document.getElementById("module-" + module);
		if (!dom_element) {
			addModule(module);
		} else {
			dom_element?.focus();
			dom_element?.scrollIntoView({ behavior: "smooth" });
		}
	};

	const edit_tags = () => {
		console.log("edit tags");
	};

	const getModules = (module: Module): TaskModule[] => {
		if (!item) return [];
		return item?.modules?.filter((m: TaskModule) => m.type === module);
	};

	return (
		<div style={{ maxHeight: "calc(60vh)" }} className="scrollbar-hide overflow-y-auto pr-2 text-neutral-300">
			{/* <div className="mb-4 w-full text-center text-xl">{title}</div> */}
			<div className="flex h-full w-[56rem] max-w-[85vw] flex-col md:flex-row">
				<div className={"w-full p-1 " + (item ? "basis-3/4" : "")}>
					<div className="inline-flex w-full items-center gap-2">
						<Type />
						<input type="text" className="w-full rounded-md bg-transparent px-3 py-1 text-2xl focus:bg-pad-gray-300 focus:font-mono focus:outline-none" placeholder="Title" defaultValue={item?.title} name="title" id="title" />
					</div>
					{/* Here is where you would put REQUIRED_BY */}

					{/* Summary */}
					{getModules(Module.SUMMARY).map((module, index) => (
						<ItemSummary module={module} key={index} />
					))}

					{/* Description */}
					{getModules(Module.DESCRIPTION).map((module, index) => (
						<ItemDescription module={module} key={index} />
					))}

					{/* Render tags */}
					{tag_objects.length > 0 && (
						<div className="inline-flex w-full items-center gap-2">
							<Tags />
							<div className="inline-flex w-full items-center gap-2 px-3 py-1">{tag_objects}</div>
						</div>
					)}
					{/* {has_times && (
						<div className="inline-flex w-full flex-wrap items-center gap-x-2 md:flex-nowrap">
							{item.start_time && (
								<div
									className="inline-flex w-full items-center gap-2"
									title="Start Time"
								>
									<CalendarCheck2 />
									<input
										type="datetime-local"
										name="start_date"
										id="start_date"
										className="w-full rounded-md bg-transparent px-3 py-1 focus:bg-pad-gray-300 focus:font-mono focus:outline-none"
										defaultValue={
											item?.start_time
												? dateToDateTime(
														item?.start_time
												  )
												: ""
										}
									/>
								</div>
							)}
							{item.end_time && (
								<div
									className="inline-flex w-full items-center gap-2"
									title="End Time"
								>
									<CalendarX2 />
									<input
										type="datetime-local"
										name="end_date"
										id="end_date"
										className="w-full rounded-md bg-transparent px-3 py-1 focus:bg-pad-gray-300 focus:font-mono focus:outline-none"
										defaultValue={
											item?.end_time
												? dateToDateTime(item?.end_time)
												: ""
										}
									/>
								</div>
							)}
						</div>
					)} */}
					<div className="relative inline-flex w-full flex-row flex-wrap items-center gap-2 md:flex-nowrap">
						<span className="flex w-full flex-row items-center gap-2 align-middle">
							<BoxSelect className="flex-none" />
							<select name="progress" id="progress" defaultValue={item?.progress} className="w-full bg-transparent py-1 focus:bg-pad-gray-300" title="Status">
								<option value="UNSTARTED" className={COLOURS.UNSTARTED.colour}>
									Not Started
								</option>
								<option value="IN_PROGRESS" className={COLOURS.IN_PROGRESS.colour}>
									In Progress
								</option>
								<option value="COMPLETED" className={COLOURS.COMPLETED.colour}>
									Done
								</option>
							</select>
						</span>
						<span className="flex w-full flex-row items-center gap-2 align-middle">
							<Eye className="flex-none" />
							<select name="visibility" id="visibility" defaultValue={item?.visibility} className="w-full bg-transparent py-1 focus:bg-pad-gray-300" title="Visibility">
								<option value="PRIVATE">Private</option>
								<option value="PUBLIC">Public</option>
								<option value="HIDDEN">Hidden</option>
								<option value="DRAFT">Draft</option>
								<option value="ARCHIVED">Archived</option>
							</select>
						</span>
						{/* {item?.set_manual_priority && (
							<span className="flex w-full flex-row items-center gap-2 align-middle">
								<Flag className="flex-none" />
								<select
									name="priority"
									id="priority"
									defaultValue={item?.priority}
									className="w-full bg-transparent py-1 focus:bg-pad-gray-300"
									title="Priority"
								>
									<option value="LOW">Low</option>
									<option value="MEDIUM">Medium</option>
									<option value="HIGH">High</option>
									<option value="URGENT">Urgent</option>
								</select>
							</span>
						)} */}
					</div>
				</div>

				{item && (
					<div className="basis-1/4  text-white">
						<div className="mb-2 text-center text-lg">Add Modules</div>
						<div className="flex flex-col gap-1">
							{Object.values(Module).map((module, index) => {
								return (
									<button className="flex w-full flex-row items-center gap-2 rounded-md bg-pad-gray-300 py-1 px-2 hover:bg-pad-gray-200" key={index} onClick={() => edit_module(module)}>
										{ModuleIcon[module]}
										<span>{module}</span>
									</button>
								);
							})}
							{/* Add a button for editing tags */}
							<button className="flex w-full flex-row items-center gap-2 rounded-md bg-pad-gray-300 py-1 px-2 hover:bg-pad-gray-200" onClick={edit_tags}>
								<Tag />
								<span>tags</span>
							</button>
						</div>
					</div>
				)}
			</div>
			<div className="mt-4 mb-1 flex justify-center gap-2">
				{onDeleteClick && (
					<button
						className="rounded-md bg-red-400 px-4 py-2 text-white  duration-300 hover:scale-110 hover:bg-red-500"
						onClick={(e) => {
							e.preventDefault();
							onDeleteClick();
						}}
					>
						Delete
					</button>
				)}
				<button
					className="rounded-md bg-green-200 px-4 py-2 text-pad-gray-700 transition-all duration-300 hover:scale-110 hover:bg-green-300"
					onClick={(e) => {
						e.preventDefault();
						onClick();
					}}
				>
					{buttonText}
				</button>
			</div>
		</div>
	);
};

const ItemSummary = ({ module }: { module: TaskModule }) => {
	const data = module.data as { summary: string };

	// module should be of type Summary
	return (
		<div className="inline-flex w-full items-center gap-2">
			{ModuleIcon[module.type as Module]}
			<input className="w-full rounded-md bg-transparent px-3 py-1 focus:bg-pad-gray-300 focus:font-mono focus:outline-none" placeholder="Summary" defaultValue={data.summary ?? ""} id={`module-${module.id}`} name="summary" />
		</div>
	);
};

const ItemDescription = ({ module }: { module: TaskModule }) => {
	const [editing, setEditing] = useState(false);

	const data = module.data as { description: any };
	// module should be of type Description
	return (
		<div className="relative inline-flex w-full gap-2 min-h-[6rem]">
			{ModuleIcon[module.type as Module]}
			{editing ? (
				<textarea className="w-full rounded-md bg-transparent bg-pad-gray-600 px-3 py-1 focus:bg-pad-gray-300 focus:font-mono focus:outline-none scrollbar-hide" placeholder="Description" defaultValue={data?.description[0]?.markdown?.text ?? ""} id={`module-${module.id}`} name="description" />
			) : (
				<div className="px-3">
					<DescriptionParser description={data.description} />
					<div className="absolute bottom-0 right-0">
						<button className="px-3 py-1 bg-pad-gray-200 rounded-md m-1 transition-all hover:scale-110" onClick={() => setEditing(!editing)}>{editing ? "Done" : "Edit"}</button>
					</div>
				</div>
			)}
			
		</div>
	);
};
export default GenericTodoEditForm;
