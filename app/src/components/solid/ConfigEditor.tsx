import Minus from "lucide-solid/icons/minus";
import Plus from "lucide-solid/icons/plus";
import X from "lucide-solid/icons/x";
import { createSignal, For, Index } from "solid-js";
import { z } from "zod";
import { ConfigSchema } from "../../server/types";
import GitBranch from "lucide-solid/icons/git-branch";

type Config = z.infer<typeof ConfigSchema>;

/** @todo element to select from a couple default configs for different languages */

const TodoScannerConfig = ({ config, id, branches, scan_branch }: { config: Config, id: string, branches: any[] | null, scan_branch: string | undefined | null }) => {
  /** @todo change this from any - has to represent the nested signal for matches */
  const [tags, setTags] = createSignal<any>([]);
  const [ignorePaths, setIgnorePaths] = createSignal<Config["ignore"]>(config?.ignore ?? []);
  const [tagError, setTagError] = createSignal("");
  const [pathError, setPathError] = createSignal("");
  const [selectedBranch, setSelectedBranch] = createSignal<number | null>(branches?.length ? 0 : null);

  if (scan_branch) {
   const idx = branches?.findIndex((branch) => branch.name === scan_branch);
    if (idx != null) setSelectedBranch(idx);
  }

  if (config?.tags) {
    // we need to create signals for matches as well
    const tags = config.tags.map((tag) => {
      const [matches, setMatches] = createSignal<string[]>(tag.match);
      return { name: tag.name, matches, setMatches };
    });
    setTags(tags);
  }

  const addTag = () => {
    const [matches, setMatches] = createSignal<string[]>([]);
    setTags((prev) => {
      const updatedTags = [...prev, { name: "", matches, setMatches }];
      setMatches([]);
      return updatedTags;
    });
  };

  const updateTag = (index: number, field: "name" | "match", value: any) => {
    setTags((prev) => {
      const updatedTags = [...prev];
      updatedTags[index][field] = value;
      return updatedTags;
    });
    validateTags(tags());
  };

  const removeTag = (index: number) => {
    const updatedTags = [...tags()];
    updatedTags.splice(index, 1);
    setTags(updatedTags);
    validateTags(updatedTags);
  };

  const addMatch = (index: number) => {
    const updatedTags = [...tags()];
    updatedTags[index].setMatches([...updatedTags[index].matches(), ""]);
    setTags(updatedTags);
  };

  const removeMatch = (tagIndex: number, matchIndex: number) => {
    const updatedTags = [...tags()];
    updatedTags[tagIndex].setMatches([...updatedTags[tagIndex].matches().slice(0, matchIndex), ...updatedTags[tagIndex].matches().slice(matchIndex + 1)]);
    setTags(updatedTags);
    validateTags(updatedTags);
  };

  const validateTags = (tags: any) => {
    const tagNames = new Set();
    const allMatches = new Set();
    for (const tag of tags) {
      if (tag.name == "") continue; // empty tags will be ignored on export
      if (tagNames.has(tag.name)) {
        setTagError(`Tag name "${tag.name}" must be unique.`);
        return false;
      }
      tagNames.add(tag.name);
      const matches = typeof tag.matches === "function" ? tag.matches() : tag.match;
      for (const match of matches) {
        if (match == "") continue; // empty matches will be ignored on export
        if (allMatches.has(match)) {
          setTagError(`Match "${match}" must be unique across tags.`);
          return false;
        }
        allMatches.add(match);
      }
    }
    setTagError("");
    return true;
  };

  const addIgnorePath = () => {
    setIgnorePaths([...ignorePaths(), ""]);
  };

  const updateIgnorePath = (index: number, value: string) => {
    const updatedPaths = [...ignorePaths()];
    updatedPaths[index] = value;
    setIgnorePaths(updatedPaths);
    validateIgnorePaths(updatedPaths);
  };

  const removeIgnorePath = (index: number) => {
    const updatedPaths = [...ignorePaths()];
    updatedPaths.splice(index, 1);
    setIgnorePaths(updatedPaths);
    validateIgnorePaths(updatedPaths);
  };

  const validateIgnorePaths = (paths: Config["ignore"], t = tags()) => {
    console.log({ tags: t, ignore: paths });
    try {
      ConfigSchema.parse({ tags: t, ignore: paths });
      setPathError("");
      return true;
    } catch (e: any) {
      setPathError(e.errors[0]?.message || "Invalid ignore paths.");
      return false;
    }
  };

  const saveConfig = () => {
    const mapped_tags = tags().map((tag: any) => ({ name: tag.name, match: tag.matches() }));
    if (!validateTags(mapped_tags) || !validateIgnorePaths(ignorePaths(), mapped_tags)) {
      alert("Please resolve validation errors before exporting.");
      return;
    }
    // remove tags.setMatches & convert tags.matches() to tag.match as string[]
    const config = { tags: mapped_tags, ignore: ignorePaths() } as Config;

    // clean up config, removing empty tags, empty matches within tags, and empty ignore paths
    const cleaned_tags = config.tags.filter((tag) => tag.name != "" && tag.match.length > 0).map((tag) => ({ name: tag.name, match: tag.match.filter((match) => match != "") }));
    const cleaned_ignore = config.ignore.filter((path) => path != "");
    const cleaned_config = { tags: cleaned_tags, ignore: cleaned_ignore };
    const scan_branch = !branches || selectedBranch() == null ? undefined : branches[selectedBranch()!]?.name ?? undefined;

    const body = { id, config: cleaned_config, scan_branch };
    fetch("/api/project/save_config", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
      .then((response) => {
        if (response.ok) {
          window.location.reload();
        } else {
          alert("Error saving config.");
        }
      })
      .catch((error) => {
        console.error("Error saving config:", error);
        alert("Error saving config.");
      });
  };


  console.log(branches);

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
          <select value={selectedBranch() ?? ""} onChange={(e) => setSelectedBranch(parseInt(e.target.value))}>
            <For each={branches}>
              {(branch, index) => (
                <option value={index()} selected={index() === selectedBranch()}>{branch.name}</option>
              )}
            </For>
          </select>
          <p style="font-size: small">{selectedBranch() != null ? branches[selectedBranch()!].commit.message : ""}</p>
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
        <Index each={tags()}>
          {(tag, index) => (
            <div class="flex-col" style="gap: 4px">
              <div class="flex-row" style="gap: 10px">
                <input
                  type="text"
                  placeholder="Tag Name"
                  value={tag().name}
                  onInput={(e) => updateTag(index, "name", e.target.value)}
                />
                <a href="#" onClick={() => removeTag(index)} title="Remove Tag" class="flex-row">
                  <X onClick={() => removeTag(index)} />
                </a>
              </div>
              <div class="flex-col" style="border-left: 1px solid var(--input-border); padding-left: 10px; gap: 4px;">
                <For each={tag().matches()}>
                  {(match, matchIndex) => (
                    <div class="flex-row" style="gap: 10px">
                      <input
                        type="text"
                        placeholder="Match Pattern"
                        value={match}
                        onChange={(e) =>
                          setTags((prev) => {
                            const updatedTags = [...prev];
                            updatedTags[index].setMatches([
                              ...updatedTags[index].matches().slice(0, matchIndex()),
                              e.target.value,
                              ...updatedTags[index].matches().slice(matchIndex() + 1),
                            ]);
                            return updatedTags;
                          })
                        }
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
        {tagError() && <p style={{ color: "red" }}>{tagError()}</p>}
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
        <For each={ignorePaths()}>
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
        {pathError() && <p style={{ color: "red" }}>{pathError()}</p>}
      </div>

      <br />
      <div class="flex-row" style="gap: 20px">
        <a href="#" onClick={saveConfig} title="Export Config" class="flex-row">
          save
        </a>
      </div>

    </div>
  );
};

export default TodoScannerConfig;

