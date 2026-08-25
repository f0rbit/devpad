/**
 * Re-exports the fractional-indexing rank algorithm from `@devpad/schema`
 * (single source of truth — see that module's header for why it lives
 * there, shared with the browser-side outline). Kept as a re-export rather
 * than an inline import at each call site so every existing
 * `from "./rank.js"` / `from "../rank.js"` import in this package keeps
 * working unchanged.
 */
export { needs_rebalance, rank_between, rank_validate } from "@devpad/schema";
