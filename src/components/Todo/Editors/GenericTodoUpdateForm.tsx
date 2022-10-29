import { TODO_Item } from "@prisma/client";
import { dateToDateAndTime, dateToDateTime } from "src/utils/dates";
import { COLOURS } from "@/components/Todo/TodoCard";
import {
	ArrowLeft,
	ArrowRight,
	BoxSelect,
	Calendar,
	CalendarCheck2,
	CalendarX2,
	Eye,
	Flag,
	Newspaper,
	Tags,
	Type
} from "lucide-react";
import { FetchedTodo } from "../ListRenderer";
import TodoTag from "../TodoTag";

const GenericTodoEditForm = ({
	item,
	title,
	onClick,
	buttonText,
	onDeleteClick
}: {
	item?: FetchedTodo;
	title: string;
	onClick: any;
	buttonText: string;
	onDeleteClick?: () => void;
}) => {
	const tag_objects =
		item?.tags.map((tag) => {
			return <TodoTag tag={tag} />;
		}) ?? [];

	const has_times = item?.start_time || item?.end_time;

	return (
		<div
			style={{ maxHeight: "calc(60vh)" }}
			className="scrollbar-hide overflow-y-auto pr-2 text-neutral-300"
		>
			{/* <div className="mb-4 w-full text-center text-xl">{title}</div> */}
			<div className="flex h-full w-[56rem] max-w-[85vw] flex-col md:flex-row">
				<div className="w-full basis-3/4 p-1">
					<div className="inline-flex w-full items-center gap-2">
						<Type />
						<input
							type="text"
							className="w-full rounded-md bg-transparent px-3 py-1 text-2xl focus:bg-pad-gray-300 focus:font-mono focus:outline-none"
							placeholder="Title"
							defaultValue={item?.title}
							name="title"
							id="title"
						/>
					</div>
					{/* Here is where you would put REQUIRED_BY */}

					{/* Summary */}
					<div className="inline-flex w-full items-center gap-2">
						<Newspaper />
						<input
							className="w-full rounded-md bg-transparent px-3 py-1 focus:bg-pad-gray-300 focus:font-mono focus:outline-none"
							placeholder="Summary"
							defaultValue={item?.summary ?? ""}
							id="summary"
							name="summary"
						/>
					</div>
					{/* Render tags */}
					{tag_objects.length > 0 && (
						<div className="inline-flex w-full items-center gap-2">
							<Tags />
							<div className="inline-flex w-full items-center gap-2 px-3 py-1">
								{tag_objects}
							</div>
						</div>
					)}
					{has_times && (
						<div className="inline-flex w-full items-center gap-x-2 flex-wrap md:flex-nowrap">
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
					)}
					<div className="relative inline-flex w-full flex-row items-center gap-2 flex-wrap md:flex-nowrap">
						<span className="flex w-full flex-row items-center gap-2 align-middle">
							<BoxSelect className="flex-none" />
							<select
								name="progress"
								id="progress"
								defaultValue={item?.progress}
								className="w-full bg-transparent py-1 focus:bg-pad-gray-300"
								title="Status"
							>
								<option
									value="UNSTARTED"
									className={COLOURS.UNSTARTED.colour}
								>
									Not Started
								</option>
								<option
									value="IN_PROGRESS"
									className={COLOURS.IN_PROGRESS.colour}
								>
									In Progress
								</option>
								<option
									value="COMPLETED"
									className={COLOURS.COMPLETED.colour}
								>
									Done
								</option>
							</select>
						</span>
						<span className="flex w-full flex-row items-center gap-2 align-middle">
							<Eye className="flex-none" />
							<select
								name="visibility"
								id="visibility"
								defaultValue={item?.visibility}
								className="w-full bg-transparent py-1 focus:bg-pad-gray-300"
								title="Visibility"
							>
								<option value="PRIVATE">Private</option>
								<option value="PUBLIC">Public</option>
								<option value="HIDDEN">Hidden</option>
								<option value="DRAFT">Draft</option>
								<option value="ARCHIVED">Archived</option>
							</select>
						</span>
						{item?.set_manual_priority && <span className="flex w-full flex-row items-center gap-2 align-middle">
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
						</span>}
					</div>
					
				</div>

				<div className="basis-1/4 bg-red-300">
					<div className="text-center">Add Modules</div>
				</div>
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
			{/* <div
				style={{
					gridTemplateColumns: "1fr 7fr",
					width: "calc(100vw - 90px)"
				}}
				className="flex flex-col gap-2 md:grid md:max-w-[500px] xl:max-w-[700px] edit-todo"
			>
				<label htmlFor="title">Title</label>
				<input
					type="text"
					name="title"
					id="title"
					defaultValue={item?.title}
				/>
				<label htmlFor="summary">Summary</label>
				<input
					type="text"
					name="summary"
					id="summary"
					defaultValue={item?.summary ?? ""}
				></input>
				<label htmlFor="description">Description</label>
				<textarea
					name="description"
					id="description"
					defaultValue={
						(typeof item?.description != "string"
							? JSON.stringify(item?.description ?? {})
							: item?.description) ?? ""
					}
					className="scrollbar-hide h-96"
				></textarea>
				<label htmlFor="progress">Progress</label>
				<div className="relative inline-flex flex-row gap-4">
					<select
						name="progress"
						id="progress"
						defaultValue={item?.progress}
						className="w-full"
					>
						<option
							value="UNSTARTED"
							className={COLOURS.UNSTARTED.colour}
						>
							Not Started
						</option>
						<option
							value="IN_PROGRESS"
							className={COLOURS.IN_PROGRESS.colour}
						>
							In Progress
						</option>
						<option
							value="COMPLETED"
							className={COLOURS.COMPLETED.colour}
						>
							Done
						</option>
					</select>
					<label htmlFor="Visiblity">
						<div className="absolute bottom-8 right-0 w-full text-right text-pad-gray-50 md:contents">
							Visiblity
						</div>
					</label>
					<select
						name="visibility"
						id="visibility"
						defaultValue={item?.visibility}
						className="w-full"
					>
						<option value="PRIVATE">Private</option>
						<option value="PUBLIC">Public</option>
						<option value="HIDDEN">Hidden</option>
						<option value="DRAFT">Draft</option>
						<option value="ARCHIVED">Archived</option>
					</select>
				</div>
				<label htmlFor="start_date">Start Date</label>
				<input
					type="datetime-local"
					name="start_date"
					id="start_date"
					defaultValue={dateToDateTime(
						item?.start_time ?? new Date()
					)}
				/>
				<label htmlFor="end_date">End Date</label>
				<input
					type="datetime-local"
					name="end_date"
					id="end_date"
					defaultValue={
						item?.end_time ? dateToDateTime(item?.end_time) : ""
					}
				/>
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
			</div> */}
		</div>
	);
};
export default GenericTodoEditForm;
