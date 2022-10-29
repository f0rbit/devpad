import { Module, TaskPriority } from "@/types/page-link";
import { TASK_PROGRESS, TASK_VISIBILITY } from "@prisma/client";
import { Tag } from "lucide-react";
import { useSession } from "next-auth/react";
import { useContext, useReducer, useState } from "react";
import { TodoContext } from "src/pages/todo/dashboard";
import {
	FetchedTask,
	getModuleData,
	getTaskModule,
	trpc
} from "src/utils/trpc";
import GenericModal from "../GenericModal";
import { hoverExpandButton } from "../Home/HomeButton";
import TodoCreateForm from "./Editors/TodoCreateForm";
import { TodoTagsEditor } from "./Editors/TodoTagsEditor";
import { LayoutIcon, TODO_LAYOUT } from "./ListLayout";
import TodoCard from "./TodoCard";

//create your forceUpdate hook
function useForceUpdate() {
	const [value, setValue] = useState(0); // integer state
	return () => setValue((value) => value + 1); // update state to force render
	// An function that increment 👆🏻 the previous state like here
	// is better than directly setting `value + 1`
}

const ListRenderer = () => {
	const { data } = trpc.tasks.get_tasks.useQuery();
	const [createModalOpen, setCreateModalOpen] = useState(false);
	const [editTagsModalOpen, setEditTagsModalOpen] = useState(false);
	const create_item = trpc.tasks.create_item.useMutation();
	const [layout, setLayout] = useState(TODO_LAYOUT.LIST);
	const forceUpdate = useForceUpdate();

	if (!data) {
		return <div>Loading...</div>;
	}

	const createItem = async ({
		title,
		progress,
		visibility,
		start_time,
		end_time
	}: {
		title: string;
		progress: TASK_PROGRESS;
		visibility: TASK_VISIBILITY;
		start_time: Date;
		end_time: Date;
	}) => {
		const item = {
			title,
			progress,
			visibility,
			start_time,
			end_time
		};
		await create_item.mutate(
			{ item },
			{
				onSuccess: (new_item) => {
					data.push(new_item);
				}
			}
		);
	};

	const setItem = (item: FetchedTask) => {
		const index = data?.findIndex((i) => i.id === item.id);
		if (index === undefined) return;
		data[index] = item;
		forceUpdate();
	};

	const renderItems = (data: FetchedTask[], layout: string) => {
		console.log("data", data);

		const renderData = (data: FetchedTask[]) => {
			return data.map((item) => (
				<TodoCard
					key={item.id}
					initial_item={item}
					layout={layout}
					set_item={setItem}
				/>
			));
		};

		switch (layout) {
			case TODO_LAYOUT.LIST:
				return (
					<div className="flex flex-col gap-2">
						{renderData(data)}
					</div>
				);
			case TODO_LAYOUT.GRID:
				return (
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ">
						{renderData(data)}
					</div>
				);
			default:
				return <></>;
		}
	};

	return (
		<TodoContext.Consumer>
			{({ selectedSection, searchQuery, tags, setTags }) => {
				return (
					<>
						<div className="scrollbar-hide h-full w-full overflow-auto bg-gray-100 dark:bg-pad-gray-800">
							<div className="h-[2000px] w-full p-4 text-neutral-400">
								<div className="mb-4 rounded-md p-2 font-bold text-neutral-300">
									<div className="flex flex-row items-center gap-4">
										<div className="text-2xl font-bold">
											{selectedSection + " Items"}
										</div>
										<div className="flex flex-row items-center gap-2 align-middle">
											{/* Add a button for each layout */}
											{Object.values(TODO_LAYOUT).map(
												(layout_type) => (
													<button
														key={layout_type}
														onClick={() => {
															setLayout(
																layout_type
															);
														}}
														className="rounded-md bg-pad-gray-500 px-2 py-1 shadow-md"
													>
														<LayoutIcon
															layout={layout_type}
														/>
													</button>
												)
											)}
										</div>
										<div>Layout: {layout}</div>
										<div className="ml-auto">
											{/* Add a button for editing tags */}
											<button
												onClick={() => {
													setEditTagsModalOpen(true);
												}}
												className="flex flex-nowrap items-center justify-center gap-2 rounded-md bg-pad-gray-500 px-2 py-1 align-middle text-sm shadow-md"
											>
												<Tag className="p-0.5" />
												Edit
											</button>
										</div>
									</div>
								</div>
								{renderItems(
									getSortedData(
										data,
										selectedSection,
										searchQuery
									),
									layout
								)}
							</div>
						</div>
						<div className="fixed bottom-4 right-4">
							<button
								className={hoverExpandButton}
								onClick={(e) => {
									e.preventDefault();
									setCreateModalOpen(true);
								}}
							>
								Create
							</button>
							<div className="absolute">
								<GenericModal
									open={createModalOpen}
									setOpen={setCreateModalOpen}
								>
									<TodoCreateForm
										createItem={createItem}
										setOpen={setCreateModalOpen}
									/>
								</GenericModal>
							</div>
						</div>
						<div className="absolute">
							<GenericModal
								open={editTagsModalOpen}
								setOpen={setEditTagsModalOpen}
							>
								<TodoTagsEditor
									initial_tags={tags}
									set_tags={setTags}
								/>
							</GenericModal>
						</div>
					</>
				);
			}}
		</TodoContext.Consumer>
	);
};

export default ListRenderer;

function getSortedData(
	data: FetchedTask[],
	selectedSection: string,
	searchQuery: string
): FetchedTask[] {
	// remove all deleted
	const sorted = data.filter(
		(item) => item.visibility != TASK_VISIBILITY.DELETED
	);
	switch (selectedSection) {
		case "current":
			// get all the items with a progress of "IN_PROGRESS"
			return sorted.filter(
				(item) => item.progress == TASK_PROGRESS.IN_PROGRESS
			);
		case "recent":
			return sorted.sort((a, b) => {
				return a.updated_at > b.updated_at ? -1 : 1;
			});
		case "search":
			// get the searchQuery from TODO_CONTEXT
			return sorted.filter((item) => {
				// combine fields into one string
				const fields = [item.title].join(" ");
				console.log(fields);
				// check if the searchQuery is in the fields
				return fields.toLowerCase().includes(searchQuery.toLowerCase());
			});
		case "upcoming":
			// first filter out all that took place in the past
			return sorted
				.filter((item) => {
					const end = getModuleData(item, Module.END_DATE);
					if (!end) return false;
					return (
						new Date(end["end_date"]).getTime() >
						new Date().getTime()
					);
				})
				.sort((a, b) => {
					const a_end = getModuleData(a, Module.END_DATE);
					const b_end = getModuleData(b, Module.END_DATE);
					if (!a_end || !b_end) return 0;
					return new Date(a_end["end_date"]) >
						new Date(b_end["end_date"])
						? 1
						: -1;
				});
		case "urgent":
			// filter out all that aren't urgent priority
			return sorted.filter((item) => {
				// extract priority from modules
				const priority = getModuleData(item, Module.PRIORITY);
				if (!priority || !priority["priority"]) return false;
				return priority["priority"] == TaskPriority.URGENT;
			});

		default:
			if (selectedSection.startsWith("tags/")) {
				const tag = selectedSection.split("/")[1];
				if (!tag) return [];
				return sorted.filter((item) => {
					// get titles of tags
					const tags = item.tags.map((tag) => tag.title.toLowerCase());
					return tags.includes(tag);
				});
			}
			return sorted;
	}
}
