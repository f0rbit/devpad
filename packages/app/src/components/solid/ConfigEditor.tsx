import type { ConfigSchemaType, TagWithTypedColor } from "@devpad/schema";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import ChevronRight from "lucide-solid/icons/chevron-right";
import GitBranch from "lucide-solid/icons/git-branch";
import Minus from "lucide-solid/icons/minus";
import Plus from "lucide-solid/icons/plus";
import X from "lucide-solid/icons/x";
import { type Accessor, createEffect, createSignal, For, Index } from "solid-js";
import { createStore } from "solid-js/store";
import { getApiClient } from "@/utils/api-client";

// Default configurations for helper tags
const DEFAULT_CONFIGS = {
	todo: ["@todo", "// TODO:"],
	bug: ["@bug", "// BUG:"],
	fix: ["@fix", "// FIX:"],
	idea: ["@idea", "// IDEA:"],
};

type DefaultConfig = keyof typeof DEFAULT_CONFIGS;

type Config = ConfigSchemaType;

const TodoScannerConfig = ({
	config: initial_config,
	id,
	branches,
	scan_branch,
	user_tags,
}: {
	config: Config;
	id: string;
	branches: { name: string; commit: { message: string } }[] | null;
	scan_branch: string | undefined | null;
	user_tags: TagWithTypedColor[];
}) => {
	const [config, setConfig] = createStore({
		tags: initial_config.tags ?? [],
		ignore: initial_config?.ignore ?? [],
		branch: scan_branch ?? branches?.[0]?.name ?? null,
	});
	const [errors, setErrors] = createStore({
		tags: "",
		ignore: "",
	});

	const addTag = () => {
		setConfig("tags", [...config.tags, { name: "", match: [] }]);
		validate();
	};

	const updateTagName = (index: number, name: string) => {
		setConfig("tags", prev => {
			return prev.map((t, i) => (i === index ? { ...t, name } : t));
		});
		validate();
	};

	const removeTag = (index: number) => {
		setConfig("tags", prev => {
			return prev.filter((_, i) => i !== index);
		});
		validate();
	};

	const addMatch = (index: number) => {
		setConfig("tags", prev => {
			return prev.map((t, i) => (i === index ? { ...t, match: [...t.match, ""] } : t));
		});
		validate();
	};

	const updateMatch = (index: number, match_index: number, value: string) => {
		setConfig("tags", prev => {
			return prev.map((t, i) => (i === index ? { ...t, match: t.match.map((m, mi) => (mi === match_index ? value : m)) } : t));
		});
		validate();
	};

	const removeMatch = (index: number, match_index: number) => {
		setConfig("tags", prev => {
			return prev.map((t, i) => (i === index ? { ...t, match: t.match.filter((_, mi) => mi !== match_index) } : t));
		});
		validate();
	};

	const addIgnorePath = () => {
		setConfig("ignore", [...config.ignore, ""]);
	};

	const updateIgnorePath = (index: number, value: string) => {
		setConfig("ignore", prev => {
			return prev.map((p, i) => (i === index ? value : p));
		});
		validate();
	};

	const removeIgnorePath = (index: number) => {
		setConfig("ignore", prev => {
			return prev.filter((_, i) => i !== index);
		});
		validate();
	};

	const selectBranch = (branch: string | null) => {
		setConfig("branch", branch);
	};

	const validate = () => {
		const { tags } = config;
		const tag_names = new Set();
		const all_matches = new Set();
		let valid = true;

		setErrors({ tags: "", ignore: "" });

		for (const tag of tags) {
			if (!tag.name) continue;
			if (tag_names.has(tag.name)) {
				setErrors("tags", `Tag name "${tag.name}" must be unique.`);
				valid = false;
			}
			tag_names.add(tag.name);

			for (const match of tag.match) {
				if (!match) continue;
				if (all_matches.has(match)) {
					setErrors("tags", `Match "${match}" must be unique across tags.`);
					valid = false;
				}
				all_matches.add(match);
			}
		}

		// TODO: validate that ignore paths are correct glob/regex patterns

		return valid;
	};

	const addDefaultTag = (tagName: DefaultConfig) => {
		const matches = DEFAULT_CONFIGS[tagName];
		setConfig("tags", prev => {
			if (prev.some(tag => tag.name === tagName)) return prev; // Tag already exists

			return [
				...prev,
				{
					name: tagName,
					match: matches,
				},
			];
		});
		validate();
	};

	const save = async () => {
		if (!validate()) return;

		try {
			const apiClient = getApiClient();
			await apiClient.projects.saveConfig({
				config: {
					tags: config.tags.filter(tag => tag.name && tag.match.length > 0),
					ignore: config.ignore.filter(path => path.trim()),
				},
				scan_branch: config.branch ?? undefined,
				id,
			});
			window.location.reload();
		} catch (error) {
			console.error("Error saving config:", error);
			setErrors("tags", "An error occurred while saving.");
		}
	};

	const commit_message = () => {
		const branch = config.branch;
		if (!branch) return null;
		if (!branches) return null;
		// find branch with same name inside branches
		const found = branches.find(b => b.name === branch);
		if (!found) return null;
		return found.commit.message;
	};

	return (
		<div style="font-size: 0.9em">
			{/* section to pick branch */}
			{branches != null ? (
				<div class="flex-col" style="gap: 6px; margin-bottom: 20px">
					<div class="flex-row" style="gap: 20px">
						<h6>branch</h6>
					</div>
					<div class="flex-row" style="gap: 8px">
						<GitBranch />
						<select value={config.branch ?? ""} onChange={e => selectBranch(e.target.value)}>
							<For each={branches}>
								{branch => (
									<option value={branch.name} selected={branch.name === config.branch}>
										{branch.name}
									</option>
								)}
							</For>
						</select>
						<p style="font-size: small">{commit_message()}</p>
					</div>
				</div>
			) : null}
			<datalist id="tags">
				{user_tags.map(tag => (
					<option data-id={tag.id} value={tag.title}>
						{tag.title}
					</option>
				))}
			</datalist>
			<div class="flex-col" style="gap: 6px">
				<div class="flex-row" style="gap: 20px">
					<h6>tags</h6>
					<a role="button" onClick={addTag} title="Add Tag" class="flex-row">
						<Plus />
						add tag
					</a>
					<ConfigDefaults tags={() => config.tags} add={addDefaultTag} />
				</div>
				<Index each={config.tags}>
					{(tag, index) => (
						<div class="flex-col" style="gap: 4px">
							<div class="flex-row" style="gap: 10px">
								<input type="text" placeholder="Tag Name" list="tags" value={tag().name} onInput={e => updateTagName(index, e.target.value)} />
								<a role="button" onClick={() => removeTag(index)} title="Remove Tag" class="flex-row">
									<X />
								</a>
							</div>
							<div class="flex-col" style="border-left: 1px solid var(--input-border); padding-left: 10px; gap: 4px;">
								<For each={tag().match}>
									{(match, matchIndex) => (
										<div class="flex-row" style="gap: 10px">
											<input type="text" placeholder="Match Pattern" value={match} onInput={e => updateMatch(index, matchIndex(), e.target.value)} />
											<a role="button" onClick={() => removeMatch(index, matchIndex())} title="Remove Match" class="flex-row">
												<Minus />
											</a>
										</div>
									)}
								</For>
								<a role="button" onClick={() => addMatch(index)} title="Add Match" class="flex-row" style="font-size: small">
									<Plus onClick={() => addMatch(index)} />
									add match
								</a>
							</div>
						</div>
					)}
				</Index>
				{errors.tags && <p style={{ color: "red" }}>{errors.tags}</p>}
			</div>
			<br />

			<div class="flex-col" style="gap: 6px">
				<div class="flex-row" style="gap: 20px">
					<h6>ignore paths</h6>
					<a role="button" onClick={addIgnorePath} title="Add Ignore Path" class="flex-row">
						<Plus />
						add path
					</a>
				</div>
				<For each={config.ignore}>
					{(path, index) => (
						<div class="flex-row" style="gap: 4px">
							<input type="text" placeholder="Ignore Path" value={path} onChange={e => updateIgnorePath(index(), e.target.value)} />
							<a role="button" onClick={() => removeIgnorePath(index())} title="Remove Path" class="flex-row">
								<Minus />
							</a>
						</div>
					)}
				</For>
				{errors.ignore && <p style={{ color: "red" }}>{errors.ignore}</p>}
			</div>

			<br />
			<div class="flex-row" style="gap: 20px">
				<a role="button" onClick={save} title="Export Config" class="flex-row">
					save
				</a>
			</div>
		</div>
	);
};

