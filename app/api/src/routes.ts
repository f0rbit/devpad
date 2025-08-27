import { Elysia } from 'elysia';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import { eq } from 'drizzle-orm';
import * as schema from '../../database/schema';

// Create shared database instance
const dbPath = process.env.DATABASE_URL?.replace('sqlite://', '') || process.env.DATABASE_FILE || 'test.db';
const sqlite = new Database(dbPath);
const db = drizzle(sqlite, { schema });

export const v0Routes = new Elysia()
    .get('/api/v0', () => {
      return { status: 'ok' };
    })
    .get('/api/v0/projects', async () => {
      try {
        const projects = await db.select().from(schema.project);
        return projects;
      } catch (error) {
        console.error('Error fetching projects:', error);
        throw error;
      }
    })
    .post('/api/v0/projects', async ({ body }) => {
      try {
        const project_data = body as any;
        const [created_project] = await db.insert(schema.project).values(project_data).returning();
        return created_project;
      } catch (error) {
        console.error('Error creating project:', error);
        throw error;
      }
    })
    .get('/api/v0/projects/:id', async ({ params }) => {
      try {
        const [project] = await db.select().from(schema.project).where(eq(schema.project.id, params.id));
        if (!project) {
          throw new Error('Project not found');
        }
        return project;
      } catch (error) {
        console.error('Error fetching project:', error);
        throw error;
      }
    })
    .get('/api/v0/tasks', async ({ query }) => {
      try {
        let query_builder = db.select().from(schema.task);
        
        // Handle both 'project' and 'project_id' query parameters for compatibility
        const project_id = query.project_id || query.project;
        if (project_id) {
          query_builder = query_builder.where(eq(schema.task.project_id, project_id));
        }
        
        const tasks = await query_builder;
        return tasks;
      } catch (error) {
        console.error('Error fetching tasks:', error);
        throw error;
      }
    })
    .post('/api/v0/tasks', async ({ body }) => {
      try {
        const task_data = body as any;
        const [created_task] = await db.insert(schema.task).values(task_data).returning();
        return created_task;
      } catch (error) {
        console.error('Error creating task:', error);
        throw error;
      }
    })
    .get('/api/v0/tasks/:id', async ({ params }) => {
      try {
        const [task] = await db.select().from(schema.task).where(eq(schema.task.id, params.id));
        if (!task) {
          throw new Error('Task not found');
        }
        return task;
      } catch (error) {
        console.error('Error fetching task:', error);
        throw error;
      }
    });