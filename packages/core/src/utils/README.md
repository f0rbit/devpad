# DevPad Logging System

Centralized, configurable debug logging across all DevPad packages.

## Usage

```typescript
import { log } from "@devpad/core";

// Category-based logging (only logs if category is enabled)
log.auth("User authenticated successfully", { userId: "123" });
log.projects("Project created", { id: "proj_123" });
log.tasks("Task updated", { taskId: "task_456" });
log.repos("Fetched repositories", { count: 25 });
log.scanning("Scan completed", { filesScanned: 150 });

// Always log (cannot be disabled)
log.error("Something went wrong", error);
log.info("Important information", data);
log.warn("Warning message", details);
```

## Configuration

### Central Configuration
Edit `packages/core/src/utils/logger.ts`:

```typescript
const DEBUG_LOGS: DebugConfig = {
    auth: false,     // 🔐 Authentication flows
    tasks: false,    // 📋 Task operations  
    projects: true,  // 📁 Project operations (enabled)
    repos: true,     // 🐙 GitHub repository operations (enabled)
    middleware: false, // 🔍 Request middleware
    api: false,      // 📡 General API operations
    server: false,   // 🌐 Server startup & config
    scanning: false, // 🔍 Codebase scanning
    github: false,   // 🐙 GitHub API interactions  
    jwt: false,      // 🎟️ JWT token operations
    database: false, // 💾 Database operations
    startup: false,  // 🚀 Application startup messages
};
```

### Environment Variables

```bash
# Enable specific categories
DEBUG_CATEGORIES="auth,projects,tasks" bun run dev

# Enable all logging  
DEBUG_ALL=true bun run dev

# Default (use central config)
bun run dev
```

## Available Categories

| Category | Icon | Purpose |
|----------|------|---------|
| `auth` | 🔐 | Authentication flows, login, logout, sessions |
| `tasks` | 📋 | Task operations (create, update, delete, history) |
| `projects` | 📁 | Project operations (create, update, config, scan) |
| `repos` | 🐙 | GitHub repository operations |
| `middleware` | 🔍 | Request middleware processing |
| `api` | 📡 | General API operations |
| `server` | 🌐 | Server startup & configuration |
| `scanning` | 🔍 | Codebase scanning operations |
| `github` | 🐙 | GitHub API interactions |
| `jwt` | 🎟️ | JWT token operations |
| `database` | 💾 | Database operations |
| `startup` | 🚀 | Application startup messages, migrations, server init |

## Examples

```bash
# Quiet mode (only errors, warnings, info)
bun run dev

# Debug authentication issues
DEBUG_CATEGORIES="auth,jwt" bun run dev

# Debug project creation issues  
DEBUG_CATEGORIES="projects,repos,github" bun run dev

# Debug task management issues
DEBUG_CATEGORIES="tasks,database" bun run dev

# Full verbose mode
DEBUG_ALL=true bun run dev
```

## Migration from console.log

**Before:**
```typescript
console.log("🔐 [AUTH] User authenticated");
console.error("❌ [PROJECTS] Project creation failed");
```

**After:**
```typescript
import { log } from "@devpad/core";

log.auth("User authenticated");
log.error("Project creation failed");
```