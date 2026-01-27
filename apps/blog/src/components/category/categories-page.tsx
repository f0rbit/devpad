import type { Category as SchemaCategory } from "@devpad/schema/blog";
import { Button, buildTree, Spinner, Tree } from "@f0rbit/ui";
import { type Component, createMemo, createResource, createSignal, Show } from "solid-js";
import { api } from "@/lib/api";
import CategoryForm from "./category-form";

type Category = Pick<SchemaCategory, "id" | "name" | "parent">;

interface CategoryNode {
	name: string;
	parent: string | null;
	children?: CategoryNode[];
}

interface Props {
	initialCategories?: Category[];
}

const flattenTree = (nodes: CategoryNode[], id = 1): Category[] => nodes.flatMap((n, i) => [{ id: id + i, name: n.name, parent: n.parent }, ...flattenTree(n.children ?? [], id + i + 100)]);

const fetchCategories = async (): Promise<Category[]> => {
	if (typeof window === "undefined") {
		return [];
	}
	const data = await api.json<{ categories?: CategoryNode[] }>("/api/v1/blog/categories");
	return flattenTree(data.categories ?? []);
};

const IconPlus = () => (
	<svg xmlns="http://www.w3.org/2000/svg" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
		<path d="M5 12h14" />
		<path d="M12 5v14" />
	</svg>
);

const IconMinus = () => (
	<svg xmlns="http://www.w3.org/2000/svg" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
		<path d="M5 12h14" />
	</svg>
);

const CategoriesPage: Component<Props> = props => {
	const [fetchTrigger, setFetchTrigger] = createSignal(0);
	const [categories, { refetch }] = createResource(
		() => {
			const trigger = fetchTrigger();
			// Skip initial fetch if we have SSR data, but always fetch on trigger > 0
			if (trigger === 0 && props.initialCategories && props.initialCategories.length > 0) {
				return null;
			}
			return trigger;
		},
		fetchCategories,
		{ initialValue: props.initialCategories ?? [] }
	);
	const [error, setError] = createSignal<string | null>(null);
	const [defaultParent, setDefaultParent] = createSignal("root");
	const [formHighlighted, setFormHighlighted] = createSignal(false);

	const refreshCategories = () => setFetchTrigger(n => n + 1);

	const handleDelete = async (name: string) => {
		if (!confirm(`Delete category "${name}"? This cannot be undone.`)) return;
		setError(null);
		try {
			await api.delete(`/api/v1/blog/categories/${encodeURIComponent(name)}`);
			refreshCategories();
		} catch {
			setError("Failed to delete category");
		}
	};

	const treeNodes = createMemo(() => {
		const cats = categories();
		if (!cats) return [];
		const items = cats.map(c => ({
			id: c.name,
			label: c.name,
			parentId: c.parent === "root" ? null : c.parent,
		}));
		return buildTree(items);
	});

	const handleCreate = async (data: { name: string; parent: string }) => {
		setError(null);
		try {
			await api.post("/api/v1/blog/categories", data);
			refreshCategories();
		} catch {
			setError("Failed to create category");
		}
	};

	const selectParentForAdd = (parentName: string) => {
		setDefaultParent(parentName);
		setFormHighlighted(true);
		setTimeout(() => setFormHighlighted(false), 1500);
	};

	return (
		<div class="stack" style={{ gap: "24px" }}>
			<Show when={error()}>
				<div class="form-error">
					<p class="text-sm">{error()}</p>
				</div>
			</Show>

			<Show when={categories.loading}>
				<Spinner size="sm" />
			</Show>

			<Show when={categories.error}>
				<div class="form-error">
					<p class="text-sm">Failed to load categories</p>
				</div>
			</Show>

			<Show when={categories()} keyed>
				{cats => (
					<>
						<section>
							<h2 class="text-sm text-muted" style={{ "margin-bottom": "8px" }}>
								Category Hierarchy
							</h2>
							<Tree
								nodes={treeNodes()}
								showGuides
								defaultExpanded
								renderActions={node => (
									<>
										<Button variant="ghost" icon size="sm" onClick={() => selectParentForAdd(node.id)} label={`Add child to ${node.label}`}>
											<IconPlus />
										</Button>
										{node.id !== "root" && (
											<Button variant="ghost" icon size="sm" onClick={() => handleDelete(node.id)} label={`Delete ${node.label}`}>
												<IconMinus />
											</Button>
										)}
									</>
								)}
								emptyMessage="No categories found."
							/>
						</section>

						<CategoryForm categories={cats} onSubmit={handleCreate} defaultParent={defaultParent()} highlighted={formHighlighted()} />
					</>
				)}
			</Show>
		</div>
	);
};

export default CategoriesPage;
