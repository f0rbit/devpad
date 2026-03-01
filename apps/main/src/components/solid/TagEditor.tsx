import { getBrowserClient } from "@devpad/core/ui/client";
import { TAG_COLOURS, type TagWithTypedColor as Tag, type TagColor, type UpsertTag } from "@devpad/schema";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronUp from "lucide-solid/icons/chevron-up";
import Eye from "lucide-solid/icons/eye";
import Plus from "lucide-solid/icons/plus";
import Save from "lucide-solid/icons/save";
import Trash from "lucide-solid/icons/trash";
import X from "lucide-solid/icons/x";
import { type Accessor, createEffect, createSignal, For } from "solid-js";

/* solid-js component that takes a list of tags and gives create, update, and delete options to the user. */

type TagProp = UpsertTag;

export function TagEditor({ tags, owner_id }: { tags: Tag[]; owner_id: string }) {
	const [currentTags, setCurrentTags] = createSignal(tags as TagProp[]);
	const [creating, setCreating] = createSignal(false);

	function upsert(tag: TagProp) {
		if (tag.id && tag.id !== "") {
			const new_tags = currentTags().map(t => (t.id === tag.id ? tag : t));
			setCurrentTags(new_tags);
		} else {
			tag.id = crypto.randomUUID();
			setCurrentTags([...currentTags(), tag]);
			setCreating(false);
		}
	}

	function remove(id: string | undefined) {
		if (!id) return;
		const new_tags = currentTags().map(t => (t.id === id ? { ...t, deleted: true } : t));
		setCurrentTags(new_tags);
	}

	function create() {
		setCreating(true);
	}

	async function save() {
		if (creating()) return;
		try {
			const values = currentTags().map(t => ({ ...t, owner_id }));
			const apiClient = getBrowserClient();
			const result = await apiClient.tasks.saveTags(values);
			console.log("result", result);
			window.location.reload();
		} catch (error) {
			console.error("Error saving tags:", error);
		}
	}

	return (
		<div class="flex-col" style="gap: 5px;">
			{currentTags().length === 0 && !creating() ? <p>you haven't created any tags yet</p> : null}

			<div class="tag-grid">
				<div>Title</div>
				<div>Color</div>
				<div style="margin: auto auto;" title="Render tag in tasks list">
					<Eye />
				</div>
				<div></div>
				<For each={currentTags()}>{tag => !tag.deleted && <TagLine tag={tag} upsert={upsert} remove={remove} owner_id={owner_id} />}</For>
				{creating() && <TagLine tag={null} upsert={upsert} remove={remove} owner_id={owner_id} />}
			</div>

			<a role="button" onClick={create} class="flex-row" style="margin-top: 10px">
				<Plus />
				add
			</a>
			<a role="button" onClick={save} class="flex-row" style="margin-top: 10px">
				<Save />
				save
			</a>
		</div>
	);
}

function TagLine({ tag, upsert, remove, owner_id }: { tag: TagProp | null; upsert: (tag: TagProp) => void; remove: (id: string | undefined) => void; owner_id: string }) {
	const is_new = !tag || tag.id == null || tag.id === "";
	const [title, setTitle] = createSignal(tag?.title ?? "");
	const [color, setColor] = createSignal<TagColor | null>(tag?.color ?? null);
	const [render, setRender] = createSignal(tag?.render ?? true);

	function save() {
		if (is_new) {
			upsert({ title: title(), color: color(), deleted: false, owner_id: owner_id, render: render() });
		} else {
			upsert({ ...tag, title: title(), color: color(), render: render() });
		}
	}

	return (
		<>
			<input
				type="text"
				value={title()}
				onInput={e => setTitle(e.currentTarget.value)}
				onChange={save}
				style={{
					background: "var(--bg-alt)",
					border: "1px solid var(--border)",
					padding: "5px",
					"border-radius": "5px",
					"font-size": "14px",
					width: "100%",
				}}
			/>
			<TagColourPicker
				value={color}
				onChange={col => {
					setColor(col);
					save();
				}}
				enabled={() => true}
			/>
			<div
				style={{
					background: "var(--bg-alt)",
					border: "1px solid var(--border)",
					padding: "5px",
					"border-radius": "5px",
					"font-size": "small",
				}}
			>
				<input type="checkbox" checked={render()} onInput={e => setRender(e.currentTarget.checked)} onChange={save} />
			</div>
			{tag?.id && (
				<a role="button" onClick={() => remove(tag?.id)} title="Remove Tag" style={{ cursor: "pointer" }}>
					<Trash size={16} />
				</a>
			)}
		</>
	);
}
// COLOUR PICKER

function TagColourPicker({ value, enabled, onChange }: { value: Accessor<TagColor | null>; enabled: Accessor<boolean>; onChange: (value: TagColor | null) => void }) {
	const [isOpen, setIsOpen] = createSignal(false);

	createEffect(() => {
		console.log("value", value());
	}, [value()]);

	function togglePopup() {
		if (enabled()) {
			setIsOpen(!isOpen());
		}
	}

	return (
		<div style="position: relative; display: inline-block;">
			{/* Display Current Selected Color */}
			<button
				style={{
					background: "var(--bg-alt)",
					border: "1px solid var(--border)",
					padding: "5px",
					"border-radius": "5px",
					"font-size": "14px",
					cursor: enabled() ? "pointer" : "text",
					display: "flex",
					"align-items": "center",
					gap: "5px",
					color: "var(--fg)",
					width: "100%",
				}}
				onClick={togglePopup}
				disabled={enabled() === false}
			>
				{value() ? <TagBadge colour={value} name={() => value() ?? "None"} /> : <span style="color: var(--fg-muted); font-size: small; height: 21px; line-height: 21px;">Select Colour</span>}
				{isOpen() ? <ChevronUp /> : <ChevronDown />}
			</button>

			{/* Popup List */}
			{isOpen() && (
				<div
					style={{
						position: "absolute",
						top: "calc(100% + 5px)",
						left: 0,
						background: "var(--bg-alt)",
						border: "1px solid var(--border)",
						"border-radius": "5px",
						"box-shadow": "0 2px 5px rgba(0, 0, 0, 0.2)",
						padding: "5px",
						"flex-wrap": "wrap",
						"z-index": 1000,
						display: "grid",
						"grid-template-columns": "1fr 1fr 1fr",
						gap: "5px",
					}}
				>
					<For each={Object.keys(TAG_COLOURS) as TagColor[]}>
						{name => (
							<button onClick={() => onChange(name)} class="button-reset">
								<TagBadge name={() => name} colour={() => name} />
							</button>
						)}
					</For>
					<button onClick={() => onChange(null)} class="button-reset">
						<TagBadge name={() => "None"} colour={() => null} />
					</button>
				</div>
			)}
		</div>
	);
}

export function TagBadge({ name, colour, onRemove }: { name: Accessor<string>; colour: Accessor<TagColor | null>; onRemove?: () => void }) {
	return (
		<div
			style={{
				background: colour() ? TAG_COLOURS[colour()!].colour : "none",
				color: colour() ? TAG_COLOURS[colour()!].text : "var(--fg-muted)",
				border: `1px solid ${colour() ? TAG_COLOURS[colour()!].border : "var(--border)"}`,
			}}
			class="tag-badge"
		>
			{name()}
			{onRemove && (
				<div onClick={onRemove} class="flex-row">
					<X size={16} />
				</div>
			)}
		</div>
	);
}

// Default export for Astro compatibility
export default TagEditor;
