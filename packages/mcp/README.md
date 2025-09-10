# @devpad/mcp

MCP (Model Context Protocol) server for devpad - exposes devpad API functionality for AI assistants like Claude.

## Installation

```bash
npm install -g @devpad/mcp
# or
bunx @devpad/mcp
```

## Usage

### Environment Variables

- `DEVPAD_API_KEY` (required): Your devpad API key from https://devpad.tools/account
- `DEVPAD_BASE_URL` (optional): Base URL for devpad API (defaults to https://devpad.tools/api/v0)

### Claude Desktop Configuration

Add this to your Claude Desktop configuration file (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "devpad": {
      "command": "bunx",
      "args": ["@devpad/mcp"],
      "env": {
        "DEVPAD_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Or if you have the package installed locally:

```json
{
  "mcpServers": {
    "devpad": {
      "command": "node",
      "args": ["path/to/devpad/packages/mcp/dist/index.js"],
      "env": {
        "DEVPAD_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

## Available Tools

The MCP server exposes all devpad API functionality as tools:

### Projects
- `devpad_projects_list` - List all projects
- `devpad_projects_create` - Create a new project
- `devpad_projects_get` - Get project by ID or name
- `devpad_projects_update` - Update an existing project

### Tasks
- `devpad_tasks_list` - List tasks (with optional filters)
- `devpad_tasks_create` - Create a new task
- `devpad_tasks_update` - Update an existing task
- `devpad_tasks_get` - Get task by ID

### Milestones
- `devpad_milestones_list` - List milestones
- `devpad_milestones_create` - Create a new milestone
- `devpad_milestones_update` - Update an existing milestone

### Goals
- `devpad_goals_list` - List goals
- `devpad_goals_create` - Create a new goal

### Tags
- `devpad_tags_list` - List tags

### GitHub Integration
- `devpad_github_repos` - List GitHub repositories
- `devpad_github_branches` - List branches for a repository

## Example Usage in Claude

Once configured, you can use natural language in Claude:

- "List my devpad projects"
- "Create a new project called 'My App' with description 'A cool new app'"
- "Show me all tasks for project XYZ"
- "Create a milestone for Q1 2024"
- "What are my current goals?"

## Development

```bash
# Install dependencies
bun install

# Build
bun run build

# Run locally for testing
DEVPAD_API_KEY=your-key bun run dev
```