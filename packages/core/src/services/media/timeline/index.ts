// Timeline processing module
// Compositional namespace object for timeline operations

// Re-exports for backwards compatibility during migration
export * from "./grouping";
export * from "./loaders";
export type { ProfileSettings, ProfileTimelineError, ProfileTimelineOptions, ProfileTimelineResult, TimelineEntry } from "./namespace";
export { timeline } from "./namespace";
export * from "./normalizers";
export * from "./profile";
