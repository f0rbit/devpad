import { userRepository, type UpdateUserData, type User } from "../data/user-repository";

export type { UpdateUserData, User };

/**
 * Update user preferences in database
 */
export async function updateUserPreferences(userId: string, updates: UpdateUserData): Promise<User> {
	return userRepository.updateUserPreferences(userId, updates);
}

/**
 * Get user by ID
 */
export async function getUserById(userId: string): Promise<User | null> {
	return userRepository.getUserById(userId);
}

/**
 * Get user by GitHub ID
 */
export async function getUserByGithubId(githubId: number): Promise<User | null> {
	return userRepository.getUserByGithubId(githubId);
}

/**
 * Get user by email
 */
export async function getUserByEmail(email: string): Promise<User | null> {
	return userRepository.getUserByEmail(email);
}
