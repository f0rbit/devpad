import { Home, Menu, Search } from "lucide-react";
import { useContext } from "react";
import { TodoContext } from "src/pages/todo/dashboard";
import HoverLink, { hoverLinkClass } from "../HoverLink";

const TodoNavbar = () => {
	const { toggleList, setSelectedSection, setShowList } =
		useContext(TodoContext);
	return (
		<div className="bg-gray-200 dark:bg-pad-gray-900">
			<div className="mx-4 my-1 flex h-[40px] flex-row items-center gap-4 py-1 text-gray-600 dark:text-pad-gray-300">
				<button
					onClick={() => {
						toggleList();
					}}
					className={hoverLinkClass}
				>
					<Menu className={"min-w-min"} />
				</button>

				<button
					className={hoverLinkClass}
					onClick={() => {
						setSelectedSection("current");
						setShowList(true);
					}}
				>
					<Home className={"min-w-min"} />
				</button>

				<div className=" hidden gap-2 rounded-md bg-gray-300 px-3 py-1 dark:bg-pad-gray-800 md:inline-flex">
					<Search className="min-w-min" />
					<input
						className="w-64 bg-transparent focus:outline-none dark:text-pad-gray-100 dark:placeholder-pad-gray-400"
						placeholder={"Search"}
					></input>
				</div>
				<div className="hidden truncate transition-all md:block">
					<HoverLink text={"Projects"} />
					<span>{" > "}</span>
					<HoverLink text={"gm-server"} />
					<span>{" > "}</span>
					<HoverLink text={"Add netty.io dependancy"} />
					<span>{" > "}</span>
					<HoverLink text={"Edit"} />
				</div>
				<div className="ml-auto flex flex-row-reverse items-center gap-4">
					<HoverLink text={"Profile"} />
					<HoverLink text={"Settings"} />
					<HoverLink text={"Help"} />
				</div>
			</div>
		</div>
	);
};

export default TodoNavbar;
