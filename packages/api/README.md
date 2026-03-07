# @devpad/api

TypeScript API client for [devpad](https://devpad.tools) — project management, task tracking, milestones, goals, and more.

## Installation

```bash
bun add @devpad/api
```

## Quick start

```typescript
import ApiClient from "@devpad/api";

const client = new ApiClient({
  base_url: "https://devpad.tools/api/v1",
  api_key: "your-api-key",
});
```

The constructor also accepts `auth_mode`, `credentials`, `default_headers`, and `custom_fetch`. Auth mode is auto-detected from the `api_key` format.

## Error handling

All methods return `ApiResult<T>` which is `Result<T, ApiResultError>` from `@f0rbit/corpus`. No try/catch needed.

```typescript
import ApiClient, { type ApiResult } from "@devpad/api";

const result = await client.projects.list();

if (!result.ok) {
  console.error(result.error.message, result.error.status_code);
  return;
}

const projects = result.value;
```

The `ok()` and `err()` constructors are re-exported for building your own Results.

## API reference

### Projects

```typescript
client.projects.list()
client.projects.find(id)
client.projects.getByName(name)
client.projects.create(data)
client.projects.upsert(data)
client.projects.config.load(id)
client.projects.config.save(id, config)
client.projects.history(id)
client.projects.specification(id)
client.projects.scan.initiate(name)
client.projects.scan.updates(id)
client.projects.map()
```

### Tasks

```typescript
client.tasks.list(params?)          // optional { project_id, tag_id }
client.tasks.find(id)
client.tasks.getByProject(id)
client.tasks.create(data)
client.tasks.upsert(data)
client.tasks.delete(id)
client.tasks.history.get(id)
```

### Milestones

```typescript
client.milestones.list(params?)     // optional { project_id }
client.milestones.find(id)
client.milestones.getByProject(id)
client.milestones.create(data)
client.milestones.update(id, data)
client.milestones.delete(id)
client.milestones.goals(id)
```

### Goals

```typescript
client.goals.list()
client.goals.find(id)
client.goals.create(data)
client.goals.update(id, data)
client.goals.delete(id)
```

### Tags

```typescript
client.tags.list()
client.tags.save(tags)
```

### Auth

```typescript
client.auth.keys.list()
client.auth.keys.create(data)
client.auth.keys.update(id, data)
client.auth.keys.delete(id)
client.auth.user()
client.auth.login(code)
client.auth.loginUrl()
```

### User

```typescript
client.user.history()
```

### GitHub

```typescript
client.github.repos()
client.github.branches(owner, repo)
```

Blog and media namespaces also exist but are documented separately.

## Types

```typescript
import ApiClient, {
  type ApiResult,
  type ApiResultError,
  type AuthMode,        // "session" | "key" | "cookie"
} from "@devpad/api";

// Schema types re-exported for convenience
import type {
  Project,
  TaskWithDetails,
  UpsertProject,
  UpsertTodo,
} from "@devpad/api";
```

Result utilities `ok` and `err` are also exported from the main entry point.

## License

MIT