function ConfigDefaults({ tags, add }: { tags: Accessor<Config["tags"]>; add: (tag: DefaultConfig) => void }) {
	const [open, setOpen] = createSignal(false);
	const [available, setAvailable] = createSignal<DefaultConfig[]>(Object.keys(DEFAULT_CONFIGS) as DefaultConfig[]);

	// if tags is empty, set open to true
	createEffect(() => {
		if (tags().length === 0) {
			setOpen(true);
		}
	});

	createEffect(() => {
		// go through default configs, and find the ones that aren't in the tags
		const available = Object.keys(DEFAULT_CONFIGS).filter(tagName => {
			return !tags().some(tag => tag.name === tagName);
		}) as DefaultConfig[];
		setAvailable(available);
	});

	// have a little > icon that opens the list
	return (
		<div class="flex-row" style="gap: 10px; height: 21px">
			{available().length > 0 && (
				<a role="button" onClick={() => setOpen(!open())} class="flex-row">
					{open() ? <ChevronLeft /> : <ChevronRight />}
				</a>
			)}
			{open() && (
				<div class="flex-row" style="gap: 4px">
					<For each={available()}>
						{name => (
							<button onClick={() => add(name)} class="button-reset" style="font-size: small; border: 1px solid var(--input-border); border-radius: 5px; padding: 2px 8px;" title={`Add boilerplate config for ${name}`}>
								<a role="button" class="flex-row">
									+ {name}
								</a>
							</button>
						)}
					</For>
				</div>
			)}
		</div>
	);
}

export default TodoScannerConfig;
