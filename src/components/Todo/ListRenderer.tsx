import {
	TODO_Item,
	TODO_ItemDependancy,
	TODO_PRIORITY,
	TODO_STATUS,
	TODO_Tags,
	TODO_TemplateItem,
	TODO_VISBILITY
} from "@prisma/client";
import { Tag } from "lucide-react";
import { useSession } from "next-auth/react";
import { useContext, useReducer, useState } from "react";
import { TodoContext } from "src/pages/todo/dashboard";
import { trpc } from "src/utils/trpc";
import GenericModal from "../GenericModal";
import { hoverExpandButton } from "../Home/HomeButton";
import TodoCreateForm from "./Editors/TodoCreateForm";
import { TodoTagsEditor } from "./Editors/TodoTagsEditor";
import { LayoutIcon, TODO_LAYOUT } from "./ListLayout";
import TodoCard from "./TodoCard";

//create your forceUpdate hook
function useForceUpdate(){
    const [value, setValue] = useState(0); // integer state
    return () => setValue(value => value + 1); // update state to force render
    // An function that increment 👆🏻 the previous state like here 
    // is better than directly setting `value + 1`
}

export type FetchedTodo = TODO_Item & {
	tags: TODO_Tags[];
	parents: TODO_ItemDependancy[];
	children: TODO_ItemDependancy[];
	templates: TODO_TemplateItem[];
};

const ListRenderer = () => {
	const { data } = trpc.todo.getAll.useQuery();
	const [createModalOpen, setCreateModalOpen] = useState(false);
	const [editTagsModalOpen, setEditTagsModalOpen] = useState(false);
	const create_item = trpc.todo.createItem.useMutation();
	const [layout, setLayout] = useState(TODO_LAYOUT.LIST);
	const forceUpdate = useForceUpdate();

	if (!data) {
		return <div>Loading...</div>;
	}

	const createItem = async ({
		title,
		summary,
		description,
		status,
		visibility,
		start_time,
		end_time
	}: {
		title: string;
		summary: string;
		description: object;
		status: TODO_STATUS;
		visibility: TODO_VISBILITY;
		start_time: Date;
		end_time: Date;
	}) => {
		const item = {
			title,
			summary,
			description: JSON.stringify(description),
			progress: status,
			visibility,
			start_time,
			end_time
		};
		await create_item.mutate(
			{
				item
			},
			{
				onSuccess: ({ new_item }) => {
					if (!new_item) return;
					data?.push(new_item);
				}
			}
		);
	};

	const setItem = (item: FetchedTodo) => {
		const index = data?.findIndex((i) => i.id === item.id);
		if (index === undefined) return;
		data[index] = item;
		forceUpdate();
		
	};


	const renderItems = (data: FetchedTodo[], layout: string) => {
		console.log("data", data);

		const renderData = (data: FetchedTodo[]) => {
			return data.map((item) => (
				<TodoCard
					key={item.id}
					initial_item={item}
					layout={layout}
					set_item={setItem}
				/>
			));
		}

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
													setEditTagsModalOpen(
														true
													);
												}}
													className="rounded-md bg-pad-gray-500 px-2 py-1 shadow-md flex flex-nowrap gap-2 text-sm items-center justify-center align-middle"
											>
												<Tag className="p-0.5"/>
												Edit
											</button>
											

										</div>
									</div>
								</div>
								{renderItems(
									getSortedData(data, selectedSection, searchQuery),
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
								<TodoTagsEditor initial_tags={tags} set_tags={setTags}/>
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
	data: FetchedTodo[],
	selectedSection: string,
	searchQuery: string
): FetchedTodo[] {
	// remove all deleted
	const sorted = data.filter((item) => item.visibility != TODO_VISBILITY.DELETED);
	switch (selectedSection) {
		case "current":
			// get all the items with a progress of "IN_PROGRESS"
			return sorted.filter(
				(item) => item.progress == TODO_STATUS.IN_PROGRESS
			);
		case "recent":
			return sorted.sort((a, b) => {
				return a.updated_at > b.updated_at ? -1 : 1;
			});
		case "search":
			// get the searchQuery from TODO_CONTEXT
			return sorted.filter((item) => {
				// combine fields into one string
				const fields = [
					item.title,
					item.summary,
				].join(" ");
				console.log(fields);
				// check if the searchQuery is in the fields
				return fields.toLowerCase().includes(searchQuery.toLowerCase());	
			});
		case "upcoming":
			// first filter out all that took place in the past
			return sorted.filter((item) => {
				if (!item.end_time) return false;
				return (
					new Date(item.end_time).getTime() >
					new Date().getTime()
				);
			}).sort((a, b) => {
				// these cases should never happen because of the filter.
				if (!a.end_time) return 1;
				if (!b.end_time) return -1;
				return a.end_time > b.end_time ? 1 : -1;
			});
		case "urgent":
			// filter out all that aren't urgent priority
			return sorted.filter((item) => {
				return item.priority == TODO_PRIORITY.URGENT;
			})

		default:
			if (selectedSection.startsWith("tags/")) {
				const tag = selectedSection.split("/")[1];
				if (!tag) return [];
				return sorted.filter((item) => {
					// get titles of tags
					const tags = item.tags.map((tag) => tag.title);
					return tags.includes(tag);
				});
			}
			return sorted;
	}
}
