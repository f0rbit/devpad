#!/usr/bin/env bun

import { TEST_USER_ID } from '@/api/tests/integration/setup';
import { db } from '../database/db';
import { user, api_key } from '../database/schema';
import crypto from 'crypto';

async function createTestUser() {
  try {
    console.error("Creating test user for integration tests...");

    const [test_user] = await db.insert(user).values({
	  id: TEST_USER_ID,
      name: 'Integration Test User',
      email: `test-${Date.now()}@devpad.test`,
      github_id: null,
    }).returning();

    console.error("User created:", test_user);

    const api_key_value = crypto.randomBytes(32).toString('hex');

    const [created_api_key] = await db.insert(api_key).values({
      owner_id: test_user.id,
      hash: api_key_value,
    }).returning();

    console.error("API key created:", created_api_key);

    console.log(api_key_value);
    return api_key_value;
  } catch (error) {
    console.error("Error creating test user:", error);
    process.exit(1);
  }
}

// Run the script
createTestUser();