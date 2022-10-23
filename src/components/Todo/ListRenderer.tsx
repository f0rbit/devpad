import { useContext } from "react";
import { TodoContext } from "src/pages/todo/dashboard";

const ListRenderer = () => {
    const { selectedSection } = useContext(TodoContext);
    return <div className="bg-gray-100 dark:bg-pad-gray-800 h-full w-full overflow-auto">
        <div className="w-full h-[2000px]">
        {selectedSection} Items
            </div></div>;
};

export default ListRenderer;
