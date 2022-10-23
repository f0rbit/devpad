import { useSession } from "next-auth/react";
import { useContext, useState } from "react";
import { TodoContext } from "src/pages/todo/dashboard";
import { trpc } from "src/utils/trpc";
import TodoCard from "./TodoCard";

const ListRenderer = () => {
    const { status } = useSession();
    const { selectedSection } = useContext(TodoContext);
    const { data } = trpc.todo.getAll.useQuery();
    if (!data) {
        return <div>Loading...</div>;
    }

    return (
        <div className="h-full w-full overflow-auto bg-gray-100 dark:bg-pad-gray-800">
            <div className="h-[2000px] w-full">
                <span>Login Status: {status}</span>
                <h2>{selectedSection} Items</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {data.map((item, index) => {
                        return <TodoCard key={index} item={item} />;
                    })}
                </div>
            </div>
        </div>
    );
};

export default ListRenderer;
