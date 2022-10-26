import {
    TODO_Item,
    TODO_ItemDependancy,
    TODO_STATUS,
    TODO_Tags,
    TODO_TemplateItem,
    TODO_VISBILITY
} from "@prisma/client";
import { useSession } from "next-auth/react";
import { useReducer, useState } from "react";
import { TodoContext } from "src/pages/todo/dashboard";
import { trpc } from "src/utils/trpc";
import GenericModal from "../GenericModal";
import { hoverExpandButton } from "../Home/HomeButton";
import TodoCreateForm from "./Editors/TodoCreateForm";
import { LayoutIcon, TODO_LAYOUT } from "./ListLayout";
import TodoCard from "./TodoCard";

export type FetchedTodo = TODO_Item & {
    tags: TODO_Tags[];
    parents: TODO_ItemDependancy[];
    children: TODO_ItemDependancy[];
    templates: TODO_TemplateItem[];
};

const ListRenderer = () => {
    const { status } = useSession();
    const { data } = trpc.todo.getAll.useQuery();
    const [createModalOpen, setCreateModalOpen] = useState(false);
    const create_item = trpc.todo.createItem.useMutation();
    const [layout, setLayout] = useState(TODO_LAYOUT.LIST);

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

    console.log("data", data);
    return (
        <TodoContext.Consumer>
            {({ selectedSection }) => {
                return (
                    <>
                        <div className="scrollbar-hide h-full w-full overflow-auto bg-gray-100 dark:bg-pad-gray-800">
                            <div className="h-[2000px] w-full p-4 text-neutral-400">
                                <div className="mb-4 rounded-md p-2 font-bold text-neutral-300">
                                    <div className="flex flex-row items-center gap-4">
                                        <div className="text-2xl font-bold">
                                            {selectedSection + " Items"}
                                        </div>
                                        <div className="flex flex-row items-center align-middle gap-2">
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
                                                        className="bg-pad-gray-500 px-2 py-1 rounded-md shadow-md"
                                                    >
                                                        <LayoutIcon
                                                            layout={layout_type}
                                                        />
                                                    </button>
                                                )
                                            )}
                                        </div>
                                        <div>
                                            Layout: {layout}
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ">
                                    {data?.map((item, index) => {
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
                    </>
                );
            }}
        </TodoContext.Consumer>
    );
};

export default ListRenderer;
