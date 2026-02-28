import { getBrowserClient } from "@devpad/core/ui/client";
import { Button, ChipInput } from "@f0rbit/ui";
import type { Component } from "solid-js";
import { createSignal, For, onMount, Show } from "solid-js";
import { unwrap } from "../../lib/client";
import { date } from "../../lib/date-utils";
import { form } from "../../lib/form-utils";
import PostPreview from "./post-preview";
import ProjectSelector from "./project-selector";

type Post = {
	id: number;
	uuid: string;
	slug: string;
	title: string;
	content: string;
	description?: string;
	format: "md" | "adoc";
	category: string;
	tags: string[];
	project_ids?: string[];
	publish_at: string | null;
	updated_at?: string;
};

type Category = {
	name: string;
	parent: string | null;
};

type PostFormData = {
	slug: string;
	title: string;
	content: string;
	description?: string;
	format: "md" | "adoc";
	category: string;
	tags: string[];
	project_ids: string[];
	publish_at: Date | null;
};

type Project = {
	id: string;
	name: string;
	project_id: string;
	description: string | null;
};

type PostEditorProps = {
	post?: Post;
	categories: Category[];
	projects?: Project[];
	initialProjectIds?: string[];
	onSave?: (data: PostFormData) => Promise<void>;
	onFormReady?: (getFormData: () => PostFormData) => void;
};

const generateSlug = (title: string): string =>
	title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

