import Minus from "lucide-solid/icons/minus";
import Plus from "lucide-solid/icons/plus";
import X from "lucide-solid/icons/x";
import { createSignal, For, Index } from "solid-js";
import { z } from "zod";

const ConfigSchema = z.object({
  tags: z.array(
    z.object({
      name: z.string(),
      match: z.array(z.string()),
    })
  ),
  ignore: z.array(z.string().regex(/^[^]*$/, "Invalid path")),
});

type Config = z.infer<typeof ConfigSchema>;

const TodoScannerConfig = ({ config }: { config: Config }) => {
  /** @todo change this from any - has to represent the nested signal for matches */
  const [tags, setTags] = createSignal<any>(config?.tags ?? []);
  const [ignorePaths, setIgnorePaths] = createSignal<Config["ignore"]>(config?.ignore ?? []);
  const [tagError, setTagError] = createSignal("");
  const [pathError, setPathError] = createSignal("");

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

  const exportConfig = () => {
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
        
    console.log("Exported Config:", JSON.stringify(cleaned_config, null, 2))
  };


  return (
    <div>
      <div class="flex-col" style="gap: 6px">
        <div class="flex-row" style="gap: 20px">
            <h4>tags</h4>
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
            <h4>ignore paths</h4>
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
            <a href="#" onClick={exportConfig} title="Export Config" class="flex-row">
                save
            </a>
        </div>

    </div>
  );
};

export default TodoScannerConfig;

