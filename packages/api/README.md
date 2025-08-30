# @devpad/api

TypeScript client library for the Devpad API - project and task management made simple.

## Installation

```bash
npm install @devpad/api
# or
yarn add @devpad/api
# or
bun add @devpad/api
```

## Quick Start

```typescript
import DevpadApiClient from '@devpad/api';

const client = new DevpadApiClient({
  api_key: 'your-api-key-here',
  base_url: 'https://devpad.tools/api/v0' // optional, defaults to localhost:4321
});

// Create a project
const project = await client.projects.create({
  name: 'My New Project',
  description: 'A project created via API',
  visibility: 'private'
});

// Create a task
const task = await client.tasks.create({
  project_id: project.data.project_id,
  title: 'Implement new feature',
  description: 'Add user authentication',
  status: 'pending',
  priority: 'high',
  tags: ['feature', 'auth']
});
```

## API Reference

### DevpadApiClient

Main client class that provides access to all API endpoints.

```typescript
const client = new DevpadApiClient({
  api_key: string;          // Required: Your Devpad API key
  base_url?: string;        // Optional: API base URL (defaults to localhost:4321/api/v0)
});
```

### Projects API

#### `client.projects.list()`
Get all projects for the authenticated user.

#### `client.projects.get(id: string)`
Get a specific project by ID.

#### `client.projects.getByName(name: string)`
Get a project by name.

#### `client.projects.create(data: ProjectCreate)`
Create a new project.

#### `client.projects.update(project_id: string, data: Partial<ProjectUpdate>)`
Update an existing project.

#### `client.projects.upsert(data: ProjectUpsert)`
Create or update a project (unified endpoint).

### Tasks API

#### `client.tasks.list(options?: { project_id?: string; tag_id?: string })`
Get tasks, optionally filtered by project or tag.

#### `client.tasks.get(id: string)`
Get a specific task by ID.

#### `client.tasks.getByProject(project_id: string)`
Get all tasks for a specific project.

#### `client.tasks.create(data: TaskCreate)`
Create a new task.

#### `client.tasks.update(task_id: string, data: Partial<TaskUpdate>)`
Update an existing task.

#### `client.tasks.upsert(data: TaskUpsert)`
Create or update a task (unified endpoint).

### Types

The library exports TypeScript types for all API operations:

```typescript
import { 
  ProjectType, 
  TaskType, 
  TagType,
  ProjectCreate,
  ProjectUpdate, 
  ProjectUpsert,
  TaskCreate,
  TaskUpdate,
  TaskUpsert,
  ApiResponse 
} from '@devpad/api';
```

### Error Handling

The client throws typed errors for different failure scenarios:

```typescript
import { DevpadApiError, AuthenticationError, NetworkError } from '@devpad/api';

try {
  await client.projects.create({ name: 'Test Project' });
} catch (error) {
  if (error instanceof AuthenticationError) {
    console.error('Invalid API key');
  } else if (error instanceof DevpadApiError) {
    console.error('API Error:', error.message, error.statusCode);
  } else if (error instanceof NetworkError) {
    console.error('Network Error:', error.message);
  }
}
```

## Authentication

To use this API client, you need a Devpad API key. You can generate one through the Devpad web interface at your account settings.

## Development

This package is built with TypeScript and uses Bun for development. The source code is available at [github.com/f0rbit/devpad](https://github.com/f0rbit/devpad).

## License

MIT

## Support

For issues and feature requests, please visit the [GitHub repository](https://github.com/f0rbit/devpad/issues).