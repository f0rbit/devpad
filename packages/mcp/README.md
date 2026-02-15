# @devpad/mcp

MCP (Model Context Protocol) server for devpad - exposes devpad API functionality for AI assistants like Claude.

## Get an API Key

1. Sign up at [devpad.tools](https://devpad.tools)
2. Go to [devpad.tools/account](https://devpad.tools/account)
3. Generate an API key

## Installation

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

### opencode

Add to `~/.config/opencode/opencode.json`:

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

### Other MCP Clients

Run the server directly:

```bash
export DEVPAD_API_KEY="your-api-key"
bunx @devpad/mcp
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DEVPAD_API_KEY` | Yes | Your API key from devpad.tools/account |
| `DEVPAD_BASE_URL` | No | API base URL (default: https://devpad.tools/api/v1) |

## Available Tools

The MCP server exposes 46 tools for managing your devpad data:

### Projects
- `devpad_projects_list` - List all projects
- `devpad_projects_get` - Get project by ID or name
- `devpad_projects_upsert` - Create or update a project

### Tasks
- `devpad_tasks_list` - List tasks with optional filters
- `devpad_tasks_get` - Get task by ID
- `devpad_tasks_upsert` - Create or update a task
- `devpad_tasks_delete` - Delete a task
- `devpad_tasks_history` - Get task edit history

### Milestones
- `devpad_milestones_list` - List milestones
- `devpad_milestones_upsert` - Create or update a milestone

### Goals
- `devpad_goals_list` - List goals
- `devpad_goals_upsert` - Create or update a goal

### Tags
- `devpad_tags_list` - List all tags

### GitHub Integration
- `devpad_github_repos` - List linked GitHub repositories
- `devpad_github_branches` - List branches for a repository

## Example Prompts

Once configured, use natural language with your AI assistant:

- "List my devpad projects"
- "Show me all tasks for the devpad project"
- "Create a task called 'Fix login bug' in project X with high priority"
- "What milestones do I have?"
- "Mark task ABC as done"

## Development

```bash
bun install
bun run build
DEVPAD_API_KEY=your-key bun run dev
```