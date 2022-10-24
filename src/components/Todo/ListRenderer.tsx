import { TODO_Item, TODO_ItemDependancy, TODO_Tags, TODO_TemplateItem } from "@prisma/client";
import { useSession } from "next-auth/react";
import { useContext, useState } from "react";
import { TodoContext } from "src/pages/todo/dashboard";
import { trpc } from "src/utils/trpc";
import TodoCard from "./TodoCard";

export type FetchedTodo = TODO_Item & {
    tags: TODO_Tags[];
    parents: TODO_ItemDependancy[];
    children: TODO_ItemDependancy[];
    templates: TODO_TemplateItem[]
}

const ListRenderer = () => {
    const { status } = useSession();
    const { data } = trpc.todo.getAll.useQuery();
    if (!data) {
        return <div>Loading...</div>;
    }

    return (
        <TodoContext.Consumer>
            {({ selectedSection }) => {
                return (
                    <div className="h-full w-full overflow-auto bg-gray-100 dark:bg-pad-gray-800">
                        <div className="h-[2000px] w-full text-neutral-400 p-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 ">
                                {data.map((item, index) => {
                                    return (
                                        <TodoCard
                                            key={index}
                                            initial_item={item}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                );
            }}
        </TodoContext.Consumer>
    );
};

export default ListRenderer;
