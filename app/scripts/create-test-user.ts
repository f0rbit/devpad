#!/usr/bin/env bun

import { db } from '../database/db';
import { user, api_key } from '../database/schema';
import crypto from 'crypto';

async function createTestUser() {
  try {
    console.error("Creating test user for integration tests...");

    // Create a unique test user
    const [test_user] = await db.insert(user).values({
      name: 'Integration Test User',
      email: `test-${Date.now()}@devpad.test`,
      github_id: null,
    }).returning();

    console.error("User created:", test_user);

    // Generate API key
    const api_key_value = crypto.randomBytes(32).toString('hex');

    const [created_api_key] = await db.insert(api_key).values({
      owner_id: test_user.id,
      hash: api_key_value  // Note: In production this should be hashed, but for testing we store it directly
    }).returning();

    console.error("API key created:", created_api_key);

    // Return the raw API key for use in tests
    console.log(api_key_value);  // This is what the script should output
    return api_key_value;
  } catch (error) {
    console.error("Error creating test user:", error);
    process.exit(1);
  }
}

// Run the script
createTestUser();