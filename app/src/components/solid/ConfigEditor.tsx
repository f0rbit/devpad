import Minus from "lucide-solid/icons/minus";
import Plus from "lucide-solid/icons/plus";
import X from "lucide-solid/icons/x";
import { For, Index } from "solid-js";
import { z } from "zod";
import { ConfigSchema } from "../../server/types";
import GitBranch from "lucide-solid/icons/git-branch";
import { createStore } from "solid-js/store";

type Config = z.infer<typeof ConfigSchema>;

/** @todo element to select from a couple default configs for different languages */

const TodoScannerConfig = ({ config: initial_config, id, branches, scan_branch }: { config: Config, id: string, branches: any[] | null, scan_branch: string | undefined | null }) => {
  /** @todo change this from any - has to represent the nested signal for matches */
  const [config, setConfig] = createStore({
    tags: initial_config.tags ?? [],
    ignore: initial_config?.ignore ?? [],
    branch: scan_branch ?? null,
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
    setConfig("tags", (prev) => {
      return prev.map((t, i) => (i === index ? { ...t, name } : t))
    });
    validate();
  };

  const removeTag = (index: number) => {
    setConfig("tags", (prev) => {
      return prev.filter((_, i) => i !== index);
    });
    validate();
  };

  const addMatch = (index: number) => {
    setConfig("tags", (prev) => {
      return prev.map((t, i) => (i === index ? { ...t, match: [...t.match, ""] } : t))
    });
    validate();
  };

  const updateMatch = (index: number, match_index: number, value: string) => {
    setConfig("tags", (prev) => {
      return prev.map((t, i) => (i === index ? { ...t, match: t.match.map((m, mi) => (mi === match_index ? value : m)) } : t))
    });
    validate();
  };

  const removeMatch = (index: number, match_index: number) => {
    setConfig("tags", (prev) => {
      return prev.map((t, i) => (i === index ? { ...t, match: t.match.filter((_, mi) => mi !== match_index) } : t))
    });
    validate();
  };

  const addIgnorePath = () => {
    setConfig("ignore", [...config.ignore, ""]);
  };

  const updateIgnorePath = (index: number, value: string) => {
    setConfig("ignore", (prev) => {
      return prev.map((p, i) => (i === index ? value : p))
    });
    validate();
  };

  const removeIgnorePath = (index: number) => {
    setConfig("ignore", (prev) => {
      return prev.filter((_, i) => i !== index)
    });
    validate();
  };

  const selectBranch = (branch: string | null) => {
    setConfig("branch", branch);
  };

  const validate = () => {
    const { tags, ignore } = config;
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

  const save = async () => {
    if (!validate()) return;

    try {
      const response = await fetch(`/api/project/save_config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: {
            tags: config.tags.filter((tag) => tag.name && tag.match.length > 0),
            ignore: config.ignore.filter((path) => path.trim()),
          },
          scan_branch: config.branch ?? undefined,
          id
        }),
      });

      if (response.ok) {
        window.location.reload();
      } else {
        setErrors("tags", "Failed to save configuration.");
      }
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
    const found = branches.find((b) => b.name === branch);
    if (!found) return null;
    return found.commit.message;
  };


  return (
    <div>
      {/* section to pick branch */}
      {branches != null ? (
        <div class="flex-col" style="gap: 6px; margin-bottom: 20px">
          <div class="flex-row" style="gap: 20px">
            <h5>branch</h5>
          </div>
          <div class="flex-row" style="gap: 8px">
            <GitBranch />
            <select value={config.branch ?? ""} onChange={(e) => selectBranch(e.target.value)}>
              <For each={branches}>
                {(branch) => (
                  <option value={branch.name} selected={branch.name === config.branch}>{branch.name}</option>
                )}
              </For>
            </select>
            <p style="font-size: small">{commit_message()}</p>
          </div>
        </div>
      ) : null}
      <div class="flex-col" style="gap: 6px">
        <div class="flex-row" style="gap: 20px">
          <h5>tags</h5>
          <a href="#" onClick={addTag} title="Add Tag" class="flex-row">
            <Plus />
            add tag
          </a>
        </div>
        <Index each={config.tags}>
          {(tag, index) => (
            <div class="flex-col" style="gap: 4px">
              <div class="flex-row" style="gap: 10px">
                <input
                  type="text"
                  placeholder="Tag Name"
                  value={tag().name}
                  onInput={(e) => updateTagName(index, e.target.value)}
                />
                <a href="#" onClick={() => removeTag(index)} title="Remove Tag" class="flex-row">
                  <X onClick={() => removeTag(index)} />
                </a>
              </div>
              <div class="flex-col" style="border-left: 1px solid var(--input-border); padding-left: 10px; gap: 4px;">
                <For each={tag().match}>
                  {(match, matchIndex) => (
                    <div class="flex-row" style="gap: 10px">
                      <input
                        type="text"
                        placeholder="Match Pattern"
                        value={match}
                        onChange={(e) => updateMatch(index, matchIndex(), e.target.value)}
                      />
                      <a href="#" onClick={() => removeMatch(index, matchIndex())} title="Remove Match" class="flex-row">
                        <Minus onClick={() => removeMatch(index, matchIndex())} />
                      </a>
                    </div>
                  )}
                </For>
                <a href="#" onClick={() => addMatch(index)} title="Add Match" class="flex-row" style="font-size: small">
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
          <h5>ignore paths</h5>
          <a href="#" onClick={addIgnorePath} title="Add Ignore Path" class="flex-row">
            <Plus />
            add path
          </a>
        </div>
        <For each={config.ignore}>
          {(path, index) => (
            <div class="flex-row" style="gap: 4px">
              <input
                type="text"
                placeholder="Ignore Path"
                value={path}
                onChange={(e) => updateIgnorePath(index(), e.target.value)}
              />
              <a href="#" onClick={() => removeIgnorePath(index())} title="Remove Path" class="flex-row">
                <Minus />
              </a>
            </div>
          )}
        </For>
        {errors.ignore && <p style={{ color: "red" }}>{errors.ignore}</p>}
      </div>

      <br />
      <div class="flex-row" style="gap: 20px">
        <a href="#" onClick={save} title="Export Config" class="flex-row">
          save
        </a>
      </div>

    </div>
  );
};

export default TodoScannerConfig;

