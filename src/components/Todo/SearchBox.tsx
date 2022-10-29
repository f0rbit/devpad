import { Search } from "lucide-react";
import { TodoContext } from "src/pages/todo/dashboard";

export const SearchBox = () => {
	return (
		<TodoContext.Consumer>
			{({
				searchQuery,
				setSearchQuery,
				setSelectedSection,
				selectedSection
			}) => (
				<div
					className={
						"flex flex-row gap-2 rounded-md bg-gray-300 px-3 py-1 dark:bg-pad-gray-800" +
						(selectedSection == "search"
							? " ring-2 ring-pad-purple-200"
							: "")
					}
				>
					<Search className="min-w-min" />
					<input
						className="w-full bg-transparent focus:outline-none dark:text-pad-gray-100 dark:placeholder-pad-gray-400 md:w-48"
						placeholder={"Search"}
						type={"text"}
						value={searchQuery}
						onInput={(e) => {
							e.preventDefault();
							const input = (e.target as HTMLInputElement).value;
							setSearchQuery(input);
							setSelectedSection("search");
						}}
					/>
				</div>
			)}
		</TodoContext.Consumer>
	);
};