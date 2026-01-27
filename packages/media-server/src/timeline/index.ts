// Timeline processing module
// Compositional namespace object for timeline operations

export { timeline } from "./namespace";
export type { TimelineEntry, ProfileTimelineOptions, ProfileTimelineResult, ProfileSettings, ProfileTimelineError } from "./namespace";

// Re-exports for backwards compatibility during migration
export * from "./grouping";
export * from "./loaders";
export * from "./normalizers";
export * from "./profile";
