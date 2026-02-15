# devpad

devpad is a suite of tools designed for development & project management. The main focus of this application is tracking and managing `@todo` and `// TODO:` comments within codebases. With a minimalist user interface, every element should have a clear purpose.

## Quick Start

### Get an API Key

1. Sign up at [devpad.tools](https://devpad.tools)
2. Go to [devpad.tools/account](https://devpad.tools/account)
3. Generate an API key

### CLI

Install and use the devpad CLI for command-line access to your projects and tasks:

```bash
bun install -g @devpad/cli

export DEVPAD_API_KEY="your-api-key"

devpad projects list
devpad tasks list
devpad tasks create --title "My task" --project <project-id>
```

See [packages/cli/README.md](packages/cli/README.md) for full documentation.

### MCP Server (AI Integration)

Connect devpad to AI assistants like Claude using the MCP server:

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "devpad": {
      "command": "bunx",
      "args": ["@devpad/mcp"],
      "env": {
        "DEVPAD_API_KEY": "your-api-key"
      }
    }
  }
}
```

**opencode** (`~/.config/opencode/opencode.json`):
```json
{
  "mcp": {
    "devpad": {
      "type": "local",
      "command": ["bunx", "@devpad/mcp"],
      "environment": {
        "DEVPAD_API_KEY": "your-api-key"
      }
    }
  }
}
```

See [packages/mcp/README.md](packages/mcp/README.md) for full documentation.

## Features

- **Project Management**: Track projects with descriptions, specifications, versioning, and status
- **Task Tracker**: Scan codebases for TODO comments, manage tasks with priorities and tags
- **Milestones & Goals**: Organize work into milestones with measurable goals
- **GitHub Integration**: Link projects to repositories, track branches and commits
- **CLI Tool**: Full command-line interface for all operations
- **MCP Server**: AI assistant integration via Model Context Protocol

## Development

### Setup
1. Clone the repo
2. Install dependencies: `bun install`
3. Setup `.env` file: [.env.example](/apps/main/.env.example)
4. Run dev server: `bun dev`

### Deployment
Deployed as a Cloudflare Worker via `wrangler`. Build with `bun run build:worker`.

### Testing
- Integration tests: `make integration`
- Unit tests: `make unit`

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
