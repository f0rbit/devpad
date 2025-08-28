import type { UpsertProject, UpsertTask, UpsertTag } from '../../src/types/common';

// Helper types for test data that ensure required fields are present
type TestProject = UpsertProject & Required<Pick<UpsertProject, 'name' | 'description' | 'status' | 'visibility'>>;
type TestTask = UpsertTask & Required<Pick<UpsertTask, 'owner_id' | 'title' | 'description' | 'progress' | 'priority' | 'visibility'>>;
type TestTag = UpsertTag & Required<Pick<UpsertTag, 'owner_id' | 'title'>>;

export class TestDataFactory {
  private static counter = 0;
  
  private static getNextId(): string {
    return `test-${Date.now()}-${++this.counter}`;
  }

  static createProject(overrides: Partial<UpsertProject> = {}): TestProject {
    const id = this.getNextId();
    return {
      name: `Test Project ${id}`,
      project_id: `test-project-${id}`,
      description: `A test project created at ${new Date().toISOString()}`,
      status: 'DEVELOPMENT',
      visibility: 'PRIVATE',
      deleted: false,
      ...overrides
    };
  }

  static createTask(owner_id: string, overrides: Partial<UpsertTask> = {}): TestTask {
    const id = this.getNextId();
    return {
      owner_id,
      title: `Test Task ${id}`,
      description: `A test task created at ${new Date().toISOString()}`,
      progress: 'UNSTARTED',
      priority: 'MEDIUM',
      visibility: 'PRIVATE',
      ...overrides
    };
  }

  static createTag(owner_id: string, overrides: Partial<UpsertTag> = {}): TestTag {
    const id = this.getNextId();
    return {
      owner_id,
      title: `Test Tag ${id}`,
      color: 'blue',
      deleted: false,
      render: true,
      ...overrides
    };
  }

  // Create a realistic project with common fields filled  
  static createRealisticProject(overrides: Partial<UpsertProject> = {}): TestProject & { specification: string | null } {
    const id = this.getNextId();
    return {
      name: `DevPad Integration Test ${id}`,
      project_id: `devpad-test-${id}`,
      description: 'Integration test project for testing API functionality',
      specification: '# Test Project\n\nThis project is used for testing the devpad API integration.',
      status: 'DEVELOPMENT',
      visibility: 'PUBLIC',
      deleted: false,
      link_url: 'https://github.com/test/project',
      link_text: 'View on GitHub',
      current_version: '0.1.0',
      ...overrides
    };
  }

  // Create a realistic task with common fields filled
  static createRealisticTask(owner_id: string, project_id?: string, overrides: Partial<UpsertTask> = {}): TestTask {
    const id = this.getNextId();
    return {
      owner_id,
      project_id: project_id || null,
      title: `Implement feature ${id}`,
      description: `This task involves implementing and testing feature ${id} for the integration test suite.`,
      summary: `Feature ${id} implementation`,
      progress: 'UNSTARTED',
      priority: 'HIGH',
      visibility: 'PUBLIC',
      start_time: new Date().toISOString(),
      end_time: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 1 week from now
      ...overrides
    };
  }

  // Create multiple test tags for a user
  static createTestTags(owner_id: string, count: number = 3): TestTag[] {
    const colors: Array<UpsertTag['color']> = ['red', 'green', 'blue', 'yellow', 'purple'];
    const tagTypes = ['bug', 'feature', 'enhancement', 'documentation', 'test'];
    
    return Array.from({ length: count }, (_, i) => ({
      owner_id,
      title: tagTypes[i % tagTypes.length],
      color: colors[i % colors.length],
      deleted: false,
      render: true,
    }));
  }
}