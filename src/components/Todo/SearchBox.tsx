import { Search } from "lucide-react";
import { TodoContext } from "src/pages/todo";

export const SearchBox = () => {
	return (
		<TodoContext.Consumer>
			{({ searchQuery, setSearchQuery, setSelectedSection, selectedSection }) => (
				<div className={"flex flex-row gap-2 rounded-md bg-gray-200 px-3 py-1 dark:bg-base-accent-secondary" + (selectedSection == "search" ? " ring-2 ring-pad-purple-200" : "")}>
					<Search className="min-w-min text-base-text-subtlish dark:text-base-text-subtle" />
					<input
						className="w-full bg-transparent text-base-text-subtle placeholder-base-text-subtlish focus:outline-none dark:text-base-text-subtlish dark:placeholder-base-text-dark md:w-48"
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
