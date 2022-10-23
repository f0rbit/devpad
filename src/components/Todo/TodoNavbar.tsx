import { Home, Menu, Search } from "lucide-react";
import { useContext } from "react";
import { TodoContext } from "src/pages/todo/dashboard";
import HoverLink, { hoverLinkClass } from "../HoverLink";

const TodoNavbar = () => {
    const { toggleList, setSelectedSection, setShowList } = useContext(TodoContext);
    return (
        <div className="bg-gray-200 dark:bg-pad-gray-900">
            <div className="flex flex-row gap-4 py-1 text-gray-600 dark:text-pad-gray-300 mx-4 my-1 items-center h-[40px]">
                <Menu onClick={() => {
                    toggleList();
                }} className={hoverLinkClass + " min-w-min"} />
                <Home className={hoverLinkClass + " min-w-min"} onClick={() => {
                    setSelectedSection("current");
                    setShowList(true);
                }}/>
                <div className=" gap-2 rounded-md bg-gray-300 dark:bg-pad-gray-800 px-3 py-1 hidden md:inline-flex">
                    <Search className="min-w-min"/>
                    <input className="w-64 bg-transparent focus:outline-none dark:placeholder-pad-gray-400 dark:text-pad-gray-100" placeholder={"Search"}></input>
                </div>
                <div className="hidden md:block truncate transition-all">
                    <HoverLink text={"Projects"} />
                    <span>{" > "}</span>
                    <HoverLink text={"gm-server"} />
                    <span>{" > "}</span>
                    <HoverLink text={"Add netty.io dependancy"} />
                    <span>{" > "}</span>
                    <HoverLink text={"Edit"} />
                </div>
                <div className="ml-auto flex flex-row-reverse gap-4 items-center">
                    <HoverLink text={"Profile"} />
                    <HoverLink text={"Settings"} />
                    <HoverLink text={"Help"}/>
                </div>
            </div>
        </div>
    );
};

export default TodoNavbar;
