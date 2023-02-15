import { COLOURS } from "@/components/Todo/TodoCard";
import { FetchedTask, Module, TaskPriority } from "@/types/page-link";
import { TaskModule, TaskTags, TASK_PROGRESS, TASK_VISIBILITY } from "@prisma/client";
import { BoxSelect, Eye, Tag, Tags, Type } from "lucide-react";
import { useState } from "react";
import { dateToDateTime } from "src/utils/dates";
import DescriptionParser from "../Description/DescriptionParser";
import { ModuleIcon } from "../ModuleIcon";
import TodoTag from "../TodoTag";

const GenericTodoEditForm = ({
	item,
	title,
	onClick,
	buttonText,
	onDeleteClick,
	addModule,
	tags,
	saveTags
}: {
	item?: FetchedTask;
	title: string;
	onClick: any;
	buttonText: string;
	onDeleteClick?: () => void;
	addModule?: (module: Module) => void;
	tags?: TaskTags[] | undefined;
	saveTags?: (tags: string[]) => void;
}) => {
	const [showTagEditor, setShowTagEditor] = useState(false);

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

	const toggleTags = () => {
		setShowTagEditor(!showTagEditor);
	};

	const getModules = (module: Module): TaskModule[] => {
		if (!item) return [];
		return item?.modules?.filter((m: TaskModule) => m.type === module);
	};

	return (
		<div style={{ maxHeight: "calc(60vh)" }} className="scrollbar-hide overflow-y-auto pr-2 text-gray-700 dark:text-neutral-300">
			<div className="flex h-full w-[56rem] max-w-[85vw] flex-col md:flex-row">
				<div className={"w-full p-1 " + (item ? "basis-3/4" : "")}>
					<div className="inline-flex w-full items-center gap-2">
						<Type />
						<input type="text" className="w-full rounded-md bg-transparent px-3 py-1 text-2xl focus:bg-pad-gray-300 focus:font-mono focus:outline-none" placeholder="Title" defaultValue={item?.title} name="title" id="title" />
					</div>
					{/* Here is where you would put REQUIRED_BY */}

					{getModules(Module.SUMMARY).map((module, index) => (
						<ItemSummary module={module} key={index} />
					))}

					<TagObjects tags={item?.tags} />

					{getModules(Module.DESCRIPTION).map((module, index) => (
						<ItemDescription module={module} key={index} />
					))}

					<div className="inline-flex w-full flex-wrap items-center gap-x-2 md:flex-nowrap">
						{getModules(Module.START_DATE).map((module, index) => (
							<ItemStartDate module={module} key={index} />
						))}
						{getModules(Module.END_DATE).map((module, index) => (
							<ItemEndDate module={module} key={index} />
						))}
					</div>

					<div className="relative inline-flex w-full flex-row flex-wrap items-center gap-2 md:flex-nowrap">
						<TodoProgress progress={item?.progress} />
						<TodoVisibility visibility={item?.visibility} />

						{getModules(Module.PRIORITY).map((module, index) => (
							<ItemPriority module={module} key={index} />
						))}
					</div>
				</div>

				{item && (showTagEditor ? <TodoTagSelector item={item} tags={tags} saveTags={saveTags} edit_tags={toggleTags} /> : <ModuleButtons edit_module={edit_module} edit_tags={toggleTags} />)}
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

const ModuleButtons = ({ edit_module, edit_tags }: { edit_module: (module: Module) => void; edit_tags: () => void }) => {
	return (
		<div className="basis-1/4 dark:text-white">
			<div className="mb-2 text-center text-lg">Add Modules</div>
			<div className="flex flex-col gap-1">
				{Object.values(Module).map((module, index) => {
					return (
						<button className="flex w-full flex-row items-center gap-2 rounded-md bg-gray-300 py-1 px-2 hover:bg-gray-200 dark:bg-pad-gray-300 dark:hover:bg-pad-gray-200" key={index} onClick={() => edit_module(module)}>
							{ModuleIcon[module]}
							<span>{module}</span>
						</button>
					);
				})}
				{/* Add a button for editing tags */}
				<button className="flex w-full flex-row items-center gap-2 rounded-md bg-gray-300 py-1 px-2 hover:bg-gray-200 dark:bg-pad-gray-300 dark:hover:bg-pad-gray-200" onClick={edit_tags}>
					<Tag />
					<span>tags</span>
				</button>
			</div>
		</div>
	);
};

const TodoTagSelector = ({ item, tags, saveTags, edit_tags }: { item?: FetchedTask; tags: TaskTags[] | undefined, saveTags: ((tags: string[]) => void) | undefined, edit_tags: () => void }) => {
	const [selectedTags, setSelectedTags] = useState<string[]>(item?.tags.map((tag) => tag.id) || []);

	const selectTag = (id: string) => {
		if (selectedTags.includes(id)) {
			setSelectedTags(selectedTags.filter((tag) => tag !== id));
		} else {
			setSelectedTags([...selectedTags, id]);
		}
	};

	if (!item || !saveTags) return <></>;
	return (
		<div className="basis-1/4 dark:text-white">
			<div className="mb-2 text-center text-lg">Select Tags</div>
			<div className="flex flex-col gap-1 h-full" id="tagSelector">
				{tags?.map((tag, index) => {
					return (
						<div className="flex gap-2" key={index}>
							<input type="checkbox" defaultChecked={selectedTags.includes(tag.id)} onChange={() => selectTag(tag.id)} />
							<label>{tag.title}</label>
						</div>
					);
				})}
				<div className="mx-auto mt-auto">
					<button
						className="rounded-md bg-green-200 px-4 py-1 text-pad-gray-700 transition-all duration-300 hover:scale-110 hover:bg-green-300"
						onClick={(e) => {
							e.preventDefault();
							saveTags(selectedTags);
							edit_tags();
						}}
					>
						Save Tags
					</button>
				</div>
			</div>
		</div>
	);
};

const ItemEndDate = ({ module }: { module: any }) => {
	const data = module.data;
	const { date } = data;
	const value = dateToDateTime(new Date(date));
	return (
		<div className="inline-flex w-full items-center gap-2" title="End Time">
			{ModuleIcon[module.type as Module]}
			<input type="datetime-local" name="end_date" id={`module-${module.id}`} className="w-full rounded-md bg-transparent px-3 py-1 focus:bg-pad-gray-300 focus:font-mono focus:outline-none" defaultValue={value ?? undefined} />
		</div>
	);
};

const ItemStartDate = ({ module }: { module: any }) => {
	const data = module.data;
	const { date } = data;
	const value = dateToDateTime(new Date(date));
	return (
		<div className="inline-flex w-full items-center gap-2" title="Start Time">
			{ModuleIcon[module.type as Module]}
			<input type="datetime-local" name="start_date" id={`module-${module.id}`} className="w-full rounded-md bg-transparent px-3 py-1 focus:bg-pad-gray-300 focus:font-mono focus:outline-none" defaultValue={value ?? undefined} />
		</div>
	);
};

const TodoProgress = ({ progress }: { progress: TASK_PROGRESS | undefined }) => {
	return (
		<span className="flex w-full flex-row items-center gap-2 align-middle">
			<BoxSelect className="flex-none" />
			<select name="progress" id="progress" defaultValue={progress} className="w-full bg-transparent py-1 focus:bg-pad-gray-300" title="Status">
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
	);
};

const TodoVisibility = ({ visibility }: { visibility: TASK_VISIBILITY | undefined }) => {
	return (
		<span className="flex w-full flex-row items-center gap-2 align-middle">
			<Eye className="flex-none" />
			<select name="visibility" id="visibility" defaultValue={visibility} className="w-full bg-transparent py-1 focus:bg-pad-gray-300" title="Visibility">
				<option value="PRIVATE">Private</option>
				<option value="PUBLIC">Public</option>
				<option value="HIDDEN">Hidden</option>
				<option value="DRAFT">Draft</option>
				<option value="ARCHIVED">Archived</option>
			</select>
		</span>
	);
};

const ItemPriority = ({ module }: { module: TaskModule }) => {
	const data = module.data as { priority: TaskPriority };
	const { priority } = data;

	return (
		<span className="flex w-full flex-row items-center gap-2 align-middle">
			{ModuleIcon[module.type as Module]}
			<select name="priority" id={`module-${module.id}`} defaultValue={priority} className="w-full bg-transparent py-1 focus:bg-pad-gray-300" title="Priority">
				<option value={TaskPriority.LOW}>Low</option>
				<option value={TaskPriority.MEDIUM}>Medium</option>
				<option value={TaskPriority.HIGH}>High</option>
				<option value={TaskPriority.URGENT}>Urgent</option>
			</select>
		</span>
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
		<div className="relative inline-flex min-h-[6rem] w-full gap-2">
			{ModuleIcon[module.type as Module]}
			{editing ? (
				<textarea
					className="scrollbar-hide w-full rounded-md bg-transparent bg-pad-gray-600 px-3 py-1 focus:bg-pad-gray-300 focus:font-mono focus:outline-none"
					placeholder="Description"
					defaultValue={data?.description[0]?.markdown?.text ?? ""}
					id={`module-${module.id}`}
					name="description"
				/>
			) : (
				<div className="px-3">
					<DescriptionParser description={data.description} />
					<div className="absolute bottom-0 right-0">
						<button className="m-1 rounded-md bg-gray-200 px-3 py-1 transition-all hover:scale-110 dark:bg-pad-gray-200" onClick={() => setEditing(!editing)}>
							{editing ? "Done" : "Edit"}
						</button>
					</div>
				</div>
			)}
		</div>
	);
};

const TagObjects = ({ tags }: { tags: TaskTags[] | undefined }) => {
	if (!tags || tags.length <= 0) return <></>;
	return (
		<div className="inline-flex w-full items-center gap-2">
			<Tags />
			<div className="inline-flex w-full items-center gap-2 px-3 py-1">
				{tags.map((tag, index) => (
					<TodoTag tag={tag} key={index} />
				))}
			</div>
		</div>
	);
};
export default GenericTodoEditForm;
