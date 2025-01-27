# devpad
devpad is a suite of tools designed for development & project management. The main focus of this application is tracking and managing `@todo` and `// TODO:` comments within codebases. With a minimalist user interface, every element should have a clear purpose.

## Main Features
- Project Management
    - Export to an API for external data fetching
    - Manage descriptions & specifications
    - Project versioning and automatic updates based on reaching goals
    - Tech stack information, project status
    - Update / revision history
    - Assign goals & milestones for todo tasks
- Task Tracker
    - Searches codebase for todo items
    - Presents management options for each
    - Allows for additional tasks
    - API for exporting to external data sources

## Installation

### Deployment (via Docker)
1. Download the repo
2. Setup environment variables [.env.example](/app/.env.example)
3. Setup DB `touch database/sqlite.db`
3. Run `make build` or `docker build -t devpad-app -f deployment/Dockerfile .`
4. Run `make run` or `docker run -p 8080:8080 -v ./database/sqlite.db:/sqlite.db devpad-app`

The docker file will run an [index.ts](/deployment/index.ts) script that does a `drizzle migrate` and exposes the `astro build` result via an `express server`.

### Development
1. Download repo
2. Install dependencies. `cd app && bun install`
3. Setup `.env` file [.env.example](/app/.env.example)
4. Run dev server with `bun dev`

### Testing
Currently, there is only end-to-end tests of the projects API, with a seeded test database. This is run via `bun test` from the `/app` directory.

## API

The API is available at [devpad.tools/api/v0](https://devpad.tools/api/v0). You should put an `API_KEY` in the `Authorization` header for each request in this format:

```
Authorization: Bearer <API_KEY>
```

API keys are generated on the [account](https://devpad.tools/account) page.

### Projects

This endpoint fetches the data associated with each project. Note that only projects with `visibility == "PUBLIC"` will be returned in `/projects` (with no query params).

#### GET /projects

- **200** - Array&lt;Project&gt;
- **401** - Unauthorized

#### GET /projects?id=&lt;string&gt; - id is project.id

- **200** - Project
- **401** - Unauthorized
- **404** - Not Found
- **500** - Internal Server Error

#### GET /projects?name=&lt;string&gt; - name is project.project_id

- **200** - Project
- **401** - Unauthorized
- **404** - Not Found
- **500** - Internal Server Error

```typescript
type Project = {
  id: string;
  project_id: string;
  owner_id: string;
  name: string;
  description: string | null;
  specification: string | null;
  repo_url: string | null;
  repo_id: string | null;
  icon_url: string | null;
  status: "DEVELOPMENT" | "PAUSED" | "RELEASED" | "LIVE" | "ABANDONED" | "STOPPED";
  deleted: boolean;
  link_url: string | null;
  link_text: string | null;
  visibility: "PUBLIC" | "PRIVATE" | "HIDDEN" | "ARCHIVED" | "DRAFT" | "DELETED";
  current_version: string | null;
  scan_branch: string | null;
};
```

### Tasks

This endpoint retrieves task information. Note that only tasks with `visibility == "PUBLIC"` will be returned in `/tasks` (with no query params).

#### GET /tasks

- **200** - Array&lt;TaskUnion&gt;
- **401** - Unauthorized

#### GET /tasks?id=&lt;string&gt; - id is task.id

- **200** - TaskUnion
- **401** - Unauthorized
- **404** - Not Found
- **500** - Internal Server Error

#### GET /tasks?tag=&lt;string&gt; - tag is task.tag

- **200** - Array&lt;TaskUnion&gt;
- **401** - Unauthorized
- **404** - Not Found
- **500** - Internal Server Error

#### GET /tasks?project=&lt;string&gt; - project is task.project_id

- **200** - Array&lt;TaskUnion&gt;
- **401** - Unauthorized
- **404** - Not Found
- **500** - Internal Server Error

```typescript
type Task = {
  id: string;
  project_id: string;
  owner_id: string;
  title: string;
  description: string;
  start_time: string | null;
  end_time: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH";
  visibility: "PUBLIC" | "PRIVATE" | "HIDDEN" | "ARCHIVED" | "DRAFT" | "DELETED";
};

type CodebaseTask = {
  id: string;
  branch: string;
  commit_sha: string;
  commit_msg: string;
  commit_url: string;
  type: string;
  text: string;
  file: string;
  line: number;
  context: string[];
  created_at: string;
  updated_at: string;
  deleted: boolean | null;
  recent_scan_id: number;
};

type TaskUnion = {
  task: Task;
  codebase_task: CodebaseTask;
  tags: string[];
};
```
