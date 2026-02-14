import type { Category as SchemaCategory } from "@devpad/schema/blog";
import { Button, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Input } from "@f0rbit/ui";
import { type Component, createEffect, createSignal, For } from "solid-js";
import { form } from "../../lib/form-utils";

type Category = Pick<SchemaCategory, "id" | "name" | "parent">;

interface CategoryFormProps {
	categories: Category[];
	onSubmit: (data: { name: string; parent: string }) => Promise<void>;
	defaultParent: string;
	highlighted: boolean;
}

let formRef: HTMLElement | undefined;
let nameInputRef: HTMLInputElement | undefined;

const scrollToFormAndFocus = () => {
	formRef?.scrollIntoView({ behavior: "smooth", block: "center" });
	nameInputRef?.focus();
};

const CategoryForm: Component<CategoryFormProps> = props => {
	const [name, setName] = createSignal("");
	const [parent, setParent] = createSignal(props.defaultParent);
	const formState = form.create();

	createEffect(() => {
		setParent(props.defaultParent);
		if (props.highlighted) scrollToFormAndFocus();
	});

	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		const trimmedName = name().trim();
		if (!trimmedName) return;

		await formState.handleSubmit(async () => {
			await props.onSubmit({ name: trimmedName, parent: parent() });
			setName("");
			setParent("root");
		});
	};

	return (
		<section ref={formRef} class="category-form-section" classList={{ "category-form-section--highlighted": props.highlighted }}>
			<h3 class="category-form-title">New Category</h3>
			<form onSubmit={handleSubmit} class="category-form">
				<div class="form-row">
					<label for="category-name" class="text-xs text-subtle">
						Name
					</label>
					<Input
						ref={el => {
							nameInputRef = el;
						}}
						value={name()}
						onInput={e => setName(e.currentTarget.value)}
						placeholder="Category name"
						disabled={formState.submitting()}
					/>
				</div>
				<div class="form-row">
					<label class="text-xs text-subtle">Parent</label>
					<Dropdown>
						<DropdownTrigger>
							<Button variant="secondary" disabled={formState.submitting()}>
								{parent()}
							</Button>
						</DropdownTrigger>
						<DropdownMenu>
							<For each={props.categories}>
								{cat => (
									<DropdownItem onClick={() => setParent(cat.name)} active={parent() === cat.name}>
										{cat.name}
									</DropdownItem>
								)}
							</For>
						</DropdownMenu>
					</Dropdown>
				</div>
				<div class="category-form-actions">
					<Button type="submit" variant="primary" disabled={formState.submitting() || !name().trim()}>
						{formState.submitting() ? "Creating..." : "+ Create"}
					</Button>
				</div>
			</form>
		</section>
	);
};

export default CategoryForm;
