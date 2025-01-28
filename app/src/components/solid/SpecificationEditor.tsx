// SpecificationEditor.jsx
import { createEffect, createSignal } from "solid-js";
import { remark } from "remark";
import remarkHtml from "remark-html";
import Pencil from "lucide-solid/icons/pencil";
import Github from "lucide-solid/icons/github";
import Loader from "lucide-solid/icons/loader";
import Save from "lucide-solid/icons/save";
import RotateCcw from "lucide-solid/icons/rotate-ccw";
import X from "lucide-solid/icons/x";

interface Props {
  project_id: string;
  initial: string;
}

const SpecificationEditor = ({ project_id, initial }: Props) => {
  const [isEditing, setIsEditing] = createSignal(false);
  const [markdown, setMarkdown] = createSignal(initial);
  const [parsedMarkdown, setParsedMarkdown] = createSignal("");
  const [error, setError] = createSignal("");
  const [fetching, setFetching] = createSignal(false);

  const fetchSpecification = async () => {
    setFetching(true);
    try {
      const response = await fetch(`/api/project/fetch_spec?project_id=${project_id}`);
      if (!response.ok) throw new Error("Failed to fetch specification");
      const readme = await response.text();
      setMarkdown(readme);
    } catch (err) {
      setError((err as Error).message);
    }
    setFetching(false);
  };

  const resetMarkdown = () => {
    setMarkdown(initial);
  };

  const exitEditing = () => {
    resetMarkdown();
    setIsEditing(false);
  };

  const parseMarkdown = async (md: string) => {
    try {
      const processed = await remark().use(remarkHtml).process(md);
      setParsedMarkdown(processed.toString());
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Parse markdown when editing is turned off
  createEffect(() => {
    if (!isEditing()) {
      parseMarkdown(markdown());
    }
  }, isEditing);

  return (
    <div class="specification-editor">
      {isEditing() ? (
        <>
          <div class="controls">
            <a role="button">
              <Save />
              save
            </a>
            <a role="button" onClick={fetchSpecification}>
              {fetching() ? <Spinner /> : <Github />}
              fetch
            </a>
            <a role="button" onClick={resetMarkdown}>
              <RotateCcw />
              reset
            </a>
            <div style={{ flex: 1 }} />
            <a role="button" onClick={exitEditing}>
              <X style="margin-right: -3px;" />
              <span>exit</span>
            </a>
          </div>
          <textarea
            value={markdown()}
            rows={50}
            onInput={(e) => setMarkdown(e.target.value)}
            style={{ width: "100%", "font-family": "monospace", "font-size": "medium" }}
          />
        </>
      ) : (
        <>
          <a role="button" class="edit icons" onClick={() => setIsEditing(true)}>
            <Pencil />
            edit
          </a>
          {error() && <p style={{ color: "red" }}>{error()}</p>}
          <div innerHTML={parsedMarkdown()} />
        </>
      )}
    </div>
  );
};

function Spinner() {
  return <Loader id="spinner" />;
}

export default SpecificationEditor;

