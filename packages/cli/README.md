# @devpad/cli

Command-line interface for devpad project and task management.

## Get an API Key

1. Sign up at [devpad.tools](https://devpad.tools)
2. Go to [devpad.tools/account](https://devpad.tools/account)
3. Generate an API key

## Installation

```bash
bun install -g @devpad/cli
```

Or run directly with bunx:

```bash
bunx @devpad/cli projects list
```

## Configuration

Set your API key as an environment variable:

```bash
export DEVPAD_API_KEY="your-api-key"
```

Or add it to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.):

```bash
echo 'export DEVPAD_API_KEY="your-api-key"' >> ~/.zshrc
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DEVPAD_API_KEY` | Yes | Your API key from devpad.tools/account |
| `DEVPAD_BASE_URL` | No | API base URL (default: https://devpad.tools/api/v1) |

## Usage

### Projects

```bash
devpad projects list
devpad projects get <id-or-name>
```

### Tasks

```bash
devpad tasks list
devpad tasks list --project <project-id>
devpad tasks get <id>
devpad tasks create --title "My task" --project <project-id>
devpad tasks create --title "Bug fix" --project <id> --priority high --summary "Fix the login bug"
devpad tasks done <id>
devpad tasks todo <id>
devpad tasks delete <id> --yes
devpad tasks history <id>
```

### Milestones

```bash
devpad milestones list
devpad milestones list --project <project-id>
devpad milestones create --name "v1.0" --project <project-id>
```

### Goals

```bash
devpad goals list
devpad goals create --name "Launch MVP" --milestone <milestone-id>
```

### Tags

```bash
devpad tags list
```

### GitHub

```bash
devpad github repos
devpad github branches <owner> <repo>
```

### User

```bash
devpad user history
devpad user preferences --user-id <id> --view list
```

## Output Formats

All list and get commands support `--format` option:

```bash
devpad projects list --format json    # JSON output (default)
devpad projects list --format table   # Table output
```

JSON output can be piped to `jq` for further processing:

```bash
devpad projects list | jq '.[].name'
devpad tasks list | jq '.[] | select(.task.priority == "HIGH")'
```

## Examples

List all high-priority tasks:
```bash
devpad tasks list | jq '.[] | select(.task.priority == "HIGH") | .task.title'
```

Get task count per project:
```bash
devpad tasks list | jq 'group_by(.task.project_id) | map({project: .[0].task.project_id, count: length})'
```

Create a task and get its ID:
```bash
devpad tasks create --title "New feature" --project my-project | jq '.id'
```

## Development

```bash
bun install
bun run build
DEVPAD_API_KEY=your-key bun run src/index.ts projects list
```