const formatDateForInput = (date: Date | null): string => {
	if (!date) return "";
	const pad = (n: number) => n.toString().padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

type CategoryNode = Category & { children?: CategoryNode[] };

const flattenCategoryTree = (nodes: CategoryNode[]): Category[] => nodes.flatMap(n => [{ name: n.name, parent: n.parent }, ...flattenCategoryTree(n.children ?? [])]);

const PostEditor: Component<PostEditorProps> = props => {
	const [title, setTitle] = createSignal(props.post?.title ?? "");
	const [slug, setSlug] = createSignal(props.post?.slug ?? "");
	const [content, setContent] = createSignal(props.post?.content ?? "");
	const [description, setDescription] = createSignal(props.post?.description ?? "");
	const [format, setFormat] = createSignal<"md" | "adoc">(props.post?.format ?? "md");
	const [category, setCategory] = createSignal(props.post?.category ?? "root");
	const [tags, setTags] = createSignal<string[]>(props.post?.tags ?? []);
	const [projectIds, setProjectIds] = createSignal<string[]>(props.post?.project_ids ?? props.initialProjectIds ?? []);
	const [publishAt, setPublishAt] = createSignal<Date | null>(props.post?.publish_at ? new Date(props.post.publish_at) : null);
	const [categories, setCategories] = createSignal<Category[]>(props.categories ?? []);

	const formState = form.create();
	const [activeTab, setActiveTab] = createSignal<"write" | "preview">("write");

	// Expose form data getter for external save button
	const getFormData = (): PostFormData => ({
		slug: slug(),
		title: title(),
		content: content(),
		description: description() || undefined,
		format: format(),
		category: category(),
		tags: tags(),
		project_ids: projectIds(),
		publish_at: publishAt(),
	});

	// Fetch categories on mount if not provided, and notify parent that form is ready
	onMount(async () => {
		// Notify parent that form is ready (for external save button)
		if (props.onFormReady) {
			props.onFormReady(getFormData);
		}
		const win = window as Window & { postEditorReady?: (fn: typeof getFormData) => void };
		if (win.postEditorReady) {
			win.postEditorReady(getFormData);
		}

		// Fetch categories if not provided
		if (props.categories && props.categories.length > 0) return;
		try {
			const data = unwrap(await getBrowserClient().blog.categories.tree());
			const flatCategories = flattenCategoryTree((data.categories ?? []) as CategoryNode[]);
			setCategories(flatCategories);
		} catch (e) {
			console.error("[PostEditor] Failed to fetch categories:", e);
		}
	});

	const isEditing = () => !!props.post;

	const handleTitleChange = (newTitle: string) => {
		setTitle(newTitle);
		if (!isEditing() && !slug()) {
			setSlug(generateSlug(newTitle));
		}
	};

	const handlePublishAtChange = (value: string) => {
		if (!value) {
			setPublishAt(null);
		} else {
			setPublishAt(new Date(value));
		}
	};

	const saveNewPost = async (data: PostFormData) => {
		const post = unwrap(
			await getBrowserClient().blog.posts.create({
				slug: data.slug,
				title: data.title,
				content: data.content,
				description: data.description,
				format: data.format,
				category: data.category,
				tags: data.tags,
				project_ids: data.project_ids,
				publish_at: data.publish_at ?? undefined,
			})
		);

		window.location.href = `/posts/${post.slug}`;
	};

	const handleSave = async () => {
		formState.setError(null);
		if (!title().trim()) {
			formState.setError("Title is required");
			return;
		}
		if (!slug().trim()) {
			formState.setError("Slug is required");
			return;
		}

		await formState.handleSubmit(async () => {
			const data = getFormData();
			if (props.onSave) {
				await props.onSave(data);
			} else if (!props.post) {
				await saveNewPost(data);
			}
		});
	};

	return (
		<div class="post-editor">
			<Show when={formState.error()}>
				<div class="form-error">{formState.error()}</div>
			</Show>

			{/* Title + Metadata section with border */}
			<div class="post-editor__header">
				<input type="text" class="post-editor__title-input" placeholder="Post title..." prop:value={title()} onInput={e => handleTitleChange(e.currentTarget.value)} />

				{/* Metadata grid */}
				<div class="post-editor__metadata">
					<div class="post-editor__field">
						<label>Slug</label>
						<input type="text" prop:value={slug()} onInput={e => setSlug(e.currentTarget.value)} placeholder="post-slug" />
					</div>

					<div class="post-editor__field">
						<label>Category</label>
						<select prop:value={category()} onChange={e => setCategory(e.currentTarget.value)}>
							<option value="root">root</option>
							<For each={categories().filter(c => c.name !== "root")}>{c => <option value={c.name}>{c.parent ? `${c.parent}/${c.name}` : c.name}</option>}</For>
						</select>
					</div>

					<div class="post-editor__field">
						<label>Format</label>
						<select prop:value={format()} onChange={e => setFormat(e.currentTarget.value as "md" | "adoc")}>
							<option value="md">Markdown</option>
							<option value="adoc">AsciiDoc</option>
						</select>
					</div>

					<div class="post-editor__field">
						<label>Publish at</label>
						<input type="datetime-local" prop:value={formatDateForInput(publishAt())} onInput={e => handlePublishAtChange(e.currentTarget.value)} />
					</div>

					<div class="post-editor__field post-editor__field--wide">
						<label>Description</label>
						<input type="text" prop:value={description()} onInput={e => setDescription(e.currentTarget.value)} placeholder="Brief description..." />
					</div>

					<div class="post-editor__field post-editor__field--wide">
						<label>Tags</label>
						<ChipInput value={tags()} onChange={setTags} transform={s => s.trim().toLowerCase()} placeholder="Add tag..." layout="below" />
					</div>

					<div class="post-editor__field post-editor__field--wide">
						<label>Projects</label>
						<ProjectSelector selectedIds={projectIds()} onChange={setProjectIds} initialProjects={props.projects} />
					</div>
				</div>

				{/* Version info - only show when editing existing post */}
				<Show when={isEditing() && props.post?.updated_at} keyed>
					{updatedAt => (
						<div class="post-editor__version-info">
							<span class="post-editor__last-saved">Last saved {date.relative(updatedAt)}</span>
							<a href={`/posts/${props.post?.uuid}/versions`} class="post-editor__history-link">
								View History →
							</a>
						</div>
					)}
				</Show>

				{/* Actions - show for new posts or when onSave is provided */}
				<Show when={props.onSave || !props.post}>
					<div class="post-editor__actions">
						<Button variant="primary" onClick={handleSave} disabled={formState.submitting()} loading={formState.submitting()}>
							{isEditing() ? "Update" : "Create"}
						</Button>
					</div>
				</Show>
			</div>

			{/* Content editor with tabs - could migrate to @f0rbit/ui Tabs, but keeping custom implementation
			   to preserve SolidJS Show-based conditional rendering and ensure textarea state is maintained */}
			<div class="editor-tabs">
				<button type="button" class={`tab ${activeTab() === "write" ? "active" : ""}`} onClick={() => setActiveTab("write")}>
					Write
				</button>
				<button type="button" class={`tab ${activeTab() === "preview" ? "active" : ""}`} onClick={() => setActiveTab("preview")}>
					Preview
				</button>
			</div>

			<Show when={activeTab() === "write"}>
				<textarea class="post-editor__content" placeholder="Write your content..." prop:value={content()} onInput={e => setContent(e.currentTarget.value)} />
			</Show>

			<Show when={activeTab() === "preview"}>
				<PostPreview content={content()} format={format()} />
			</Show>
		</div>
	);
};

export default PostEditor;
