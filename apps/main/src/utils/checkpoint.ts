import type { DocumentKind, SignoffCheckpoint } from "@devpad/schema";

/** A doc's kind maps 1:1 to the checkpoint that reviews it (`DOCUMENT_KINDS` is `plan | design | interface`; `SIGNOFF_CHECKPOINTS` is `plan | types | design` — `interface` docs are reviewed under the `types` checkpoint). Single source of truth for both AnnotationRail's verdict bar and the checkpoint card. */
export function checkpointForDocKind(kind: DocumentKind): SignoffCheckpoint {
	return kind === "interface" ? "types" : kind;
}
